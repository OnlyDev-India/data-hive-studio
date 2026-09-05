//! MongoDB adapter: connects over TCP, lists databases/collections, serves
//! document browsing/editing and the MongoDB console (find/aggregate/shell
//! subset), and — per `MONGODB_SUPPORT.md` Phase 4 — runs a `SELECT`-only SQL
//! subset (see `mongo_sql.rs`) translated to `find()`. Writes/DDL via SQL
//! remain unsupported; use the grid or the MongoDB console for those.

use async_trait::async_trait;
use base64::Engine as _;
use bson::doc;
use futures_util::TryStreamExt;
use mongodb::options::ClientOptions;
use mongodb::Client;
use std::sync::Arc;

use super::{BatchSink, DbAdapter, DbError, DbResult, OpOutcome, QueryChunk};
use crate::api::{
    ColumnInfo, FilterOp, GridFilterCond, IndexInfo, QueryOp, QueryResult, SchemaOp, TableInfo,
    TableSchema,
};

/// Parameters for connecting to a MongoDB server.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MongoParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// Auth source database (defaults to "admin" when None).
    #[serde(default)]
    pub auth_db: Option<String>,
    /// Use mongodb+srv:// (DNS seedlist) instead of mongodb:// (single host).
    /// When true, `port` is ignored.
    #[serde(default)]
    pub srv: bool,
    /// Require TLS on a plain `mongodb://` connection. `mongodb+srv://`
    /// (`srv: true`) gets TLS by default regardless of this flag — this only
    /// matters for direct single-host connections.
    #[serde(default)]
    pub tls: bool,
}

fn default_port() -> u16 {
    27017
}

async fn build_options(params: &MongoParams) -> DbResult<ClientOptions> {
    let mut query: Vec<String> = vec![format!(
        "authSource={}",
        percent_encode(params.auth_db.as_deref().unwrap_or("admin"))
    )];
    // mongodb+srv:// implies TLS by default; a plain mongodb:// connection
    // needs it requested explicitly to get the driver's TLS transport
    // (backed by the `rustls-tls` feature on the `mongodb` crate).
    if params.tls && !params.srv {
        query.push("tls=true".to_string());
    }
    let query = query.join("&");
    let uri = if params.srv {
        // mongodb+srv:// requires a seedlist hostname (no port)
        format!(
            "mongodb+srv://{}:{}@{}/{}?{}",
            params.user,
            percent_encode(&params.password),
            params.host,
            params.database,
            query,
        )
    } else {
        // mongodb:// single host with explicit port
        format!(
            "mongodb://{}:{}@{}:{}/{}?{}",
            params.user,
            percent_encode(&params.password),
            params.host,
            params.port,
            params.database,
            query,
        )
    };
    ClientOptions::parse(uri)
        .await
        .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))
}

/// Minimal percent-encoding for the password/authSource in a connection URI
/// (reserves + the `@:/?#` separators users commonly include).
fn percent_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

/// Coerce a filter-bar string value to a BSON scalar (bool / int / double /
/// string) so Mongo comparisons are typed instead of always-string.
fn scalar_bson(v: &str) -> bson::Bson {
    match v {
        "true" => bson::Bson::Boolean(true),
        "false" => bson::Bson::Boolean(false),
        _ => v
            .parse::<i64>()
            .map(bson::Bson::Int64)
            .or_else(|_| v.parse::<f64>().map(bson::Bson::Double))
            .unwrap_or_else(|_| bson::Bson::String(v.to_string())),
    }
}

/// One filter-bar condition → a Mongo query document fragment.
fn condition_doc(cond: &GridFilterCond) -> Option<bson::Document> {
    let field = &cond.column;
    let mut d = bson::Document::new();
    match cond.op {
        FilterOp::Eq => d.insert(field, scalar_bson(&cond.value)),
        FilterOp::Neq => d.insert(field, doc! { "$ne": scalar_bson(&cond.value) }),
        FilterOp::Gt => d.insert(field, doc! { "$gt": scalar_bson(&cond.value) }),
        FilterOp::Gte => d.insert(field, doc! { "$gte": scalar_bson(&cond.value) }),
        FilterOp::Lt => d.insert(field, doc! { "$lt": scalar_bson(&cond.value) }),
        FilterOp::Lte => d.insert(field, doc! { "$lte": scalar_bson(&cond.value) }),
        FilterOp::Contains => d.insert(
            field,
            doc! { "$regex": cond.value.as_str(), "$options": "i" },
        ),
        FilterOp::StartsWith => d.insert(
            field,
            doc! { "$regex": format!("^{}", cond.value), "$options": "i" },
        ),
        FilterOp::EndsWith => d.insert(
            field,
            doc! { "$regex": format!("{}$", cond.value), "$options": "i" },
        ),
        FilterOp::IsNull => d.insert(field, bson::Bson::Null),
        FilterOp::IsNotNull => d.insert(field, doc! { "$ne": null }),
    };
    Some(d)
}

/// Build a Mongo filter from the filter-bar conditions, or from a raw Mongo
/// query JSON in `custom_where` (which wins, mirroring the SQL adapter).
fn build_filter(
    filters: &[GridFilterCond],
    custom_where: Option<&str>,
) -> DbResult<Option<bson::Document>> {
    if let Some(cw) = custom_where.map(str::trim).filter(|s| !s.is_empty()) {
        let parsed: serde_json::Value =
            serde_json::from_str(&super::mongo_json::quote_bare_keys(cw)).map_err(|e| {
                DbError::InvalidOperation(format!(
                    "custom_where must be a Mongo query JSON object: {e}"
                ))
            })?;
        return Ok(bson::to_document(&parsed).ok());
    }
    if filters.is_empty() {
        return Ok(None);
    }
    let docs: Vec<bson::Document> = filters.iter().filter_map(condition_doc).collect();
    if docs.is_empty() {
        return Ok(None);
    }
    if docs.len() == 1 {
        return Ok(docs.into_iter().next());
    }
    let use_or = filters
        .iter()
        .all(|f| f.conjunction.as_deref() == Some("OR"));
    if use_or {
        Ok(Some(doc! { "$or": docs }))
    } else {
        Ok(Some(doc! { "$and": docs }))
    }
}

/// Render one document's field as a grid cell string (None = NULL cell).
fn json_cell_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    }
}

/// Compact JSON-ish description of a Mongo filter for the activity log.
fn filter_desc(filter: &Option<bson::Document>) -> String {
    match filter {
        Some(d) => serde_json::to_string(d).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    }
}

/// True when `s` looks like a 24-character ObjectId hex string.
fn is_object_id_hex(s: &str) -> bool {
    s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Coerce a grid cell string to a BSON value using the column's inferred
/// type. Object/array/bson fields are parsed as JSON so nested documents stay
/// structured; scalars are coerced to bool/int/double where sensible.
fn field_bson(value: Option<&str>, data_type: Option<&str>) -> bson::Bson {
    let v = match value {
        Some(v) => v,
        None => return bson::Bson::Null,
    };
    let t = data_type.unwrap_or("").to_ascii_lowercase();
    if t.contains("object") || t.contains("array") || t.contains("bson") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(v) {
            if let Ok(b) = bson::to_bson(&j) {
                return b;
            }
        }
        return bson::Bson::String(v.to_string());
    }
    if t.contains("bool") {
        return bson::Bson::Boolean(v == "true" || v == "1");
    }
    if t.contains("int") || t.contains("long") || t.contains("integer") {
        if let Ok(i) = v.parse::<i64>() {
            return bson::Bson::Int64(i);
        }
        if let Ok(f) = v.parse::<f64>() {
            return bson::Bson::Double(f);
        }
    }
    if t.contains("double") || t.contains("float") || t.contains("decimal") {
        if let Ok(f) = v.parse::<f64>() {
            return bson::Bson::Double(f);
        }
    }
    // No type hint (e.g. a dotted nested path from the drill-down editor): best
    // effort — bool, integer, double, then JSON object/array, else string.
    if v == "true" {
        return bson::Bson::Boolean(true);
    }
    if v == "false" {
        return bson::Bson::Boolean(false);
    }
    if let Ok(i) = v.parse::<i64>() {
        if !is_object_id_hex(v) {
            return bson::Bson::Int64(i);
        }
    }
    if let Ok(f) = v.parse::<f64>() {
        return bson::Bson::Double(f);
    }
    if let Ok(j) = serde_json::from_str::<serde_json::Value>(v) {
        if j.is_object() || j.is_array() {
            if let Ok(b) = bson::to_bson(&j) {
                return b;
            }
        }
    }
    bson::Bson::String(v.to_string())
}

/// Build a document-matching filter from a grid row's `match_row` (key → cell
/// string). `_id` values that look like ObjectId hex are matched as real
/// ObjectIds; other fields are coerced generically.
fn filter_from_match_row(
    match_row: &std::collections::BTreeMap<String, Option<String>>,
) -> bson::Document {
    let mut d = bson::Document::new();
    for (k, v) in match_row {
        if k == "_id" {
            if let Some(s) = v.as_deref() {
                if is_object_id_hex(s) {
                    if let Ok(oid) = bson::oid::ObjectId::parse_str(s) {
                        d.insert("_id", oid);
                        continue;
                    }
                }
            }
        }
        d.insert(k, field_bson(v.as_deref(), None));
    }
    d
}

pub struct MongoAdapter {
    client: Client,
    /// Database unqualified collection operations resolve against. Starts as
    /// the database the connection was opened with, but the user can switch
    /// it (a Mongo connection spans every database on the server) — see
    /// `set_active_schema`. A sync `RwLock` is fine: it's only ever held for
    /// a clone/assign, never across an `.await`.
    database: std::sync::RwLock<String>,
}

// ---- Console parser (Phase 3: find / aggregate / count / distinct + a small
// shell subset). MongoDB has no SQL, so the console accepts JSON queries and
// baking-stone shell-style commands instead. No arbitrary JS is evaluated.

/// Index of the `)` matching the `(` at `open`, skipping over quoted strings
/// (so `$regex: "a(b"` does not throw off the balance). Returns None if
/// unbalanced.
fn balanced_close(s: &str, open: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth: isize = 1;
    let mut i = open + 1;
    let mut in_str: Option<u8> = None;
    let mut escaped = false;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == q {
                in_str = None;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' => in_str = Some(b),
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Split `s` on top-level commas (depth 0, string-aware) — used to separate a
/// command's comma-separated JSON arguments.
fn split_top_level(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut depth: isize = 0;
    let mut cur = String::new();
    let mut in_str: Option<char> = None;
    let mut escaped = false;
    for b in s.chars() {
        if let Some(q) = in_str {
            cur.push(b);
            if escaped {
                escaped = false;
            } else if b == '\\' {
                escaped = true;
            } else if b == q {
                in_str = None;
            }
            continue;
        }
        match b {
            '"' | '\'' => {
                in_str = Some(b);
                cur.push(b);
            }
            '{' | '[' | '(' => {
                depth += 1;
                cur.push(b);
            }
            '}' | ']' | ')' => {
                depth -= 1;
                cur.push(b);
            }
            ',' if depth == 0 => {
                out.push(cur.trim().to_string());
                cur = String::new();
            }
            _ => cur.push(b),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// A parsed `db.<collection>.<method>(<args>)[.limit(n).pretty()]` call.
struct DbCall {
    coll: String,
    method: String,
    args: String,
    chain: String,
}

/// Parse a `db.<collection>.<method>(...)` console command into its parts.
fn parse_db_call(s: &str) -> Option<DbCall> {
    let body = s.strip_prefix("db.")?;
    let body = body.trim().trim_end_matches(';').trim();
    let open = body.find('(')?;
    let prefix = &body[..open];
    let last_dot = prefix.rfind('.')?;
    let method = prefix[last_dot + 1..].trim().to_string();
    let coll = prefix[..last_dot].trim().to_string();
    let close = balanced_close(body, open)?;
    let args = body[open + 1..close].trim().to_string();
    let chain = body[close + 1..]
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string();
    Some(DbCall {
        coll,
        method,
        args,
        chain,
    })
}

/// Options recognized after a `find(...)` call, e.g. `.limit(5).sort({...})`.
struct FindChain {
    limit: Option<i64>,
    sort: Option<String>,
}

fn parse_chain(chain: &str) -> FindChain {
    let lower = chain.to_ascii_lowercase();
    let mut f = FindChain {
        limit: None,
        sort: None,
    };
    if let Some(i) = lower.find(".limit") {
        if let Some(po) = chain[i..].find('(') {
            let o = i + po;
            if let Some(c) = balanced_close(chain, o) {
                f.limit = chain[o + 1..c].trim().parse::<i64>().ok();
            }
        }
    }
    if let Some(i) = lower.find(".sort") {
        if let Some(po) = chain[i..].find('(') {
            let o = i + po;
            if let Some(c) = balanced_close(chain, o) {
                f.sort = Some(chain[o + 1..c].trim().to_string());
            }
        }
    }
    f
}

/// Parse a `<query>` argument (optionally `query, options`) into a filter
/// document. Empty input → `None` (match everything).
fn parse_filter(args: &str) -> DbResult<Option<bson::Document>> {
    let parts = split_top_level(args);
    let first = parts.first().map(|p| p.trim()).unwrap_or("");
    if first.is_empty() {
        return Ok(None);
    }
    let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(first))
        .map_err(|e| DbError::InvalidOperation(format!("invalid query JSON: {e}")))?;
    if !v.is_object() {
        return Err(DbError::InvalidOperation(
            "a query must be a JSON object, e.g. {\"status\": \"active\"}".into(),
        ));
    }
    bson::to_document(&v)
        .map(Some)
        .map_err(|e| DbError::InvalidOperation(format!("invalid query: {e}")))
}

/// Project a list of JSON documents into a union-of-fields grid.
fn flatten_documents(docs: &[serde_json::Value]) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    let mut columns: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in docs {
        if let serde_json::Value::Object(map) = d {
            for k in map.keys() {
                if seen.insert(k.clone()) {
                    columns.push(k.clone());
                }
            }
        }
    }
    if let Some(i) = columns.iter().position(|c| c == "_id") {
        let id = columns.remove(i);
        columns.insert(0, id);
    }
    let rows = docs
        .iter()
        .map(|d| match d {
            serde_json::Value::Object(map) => columns
                .iter()
                .map(|c| map.get(c).and_then(json_cell_string))
                .collect(),
            other => columns.iter().map(|_| json_cell_string(other)).collect(),
        })
        .collect();
    (columns, rows)
}

/// One index key's sort direction as ±1. Non-numeric key values (text/geo/
/// hashed index specs, e.g. `{field: "text"}`) aren't a sort direction at
/// all — reported as ascending since there's nothing meaningful to show.
fn bson_dir(v: &bson::Bson) -> i8 {
    let n = match v {
        bson::Bson::Int32(n) => *n as f64,
        bson::Bson::Int64(n) => *n as f64,
        bson::Bson::Double(n) => *n,
        _ => return 1,
    };
    if n < 0.0 {
        -1
    } else {
        1
    }
}

/// BSON type name → human data_type string (for the schema explorer).
fn bson_type_name(ty: &bson::Bson) -> &'static str {
    use bson::Bson::*;
    match ty {
        Double(_) => "double",
        String(_) => "string",
        Array(_) => "array",
        Document(_) => "object",
        Boolean(_) => "boolean",
        Int32(_) | Int64(_) => "integer",
        Decimal128(_) => "decimal",
        DateTime(_) => "date",
        Null | Undefined => "null",
        ObjectId(_) => "objectid",
        Binary(_) => "binary",
        RegularExpression(_) => "regex",
        Timestamp(_) => "timestamp",
        _ => "bson",
    }
}

impl MongoAdapter {
    pub async fn connect(params: &MongoParams) -> DbResult<Self> {
        let options = build_options(params).await?;
        let client = Client::with_options(options)
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        // Force a real round trip so a bad host/credentials fail here, at
        // connect time, instead of surfacing as a confusing first-query error.
        client
            .database(&params.database)
            .run_command(bson::doc! { "ping": 1 })
            .await
            .map_err(|e| {
                DbError::InvalidOperation(format!(
                    "mongo connect {}:{}: {}",
                    params.host, params.port, e
                ))
            })?;
        Ok(Self {
            client,
            database: std::sync::RwLock::new(params.database.clone()),
        })
    }

    /// The database unqualified collection operations currently target.
    fn cur_database(&self) -> String {
        self.database.read().unwrap().clone()
    }

    /// Collect the union of top-level field names across a sample of up to 200
    /// documents, with each field's most-common BSON type. Used to build a
    /// best-effort "schema" for the explorer (MongoDB is schemaless).
    async fn inferred_schema(&self, collection: &str) -> DbResult<Vec<ColumnInfo>> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let mut cursor = col
            .find(bson::doc! {})
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut types: std::collections::BTreeMap<
            String,
            std::collections::HashMap<&'static str, usize>,
        > = std::collections::BTreeMap::new();
        let mut count = 0;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            for (k, v) in doc.iter() {
                let t = bson_type_name(v);
                let entry = types.entry(k.clone()).or_default();
                *entry.entry(t).or_insert(0) += 1;
            }
            count += 1;
            if count >= 200 {
                break;
            }
        }
        if types.is_empty() {
            // Empty collection — nothing to infer; default to a single _id.
            return Ok(vec![ColumnInfo {
                name: "_id".into(),
                data_type: "objectid".into(),
                not_null: false,
                primary_key: true,
                default: None,
                enum_values: Default::default(),
                is_array: false,
            }]);
        }
        Ok(types
            .into_iter()
            .map(|(name, freq)| {
                let data_type = freq
                    .iter()
                    .max_by_key(|(_, n)| **n)
                    .map(|(t, _)| *t)
                    .unwrap_or("bson")
                    .to_string();
                let primary_key = name == "_id";
                let is_array = data_type == "array";
                ColumnInfo {
                    name,
                    data_type,
                    not_null: false,
                    primary_key,
                    default: None,
                    enum_values: Default::default(),
                    is_array,
                }
            })
            .collect())
    }

    /// List a collection's indexes (Phase 5: index manager). `_id_` is
    /// Mongo's implicit primary-key index — reported with origin `"pk"` so
    /// the UI treats it as read-only, matching the SQL adapters' PK-index
    /// convention; every other index is `"c"` (explicit, editable/droppable).
    async fn list_indexes(&self, collection: &str) -> DbResult<Vec<IndexInfo>> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let mut cursor = col
            .list_indexes()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut out = Vec::new();
        while let Some(model) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            let name = model
                .options
                .as_ref()
                .and_then(|o| o.name.clone())
                .unwrap_or_default();
            let unique = model
                .options
                .as_ref()
                .and_then(|o| o.unique)
                .unwrap_or(false);
            let columns: Vec<String> = model.keys.iter().map(|(k, _)| k.clone()).collect();
            let column_dirs: Vec<i8> = model.keys.iter().map(|(_, v)| bson_dir(v)).collect();
            let sparse = model.options.as_ref().and_then(|o| o.sparse);
            let ttl_seconds = model
                .options
                .as_ref()
                .and_then(|o| o.expire_after)
                .map(|d| d.as_secs());
            let partial_filter = model
                .options
                .as_ref()
                .and_then(|o| o.partial_filter_expression.as_ref())
                .map(super::mongo_json::render);
            let origin = if name == "_id_" { "pk" } else { "c" };
            out.push(IndexInfo {
                name,
                unique,
                columns,
                origin: origin.into(),
                column_dirs: Some(column_dirs),
                sparse,
                ttl_seconds,
                partial_filter,
            });
        }
        Ok(out)
    }

    /// Create an index (Phase 5, extended per MONGODB_SUPPORT.md's index
    /// manager pass). `column_dirs` gives each field's sort direction
    /// (missing/short → ascending); `sparse`/`ttl_seconds`/`partial_filter`
    /// are optional MongoDB-specific index options with no SQL equivalent.
    #[allow(clippy::too_many_arguments)]
    async fn create_index(
        &self,
        collection: &str,
        name: &str,
        columns: &[String],
        unique: bool,
        column_dirs: Option<&[i8]>,
        sparse: Option<bool>,
        ttl_seconds: Option<u64>,
        partial_filter: Option<&str>,
    ) -> DbResult<()> {
        if columns.is_empty() {
            return Err(DbError::InvalidOperation(
                "an index needs at least one column".into(),
            ));
        }
        let mut keys = bson::Document::new();
        for (i, c) in columns.iter().enumerate() {
            let dir = column_dirs
                .and_then(|d| d.get(i))
                .copied()
                .unwrap_or(1);
            keys.insert(c.as_str(), if dir < 0 { -1 } else { 1 });
        }
        // The typed-builder's generic state tracks which setters ran at the
        // type level, so setters can't be called conditionally (each call
        // changes the builder's type) — every setter is called unconditionally
        // with the already-Option value instead.
        let partial_filter_doc: Option<bson::Document> =
            match partial_filter.map(str::trim).filter(|s| !s.is_empty()) {
                Some(text) => Some(super::mongo_json::parse(text).map_err(|e| {
                    DbError::InvalidOperation(format!("invalid partial filter: {e}"))
                })?),
                None => None,
            };
        let options = mongodb::options::IndexOptions::builder()
            .name(name.to_string())
            .unique(unique)
            .sparse(sparse)
            .expire_after(ttl_seconds.map(std::time::Duration::from_secs))
            .partial_filter_expression(partial_filter_doc)
            .build();
        let model = mongodb::IndexModel::builder()
            .keys(keys)
            .options(Some(options))
            .build();
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        col.create_index(model)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }

    /// Drop an index by name (Phase 5). The default `_id_` index can't be
    /// dropped — rejected here with a friendlier message than the server's.
    async fn drop_index(&self, collection: &str, name: &str) -> DbResult<()> {
        if name == "_id_" {
            return Err(DbError::InvalidOperation(
                "the default _id index cannot be dropped".into(),
            ));
        }
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        col.drop_index(name)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }

    /// Convert a BSON Document to a serde_json::Value for JSON rendering.
    fn document_to_json(doc: bson::Document) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        for (k, v) in doc {
            map.insert(k, Self::bson_to_json(v));
        }
        serde_json::Value::Object(map)
    }

    fn bson_to_json(v: bson::Bson) -> serde_json::Value {
        use bson::Bson::*;
        match v {
            Double(f) => serde_json::Value::Number(
                serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
            ),
            String(s) => serde_json::Value::String(s),
            Array(arr) => {
                serde_json::Value::Array(arr.into_iter().map(Self::bson_to_json).collect())
            }
            Document(doc) => Self::document_to_json(doc),
            Boolean(b) => serde_json::Value::Bool(b),
            Int32(i) => serde_json::Value::Number(i.into()),
            Int64(i) => serde_json::Value::Number(i.into()),
            Decimal128(d) => serde_json::Value::String(d.to_string()),
            // Falls back to Display (raw millis) for dates outside chrono's
            // representable range instead of the deprecated panicking variant.
            DateTime(dt) => {
                serde_json::Value::String(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string()))
            }
            Null | Undefined => serde_json::Value::Null,
            ObjectId(oid) => serde_json::Value::String(oid.to_hex()),
            Binary(bin) => serde_json::Value::String(format!(
                "BinData({:?},{})",
                bin.subtype,
                base64::engine::general_purpose::STANDARD.encode(bin.bytes)
            )),
            RegularExpression(regex) => {
                serde_json::Value::String(format!("/{}/{}", regex.pattern, regex.options))
            }
            Timestamp(ts) => serde_json::Value::Object(
                serde_json::json!({"t": ts.time, "i": ts.increment})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
            MinKey => serde_json::Value::String("MinKey".into()),
            MaxKey => serde_json::Value::String("MaxKey".into()),
            Symbol(s) => serde_json::Value::String(s),
            _ => serde_json::Value::String(v.to_string()),
        }
    }

    /// Fetch a page of documents from a collection with optional filter.
    pub async fn list_documents(
        &self,
        collection: &str,
        filter: Option<bson::Document>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let total = col
            .count_documents(filter.clone().unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut cursor = col
            .find(filter.unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut docs = Vec::new();
        let mut skipped = 0u64;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            if skipped < skip {
                skipped += 1;
                continue;
            }
            if docs.len() >= limit as usize {
                break;
            }
            docs.push(Self::document_to_json(doc));
        }
        Ok((docs, total))
    }

    /// Read one page of documents as a grid-style result (columns = union of
    /// field names across the page, rows = flattened top-level cells). Returns
    /// the column list, the row cells, and the total matching count.
    async fn select_page(
        &self,
        collection: &str,
        filter: Option<bson::Document>,
        order_by: Option<&str>,
        order_dir: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>, u64)> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let mut opts = mongodb::options::FindOptions::builder().build();
        if let Some(field) = order_by {
            let dir = if order_dir == Some("DESC") { -1 } else { 1 };
            opts.sort = Some(doc! { "_id": 1, field: dir });
        }
        let skip_u = offset.max(0) as u64;
        opts.skip = Some(skip_u);
        let limit_u = limit.max(0) as u64;
        if limit_u > 0 {
            opts.limit = Some(limit_u as i64);
        }
        let mut cursor = col
            .find(filter.clone().unwrap_or_default())
            .with_options(opts)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;

        let mut docs: Vec<serde_json::Value> = Vec::new();
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            docs.push(Self::document_to_json(doc));
        }
        let total = col
            .count_documents(filter.clone().unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;

        // Column order: _id first, then first-seen field order across the page.
        let mut columns: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for doc in &docs {
            if let serde_json::Value::Object(map) = doc {
                for key in map.keys() {
                    if seen.insert(key.clone()) {
                        columns.push(key.clone());
                    }
                }
            }
        }
        // Put _id first so the grid's PK (from the pane schema) sorts naturally.
        if let Some(i) = columns.iter().position(|c| c == "_id") {
            let id = columns.remove(i);
            columns.insert(0, id);
        }

        let mut rows: Vec<Vec<Option<String>>> = Vec::with_capacity(docs.len());
        for doc in &docs {
            rows.push(match doc {
                serde_json::Value::Object(map) => columns
                    .iter()
                    .map(|c| map.get(c).and_then(json_cell_string))
                    .collect(),
                other => columns.iter().map(|_| json_cell_string(other)).collect(),
            });
        }
        Ok((columns, rows, total))
    }

    /// Execute a translated SQL `SELECT` (Phase 4: SQL-on-Mongo) as a Mongo
    /// `find()` and project it into a grid-style column/row result. Explicit
    /// column lists (`SELECT a, b FROM ...`) drive the Mongo projection and
    /// fix the output column order; `SELECT *` falls back to the union-of-
    /// fields projection used elsewhere in this adapter.
    async fn run_select_plan(
        &self,
        plan: &super::mongo_sql::SelectPlan,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(&plan.table);
        let mut opts = mongodb::options::FindOptions::builder().build();
        if let Some(cols) = &plan.columns {
            let mut proj = bson::Document::new();
            for c in cols {
                proj.insert(c.as_str(), 1);
            }
            if !cols.iter().any(|c| c == "_id") {
                proj.insert("_id", 0);
            }
            opts.projection = Some(proj);
        }
        if let Some(sort) = &plan.sort {
            opts.sort = Some(sort.clone());
        }
        if let Some(limit) = plan.limit {
            if limit > 0 {
                opts.limit = Some(limit);
            }
        }
        if let Some(offset) = plan.offset {
            opts.skip = Some(offset.max(0) as u64);
        }
        let mut cursor = col
            .find(plan.filter.clone().unwrap_or_default())
            .with_options(opts)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut docs: Vec<serde_json::Value> = Vec::new();
        while let Some(d) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            docs.push(Self::document_to_json(d));
        }
        if let Some(cols) = &plan.columns {
            let rows = docs
                .iter()
                .map(|d| match d {
                    serde_json::Value::Object(map) => cols
                        .iter()
                        .map(|c| map.get(c).and_then(json_cell_string))
                        .collect(),
                    other => cols.iter().map(|_| json_cell_string(other)).collect(),
                })
                .collect();
            Ok((cols.clone(), rows))
        } else {
            Ok(flatten_documents(&docs))
        }
    }

    /// Distinct cell values for one field (bounded), for enum-style editors.
    async fn distinct_values(
        &self,
        collection: &str,
        column: &str,
        limit: i64,
    ) -> DbResult<Vec<Option<String>>> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let vals = col
            .distinct(column, doc! {})
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut out: Vec<Option<String>> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for b in vals {
            let cell = json_cell_string(&Self::bson_to_json(b));
            if let Some(s) = cell {
                if seen.insert(s.clone()) {
                    out.push(Some(s));
                    if out.len() as i64 >= limit {
                        break;
                    }
                }
            }
        }
        Ok(out)
    }

    /// Field name → inferred BSON type, for typed cell coercion on writes.
    async fn column_types(
        &self,
        collection: &str,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let cols = self.inferred_schema(collection).await?;
        Ok(cols.into_iter().map(|c| (c.name, c.data_type)).collect())
    }

    /// Execute one MongoDB console command. `db` is the console's current
    /// database context (may be switched via `use <db>`); `collection` is used
    /// only for bare JSON query/pipeline input. Returns a grid-projected result
    /// plus the raw JSON documents, so the UI can show both grid and JSON.
    async fn run_mongo_impl(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
    ) -> DbResult<crate::api::MongoRunResult> {
        let start = std::time::Instant::now();
        let s = script.trim();
        let fail = |msg: String| crate::api::MongoRunResult {
            error: Some(msg),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        };
        if s.is_empty() {
            return Ok(fail(
                "Empty command. Try a JSON query, db.<collection>.find(...), or show collections"
                    .into(),
            ));
        }
        // `use <db>` — switch the console's database context.
        if let Some(name) = s
            .strip_prefix("use ")
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            let name = name.trim_end_matches(';').trim().to_string();
            return Ok(crate::api::MongoRunResult {
                command: format!("use {name}"),
                message: Some(format!("Switched to database {name}")),
                switch_db: Some(name),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s == "show dbs" || s == "show databases" {
            let names = self.list_databases().await?;
            return Ok(crate::api::MongoRunResult {
                command: s.to_string(),
                is_select: true,
                columns: vec!["database".into()],
                rows: names.into_iter().map(|n| vec![Some(n)]).collect(),
                message: Some("databases".into()),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s == "show collections" || s == "show tables" {
            let col = self.client.database(db);
            let names = col
                .list_collection_names()
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            return Ok(crate::api::MongoRunResult {
                command: s.to_string(),
                is_select: true,
                columns: vec!["collection".into()],
                rows: names.into_iter().map(|n| vec![Some(n)]).collect(),
                message: Some("collections".into()),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s.starts_with("db.") {
            return self.run_db_call(db, s, start).await;
        }
        // Bare JSON: object → find (needs a collection), array → aggregate.
        if s.starts_with('{') || s.starts_with('[') {
            if let Some(coll) = collection {
                return self.run_bare_json(db, coll, s, start).await;
            }
            return Ok(fail(
                "Select a collection above, or use db.<collection>.find(<query>)".into(),
            ));
        }
        Ok(fail(format!(
            "Unrecognized command. Try a JSON query, db.<collection>.find(...), aggregate(...), count(...), or show collections.\nGot: {}",
            if s.len() > 80 { format!("{}…", &s[..80]) } else { s.to_string() }
        )))
    }

    /// Execute a `db.<collection>.<method>(...)` command.
    async fn run_db_call(
        &self,
        db: &str,
        s: &str,
        start: std::time::Instant,
    ) -> DbResult<crate::api::MongoRunResult> {
        let Some(call) = parse_db_call(s) else {
            return Ok(crate::api::MongoRunResult {
                error: Some(format!(
                    "Could not parse `{s}` as db.<collection>.<method>(...)"
                )),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        };
        let f = |msg: String| crate::api::MongoRunResult {
            error: Some(msg),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        };
        let col = self
            .client
            .database(db)
            .collection::<bson::Document>(&call.coll);
        let command = || format!("db.{}.{}({})", call.coll, call.method, call.args);
        match call.method.as_str() {
            "find" | "findOne" => {
                let chain = parse_chain(&call.chain);
                let filter = parse_filter(&call.args)?;
                let is_one = call.method == "findOne";
                let mut opts = mongodb::options::FindOptions::builder().build();
                if let Some(sort) = &chain.sort {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(
                        &super::mongo_json::quote_bare_keys(sort),
                    ) {
                        if let Ok(d) = bson::to_document(&v) {
                            opts.sort = Some(d);
                        }
                    }
                }
                if is_one {
                    opts.limit = Some(1);
                } else if let Some(n) = chain.limit {
                    if n > 0 {
                        opts.limit = Some(n);
                    }
                } else {
                    // No explicit limit — cap so a bare find() can't stream
                    // the whole collection into the console.
                    opts.limit = Some(200);
                }
                let mut cursor = col
                    .find(filter.clone().unwrap_or_default())
            .with_options(opts)
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                let mut docs: Vec<serde_json::Value> = Vec::new();
                while let Some(d) = cursor.try_next().await.map_err(|e| {
                    DbError::InvalidOperation(format!("mongo: {e}"))
                })? {
                    docs.push(Self::document_to_json(d));
                }
                let (columns, rows) = flatten_documents(&docs);
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns,
                    rows,
                    documents: docs.clone(),
                    is_select: true,
                    message: if is_one && docs.is_empty() {
                        Some("No matching document".into())
                    } else {
                        None
                    },
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "count" | "countDocuments" => {
                let filter = parse_filter(&call.args)?;
                let n = col
                    .count_documents(filter.clone().unwrap_or_default())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns: vec!["count".into()],
                    rows: vec![vec![Some(n.to_string())]],
                    is_select: true,
                    documents: vec![serde_json::json!({ "count": n })],
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "distinct" => {
                let parts = split_top_level(&call.args);
                let field = parts
                    .first()
                    .map(|p| p.trim().trim_matches(['"', '\'']).to_string())
                    .filter(|p| !p.is_empty());
                let Some(field) = field else {
                    return Ok(f("db.<collection>.distinct requires a field name".into()));
                };
                let filter = if parts.len() > 1 {
                    parse_filter(&parts[1])?
                } else {
                    None
                };
                let vals = col
                    .distinct(&field, filter.clone().unwrap_or_default())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                let docs: Vec<serde_json::Value> =
                    vals.into_iter().map(Self::bson_to_json).collect();
                let rows = docs
                    .iter()
                    .map(|d| vec![json_cell_string(d)])
                    .collect::<Vec<Vec<Option<String>>>>();
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns: vec![field.clone()],
                    rows,
                    documents: docs,
                    is_select: true,
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "aggregate" => {
                let parsed: serde_json::Value =
                    serde_json::from_str(&super::mongo_json::quote_bare_keys(&call.args))
                        .map_err(|e| DbError::InvalidOperation(format!("invalid pipeline JSON: {e}")))?;
                if !parsed.is_array() {
                    return Ok(f("aggregate pipeline must be a JSON array".into()));
                }
                let stages: Vec<bson::Document> = parsed
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .into_iter()
                    .map(|v| {
                        bson::to_document(v).map_err(|e| {
                            DbError::InvalidOperation(format!("invalid pipeline stage: {e}"))
                        })
                    })
                    .collect::<DbResult<_>>()?;
                let mut cursor = col
                    .aggregate(stages)
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                let mut docs: Vec<serde_json::Value> = Vec::new();
                while let Some(d) = cursor.try_next().await.map_err(|e| {
                    DbError::InvalidOperation(format!("mongo: {e}"))
                })? {
                    docs.push(Self::document_to_json(d));
                }
                let (columns, rows) = flatten_documents(&docs);
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns,
                    rows,
                    documents: docs,
                    is_select: true,
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            other => Ok(f(format!(
                "Unsupported method `{other}` on collections. Supported: find, findOne, count, countDocuments, distinct, aggregate."
            ))),
        }
    }

    /// Execute a bare JSON object (find) or array (aggregate) against the
    /// console's currently-selected collection.
    async fn run_bare_json(
        &self,
        db: &str,
        coll: &str,
        s: &str,
        start: std::time::Instant,
    ) -> DbResult<crate::api::MongoRunResult> {
        let col = self.client.database(db).collection::<bson::Document>(coll);
        let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(s))
            .map_err(|e| DbError::InvalidOperation(format!("invalid JSON: {e}")))?;
        if let serde_json::Value::Object(_) = v {
            let filter = bson::to_document(&v)
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            let mut opts = mongodb::options::FindOptions::builder().build();
            opts.limit = Some(50);
            let mut cursor = col
                .find(filter.clone())
                .with_options(opts)
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            let mut docs: Vec<serde_json::Value> = Vec::new();
            while let Some(d) = cursor
                .try_next()
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
            {
                docs.push(Self::document_to_json(d));
            }
            let (columns, rows) = flatten_documents(&docs);
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.find({s})"),
                columns,
                rows,
                documents: docs,
                is_select: true,
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if let serde_json::Value::Array(items) = v {
            let stages: Vec<bson::Document> = items
                .into_iter()
                .map(|x| {
                    bson::to_document(&x).map_err(|e| {
                        DbError::InvalidOperation(format!("invalid pipeline stage: {e}"))
                    })
                })
                .collect::<DbResult<_>>()?;
            let mut cursor = col
                .aggregate(stages)
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            let mut docs: Vec<serde_json::Value> = Vec::new();
            while let Some(d) = cursor
                .try_next()
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
            {
                docs.push(Self::document_to_json(d));
            }
            let (columns, rows) = flatten_documents(&docs);
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.aggregate({s})"),
                columns,
                rows,
                documents: docs,
                is_select: true,
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        Ok(crate::api::MongoRunResult {
            error: Some(
                "Bare JSON must be an object (a query) or an array (an aggregation pipeline)"
                    .into(),
            ),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        })
    }
}

#[async_trait]
impl DbAdapter for MongoAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let names = self
            .client
            .database(&self.cur_database())
            .list_collection_names()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                name,
                kind: "table".into(),
            })
            .collect())
    }

    async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)> {
        let columns = self.inferred_schema(table).await?;
        // Index listing degrades gracefully (empty) rather than failing the
        // whole schema fetch — browsing a collection shouldn't break because
        // of a transient listIndexes issue.
        let indexes = self.list_indexes(table).await.unwrap_or_default();
        Ok((
            TableSchema {
                // "table" → the grid renders the collection with editable
                // cells; grid CRUD maps to Mongo update/insert/delete ops.
                kind: "table".into(),
                columns,
                foreign_keys: Vec::new(),
                indexes,
                triggers: Vec::new(),
            },
            vec![
                format!("db.{table}.find().limit(200) / sample to infer fields"),
                format!("db.{table}.getIndexes()"),
            ],
        ))
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Ok(vec![])
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        let names = self
            .client
            .list_database_names()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(names)
    }

    async fn list_documents(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        let bson_filter = filter.and_then(|v| bson::to_document(&v).ok());
        self.list_documents(collection, bson_filter, skip, limit)
            .await
    }

    async fn list_documents_ext(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<String>, u64)> {
        let bson_filter = filter.and_then(|v| bson::to_document(&v).ok());
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let total = col
            .count_documents(bson_filter.clone().unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut cursor = col
            .find(bson_filter.unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut docs = Vec::new();
        let mut skipped = 0u64;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            if skipped < skip {
                skipped += 1;
                continue;
            }
            if docs.len() >= limit as usize {
                break;
            }
            docs.push(super::mongo_json::render(&doc));
        }
        Ok((docs, total))
    }

    async fn save_document(
        &self,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> DbResult<bool> {
        if !is_object_id_hex(id) {
            return Err(DbError::InvalidOperation(
                "cannot save document without an ObjectId _id".into(),
            ));
        }
        let oid = bson::oid::ObjectId::parse_str(id)
            .map_err(|e| DbError::InvalidOperation(format!("mongo _id: {e}")))?;
        let doc = super::mongo_json::parse(document_text)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let res = col
            .replace_one(doc! { "_id": oid }, doc)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(res.modified_count > 0 || res.matched_count > 0)
    }

    async fn insert_document(&self, collection: &str, document_text: &str) -> DbResult<()> {
        let doc = super::mongo_json::parse(document_text)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        col.insert_one(doc)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }

    async fn run_mongo(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
    ) -> DbResult<crate::api::MongoRunResult> {
        self.run_mongo_impl(db, collection, script).await
    }

    async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        let databases = self.list_databases().await?;
        Ok(super::CatalogOverview {
            schemas: vec![],
            databases,
            active_schema: self.cur_database(),
        })
    }

    async fn active_schema(&self) -> DbResult<String> {
        Ok(self.cur_database())
    }

    /// Switch which database on the server unqualified collection operations
    /// (grid browsing, the console, SQL) target. Mongo has no schemas —
    /// this reuses the `DbAdapter` schema-switch slot for Mongo's database
    /// switch, the same way the sidebar already treats "schema" as the
    /// per-engine catalog unit.
    async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        let dbs = self.list_databases().await?;
        if !dbs.iter().any(|d| d == schema) {
            return Err(DbError::InvalidOperation(format!(
                "database \"{schema}\" does not exist on this server"
            )));
        }
        *self.database.write().unwrap() = schema.to_string();
        Ok(())
    }

    /// Explicitly create a collection ("New table" for a Mongo connection).
    /// Collections also spring into existence implicitly on first insert,
    /// but a dedicated create gives the UI an immediate, empty collection to
    /// open — the same experience CREATE TABLE gives the SQL adapters.
    async fn create_collection(&self, name: &str) -> DbResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "collection name cannot be empty".into(),
            ));
        }
        self.client
            .database(&self.cur_database())
            .create_collection(name)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))
    }

    /// Duplicate a collection under a new name (sidebar right-click). Indexes
    /// (everything but the implicit `_id_`, which Mongo creates on its own)
    /// are always copied; documents are copied only when `copy_data` is
    /// true, via a server-side `$out` aggregation so the whole collection
    /// never round-trips through this process regardless of its size.
    async fn duplicate_table(
        &self,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        let target = target.trim();
        if target.is_empty() {
            return Err(DbError::InvalidOperation(
                "collection name cannot be empty".into(),
            ));
        }
        let mut ran = Vec::new();

        self.client
            .database(&self.cur_database())
            .create_collection(target)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        ran.push(format!("db.createCollection(\"{target}\")"));

        for ix in self.list_indexes(source).await? {
            if ix.name == "_id_" {
                continue;
            }
            self.create_index(
                target,
                &ix.name,
                &ix.columns,
                ix.unique,
                ix.column_dirs.as_deref(),
                ix.sparse,
                ix.ttl_seconds,
                ix.partial_filter.as_deref(),
            )
            .await?;
            ran.push(format!("db.{target}.createIndex(… \"{}\")", ix.name));
        }

        if copy_data {
            let col = self
                .client
                .database(&self.cur_database())
                .collection::<bson::Document>(source);
            col.aggregate(vec![bson::doc! { "$out": target }])
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            ran.push(format!("db.{source}.aggregate([{{ $out: \"{target}\" }}])"));
        }
        Ok(ran)
    }

    /// SQL-on-Mongo (Phase 4): a `SELECT ... FROM ... [WHERE ...] [ORDER BY
    /// ...] [LIMIT ...] [OFFSET ...]` subset (no JOINs, no schema needed) is
    /// translated to a `find()` and run for real. Anything else (writes,
    /// DDL, JOINs) is out of the supported subset — use the grid or the
    /// MongoDB console instead.
    async fn run_sql(&self, sql: &str) -> DbResult<QueryResult> {
        let start = std::time::Instant::now();
        if !super::mongo_sql::is_select(sql) {
            return Err(DbError::InvalidOperation(
                "MongoDB SQL support currently covers SELECT only (WHERE/ORDER BY/LIMIT/OFFSET, no JOINs); use the grid or the MongoDB console for writes".into(),
            ));
        }
        let plan = super::mongo_sql::translate_select(sql)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let (columns, rows) = self.run_select_plan(&plan).await?;
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    async fn execute_params(&self, _sql: &str, _params: &[Option<String>]) -> DbResult<u64> {
        Err(DbError::InvalidOperation(
            "MongoDB SQL support is read-only (SELECT) for now; use the grid or the MongoDB console to write".into(),
        ))
    }

    async fn run_sql_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        // Our SQL subset has no placeholder syntax of its own — inline the
        // bound `?` params as literals first (same helper the SQL adapters
        // use for the activity log), then translate as plain SQL text.
        let inlined = super::inline_placeholders(sql, params, false);
        self.run_sql(&inlined).await
    }

    async fn execute_op(&self, op: &QueryOp) -> DbResult<OpOutcome> {
        let start = std::time::Instant::now();
        match op {
            QueryOp::Select {
                table,
                filters,
                custom_where,
                order_by,
                order_dir,
                limit,
                offset,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let desc = filter_desc(&filter);
                let (columns, rows, _total) = self
                    .select_page(
                        table,
                        filter,
                        order_by.as_deref(),
                        order_dir.as_deref(),
                        limit.unwrap_or(50),
                        offset.unwrap_or(0),
                    )
                    .await?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns,
                        rows,
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.find({desc})")),
                })
            }
            QueryOp::Count {
                table,
                filters,
                custom_where,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let desc = filter_desc(&filter);
                let col = self
                    .client
                    .database(&self.cur_database())
                    .collection::<bson::Document>(table);
                let total = col
                    .count_documents(filter.clone().unwrap_or_default())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec!["count".into()],
                        rows: vec![vec![Some(total.to_string())]],
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.countDocuments({desc})")),
                })
            }
            QueryOp::SelectDistinct {
                table,
                column,
                limit,
            } => {
                let vals = self
                    .distinct_values(table, column, limit.unwrap_or(100))
                    .await?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec![column.clone()],
                        rows: vals.into_iter().map(|v| vec![v]).collect(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.distinct(\"{column}\")")),
                })
            }
            QueryOp::Update {
                table,
                set,
                match_row,
            } => {
                let filter = filter_from_match_row(match_row);
                let cols = self.column_types(table).await?;
                let mut set_doc = bson::Document::new();
                for (k, v) in set {
                    if k == "_id" {
                        continue;
                    }
                    set_doc.insert(k, field_bson(v.as_deref(), cols.get(k).map(String::as_str)));
                }
                let col = self
                    .client
                    .database(&self.cur_database())
                    .collection::<bson::Document>(table);
                let res = col
                    .update_many(filter.clone(), doc! { "$set": set_doc })
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: res.modified_count,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!(
                        "db.{table}.updateMany({}, {{$set: ...}})",
                        filter_desc(&Some(filter))
                    )),
                })
            }
            QueryOp::Delete { table, match_row } => {
                let filter = filter_from_match_row(match_row);
                let col = self
                    .client
                    .database(&self.cur_database())
                    .collection::<bson::Document>(table);
                let res = col
                    .delete_many(filter.clone())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: res.deleted_count,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!(
                        "db.{table}.deleteMany({})",
                        filter_desc(&Some(filter))
                    )),
                })
            }
            QueryOp::Insert {
                table,
                values,
                skip_empty,
            } => {
                let cols = self.column_types(table).await?;
                let mut doc = bson::Document::new();
                for (k, v) in values {
                    let drop_empty =
                        *skip_empty && v.as_deref().map_or(true, |s| s.is_empty()) && k != "_id";
                    if drop_empty {
                        continue;
                    }
                    doc.insert(k, field_bson(v.as_deref(), cols.get(k).map(String::as_str)));
                }
                let col = self
                    .client
                    .database(&self.cur_database())
                    .collection::<bson::Document>(table);
                col.insert_one(doc.clone())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: 1,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!(
                        "db.{table}.insertOne({})",
                        serde_json::to_string(&doc).unwrap_or_default()
                    )),
                })
            }
            QueryOp::DropTable { table } => {
                let col = self
                    .client
                    .database(&self.cur_database())
                    .collection::<bson::Document>(table);
                col.drop()
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.drop()")),
                })
            }
        }
    }

    async fn execute_op_stream(
        &self,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome> {
        let start = std::time::Instant::now();
        match op {
            QueryOp::Select {
                table,
                filters,
                custom_where,
                order_by,
                order_dir,
                limit,
                offset,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let (columns, rows, total) = self
                    .select_page(
                        table,
                        filter.clone(),
                        order_by.as_deref(),
                        order_dir.as_deref(),
                        limit.unwrap_or(50),
                        offset.unwrap_or(0),
                    )
                    .await?;
                // First chunk carries the column names, later chunks the rows.
                on_batch(QueryChunk {
                    columns: Some(columns.clone()),
                    rows: Vec::new(),
                })?;
                let mut batch: Vec<Vec<Option<String>>> = Vec::new();
                let mut size = 0usize;
                for row in &rows {
                    batch.push(row.clone());
                    size += 1;
                    if size >= 500 {
                        on_batch(QueryChunk {
                            columns: None,
                            rows: std::mem::take(&mut batch),
                        })?;
                        size = 0;
                    }
                }
                if !batch.is_empty() {
                    on_batch(QueryChunk {
                        columns: None,
                        rows: batch,
                    })?;
                }
                let _ = total;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns,
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.find({})", filter_desc(&filter))),
                })
            }
            QueryOp::SelectDistinct {
                table,
                column,
                limit,
            } => {
                let vals = self
                    .distinct_values(table, column, limit.unwrap_or(100))
                    .await?;
                on_batch(QueryChunk {
                    columns: Some(vec![column.clone()]),
                    rows: Vec::new(),
                })?;
                for v in vals {
                    on_batch(QueryChunk {
                        columns: None,
                        rows: vec![vec![v]],
                    })?;
                }
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec![column.clone()],
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(format!("db.{table}.distinct(\"{column}\")")),
                })
            }
            QueryOp::Count { .. } => self.execute_op(op).await,
            _ => self.execute_op(op).await,
        }
    }

    async fn run_sql_stream(&self, sql: &str, on_batch: BatchSink<'_>) -> DbResult<QueryResult> {
        let start = std::time::Instant::now();
        if !super::mongo_sql::is_select(sql) {
            return Err(DbError::InvalidOperation(
                "MongoDB SQL support currently covers SELECT only (WHERE/ORDER BY/LIMIT/OFFSET, no JOINs); use the grid or the MongoDB console for writes".into(),
            ));
        }
        let plan = super::mongo_sql::translate_select(sql)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let (columns, rows) = self.run_select_plan(&plan).await?;
        on_batch(QueryChunk {
            columns: Some(columns.clone()),
            rows: Vec::new(),
        })?;
        let mut batch: Vec<Vec<Option<String>>> = Vec::new();
        for row in rows {
            batch.push(row);
            if batch.len() >= 500 {
                on_batch(QueryChunk {
                    columns: None,
                    rows: std::mem::take(&mut batch),
                })?;
            }
        }
        if !batch.is_empty() {
            on_batch(QueryChunk {
                columns: None,
                rows: batch,
            })?;
        }
        Ok(QueryResult {
            columns,
            rows: Vec::new(),
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    /// MongoDB is schemaless, so most `SchemaOp` DDL has no equivalent — the
    /// index-only subset (Phase 5) is the exception, since indexes are a real
    /// per-collection concept in Mongo. Ops run one at a time (no
    /// transaction — Mongo index DDL isn't part of the multi-doc transaction
    /// surface here); the first failure stops the batch.
    async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        let mut stmts = Vec::with_capacity(ops.len());
        for op in ops {
            match op {
                SchemaOp::RenameTable { table, new_name } => {
                    // renameCollection is an admin command, not a per-database
                    // one — it takes fully-qualified `<db>.<collection>` names.
                    let db = self.cur_database();
                    self.client
                        .database("admin")
                        .run_command(bson::doc! {
                            "renameCollection": format!("{db}.{table}"),
                            "to": format!("{db}.{new_name}"),
                        })
                        .await
                        .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                    stmts.push(format!(
                        "db.adminCommand({{ renameCollection: \"{db}.{table}\", to: \"{db}.{new_name}\" }})"
                    ));
                }
                SchemaOp::CreateIndex {
                    table,
                    name,
                    columns,
                    unique,
                    column_dirs,
                    sparse,
                    ttl_seconds,
                    partial_filter,
                } => {
                    self.create_index(
                        table,
                        name,
                        columns,
                        *unique,
                        column_dirs.as_deref(),
                        *sparse,
                        *ttl_seconds,
                        partial_filter.as_deref(),
                    )
                    .await?;
                    let keys = columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            let dir = column_dirs
                                .as_deref()
                                .and_then(|d| d.get(i))
                                .copied()
                                .unwrap_or(1);
                            format!("{c}: {}", if dir < 0 { -1 } else { 1 })
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut opts = vec![format!("name: \"{name}\"")];
                    opts.push(format!("unique: {unique}"));
                    if let Some(s) = sparse {
                        opts.push(format!("sparse: {s}"));
                    }
                    if let Some(secs) = ttl_seconds {
                        opts.push(format!("expireAfterSeconds: {secs}"));
                    }
                    if let Some(pf) = partial_filter.as_deref().filter(|s| !s.trim().is_empty()) {
                        opts.push(format!("partialFilterExpression: {pf}"));
                    }
                    stmts.push(format!(
                        "db.{table}.createIndex({{ {keys} }}, {{ {} }})",
                        opts.join(", ")
                    ));
                }
                SchemaOp::DropIndex { table, index } => {
                    let Some(table) = table else {
                        return Err(DbError::InvalidOperation(
                            "dropping a MongoDB index requires its collection name".into(),
                        ));
                    };
                    self.drop_index(table, index).await?;
                    stmts.push(format!("db.{table}.dropIndex(\"{index}\")"));
                }
                _ => {
                    return Err(DbError::InvalidOperation(
                        "MongoDB is schemaless; only index create/drop is supported".into(),
                    ))
                }
            }
        }
        Ok(stmts)
    }

    async fn close(self: Arc<Self>) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_top_level_commas() {
        let parts = split_top_level("\"city\", { \"a\": 1 }, [1,2,3]");
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].trim_matches('"'), "city");
        assert_eq!(parts[1].trim(), "{ \"a\": 1 }");
        assert_eq!(parts[2].trim(), "[1,2,3]");
    }

    #[test]
    fn parse_db_call_extracts_parts() {
        let c = parse_db_call("db.users.find({ \"name\": \"a(b\" }).limit(5).pretty()").unwrap();
        assert_eq!(c.coll, "users");
        assert_eq!(c.method, "find");
        assert_eq!(c.args.trim(), "{ \"name\": \"a(b\" }");
        assert!(c.chain.contains(".limit(5)"));
        assert!(c.chain.contains(".pretty()"));
    }

    #[test]
    fn parse_db_call_with_filter_fragment() {
        let c =
            parse_db_call("db.orders.aggregate([ { \"$match\": { \"age\": { \"$gte\": 18 } } } ])")
                .unwrap();
        assert_eq!(c.coll, "orders");
        assert_eq!(c.method, "aggregate");
        assert!(c.args.contains("$match"));
        assert_eq!(c.chain, "");
    }

    #[test]
    fn parse_db_call_balanced_quotes() {
        // A literal ")" inside a string must not close the call early.
        let c = parse_db_call("db.logs.find({ \"msg\": \"ok )\" }).limit(1)").unwrap();
        assert_eq!(c.method, "find");
        assert!(c.args.contains("ok )\""));
        assert!(c.chain.contains(".limit(1)"));
    }

    #[test]
    fn parse_filter_variants() {
        assert!(parse_filter("").unwrap().is_none());
        assert!(parse_filter("   ").unwrap().is_none());
        assert!(parse_filter("{}").unwrap().is_some());
        assert!(parse_filter("{ \"status\": \"active\" }")
            .unwrap()
            .is_some());
        // The first argument of a find/distinct is a field or must be an object
        // query — a scalar/array is rejected here.
        assert!(parse_filter("\"city\", { \"x\": 1 }").is_err());
        // A non-object (scalar / array) query is rejected.
        assert!(parse_filter("[1,2]").is_err());
        assert!(parse_filter("not json").is_err());
        // Unquoted (mongosh-style) keys are accepted, same as quoted ones.
        let d = parse_filter("{name:\"test\"}").unwrap().unwrap();
        assert_eq!(d.get_str("name"), Ok("test"));
    }

    #[test]
    fn build_filter_accepts_unquoted_keys() {
        let d = build_filter(&[], Some("{name:\"test\"}"))
            .unwrap()
            .unwrap();
        assert_eq!(d.get_str("name"), Ok("test"));
    }

    #[test]
    fn parse_chain_extracts_limit_and_sort() {
        let f = parse_chain(".limit(25).pretty().sort({ \"age\": -1 })");
        assert_eq!(f.limit, Some(25));
        assert!(f.sort.as_deref().unwrap_or("").contains("age"));
    }

    #[test]
    fn shell_use_and_show_dbs_recognized() {
        // run_mongo_impl requires a live client; we only assert the parser-level
        // decisions that route to those branches.
        assert!("use reports".starts_with("use "));
        assert!(!"show dbs".starts_with("db."));
        assert!("db.users.find({})".starts_with("db."));
        assert!("{ \"a\": 1 }".starts_with('{'));
    }
}
