use std::time::Instant;
use bson::{doc, Bson, Document};
use crate::api::{PlanDialect, PlanMode, PlanResult};
use crate::db::explain::{finish, mongo::plan_from_mongo};
use crate::db::runs::until_abandoned;
use crate::db::{DbError, DbResult, RunHandle};
use super::MongoAdapter;
use super::cancel::{mongo_err, run_comment};
use super::console_guard::pipeline_refusal;
use super::console_parse::{parse_chain, parse_db_call, parse_filter, split_top_level, validate_chain};

const ACCEPTED: &str = "Explain works on find, aggregate, count and distinct commands, and on SELECT statements.";

/// What Explain wraps: the command to explain, or why there is none.
enum Built {
    Command(Document),
    Unsupported(String),
}

impl MongoAdapter {
    /// The plan of one console command. `queryPlanner` never runs it;
    /// `executionStats` (analyze) does, so a pipeline that writes is refused.
    /// Only reads are explainable, so a read only connection needs no check.
    pub(super) async fn explain_mongo(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> PlanResult {
        let mode = mode_of(analyze);
        let statement = script.trim();
        let built = match build_console_command(collection, statement) {
            Ok(built) => built,
            Err(message) => return PlanResult::failed(PlanDialect::Mongodb, mode, statement, message),
        };
        self.explain_built(db, built, analyze, statement, run).await
    }

    /// The plan of the `find` a SQL `SELECT` is translated to.
    pub(super) async fn explain_select(
        &self,
        database: Option<&str>,
        sql: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> PlanResult {
        let mode = mode_of(analyze);
        let statement = sql.trim();
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let sent = statement.trim_end_matches(';').trim_end();
        if !super::mongo_sql::is_select(sent) {
            return PlanResult::unsupported(PlanDialect::Mongodb, mode, statement, ACCEPTED.into());
        }
        let plan = match super::mongo_sql::translate_select(sent) {
            Ok(plan) => plan,
            Err(e) => return PlanResult::failed(PlanDialect::Mongodb, mode, statement, e.to_string()),
        };
        let mut find = doc! { "find": &plan.table, "filter": plan.filter.clone().unwrap_or_default() };
        if let Some(cols) = &plan.columns {
            let mut projection = Document::new();
            for c in cols {
                projection.insert(c.as_str(), 1);
            }
            if !cols.iter().any(|c| c == "_id") {
                projection.insert("_id", 0);
            }
            find.insert("projection", projection);
        }
        if let Some(sort) = &plan.sort {
            find.insert("sort", sort.clone());
        }
        if let Some(limit) = plan.limit.filter(|l| *l > 0) {
            find.insert("limit", limit);
        }
        if let Some(offset) = plan.offset {
            find.insert("skip", offset.max(0));
        }
        self.explain_built(&db, Built::Command(find), analyze, statement, run).await
    }

    async fn explain_built(
        &self,
        db: &str,
        built: Built,
        analyze: bool,
        statement: &str,
        run: Option<&RunHandle>,
    ) -> PlanResult {
        let mode = mode_of(analyze);
        let inner = match built {
            Built::Command(inner) => inner,
            Built::Unsupported(message) => {
                return PlanResult::unsupported(PlanDialect::Mongodb, mode, statement, message)
            }
        };
        if analyze {
            if let Some(stage) = writing_stage(&inner) {
                return PlanResult::failed(
                    PlanDialect::Mongodb,
                    mode,
                    statement,
                    format!("Explain Analyze runs the pipeline, and a {stage} stage would write. Use Explain instead."),
                );
            }
        }
        let start = Instant::now();
        let fetched = until_abandoned(run, self.fetch_explain(db, inner, analyze, run)).await;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        // Nothing left for a late Stop to reach once the call is over.
        if let Some(run) = run {
            run.finish().await;
        }
        let parsed = match fetched {
            Ok(reply) => plan_from_mongo(&reply, analyze),
            Err(DbError::Cancelled) => {
                return PlanResult::stopped(PlanDialect::Mongodb, mode, statement, elapsed_ms)
            }
            Err(e) => Err(e.to_string()),
        };
        match parsed {
            Ok(tops) => {
                let (root, truncated) = finish(tops);
                PlanResult::planned(PlanDialect::Mongodb, mode, statement, root, truncated, elapsed_ms)
            }
            Err(message) => PlanResult::failed(PlanDialect::Mongodb, mode, statement, message),
        }
    }

    /// Runs `explain` and returns the server's reply as relaxed JSON.
    async fn fetch_explain(
        &self,
        db: &str,
        inner: Document,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<serde_json::Value> {
        self.arm_kill_op(run).await?;
        let mut command = doc! {
            "explain": inner,
            "verbosity": if analyze { "executionStats" } else { "queryPlanner" },
        };
        if let Some(comment) = run_comment(run) {
            command.insert("comment", comment);
        }
        let reply = self
            .client
            .database(db)
            .run_command(command)
            .await
            .map_err(|e| mongo_err(e, run))?;
        Ok(Bson::Document(reply).into_relaxed_extjson())
    }
}

fn mode_of(analyze: bool) -> PlanMode {
    if analyze { PlanMode::Analyze } else { PlanMode::Estimate }
}

/// `$out` or `$merge` anywhere in an aggregate command's pipeline.
fn writing_stage(inner: &Document) -> Option<&'static str> {
    let pipeline = inner.get("pipeline")?;
    let text = Bson::clone(pipeline).into_relaxed_extjson().to_string();
    pipeline_refusal(&text).map(|r| if r.contains("$out") { "$out" } else { "$merge" })
}

/// Reads a console script into the command `explain` wraps. `Err` is a
/// script that could be understood as Explain's kind but is malformed.
fn build_console_command(collection: Option<&str>, script: &str) -> Result<Built, String> {
    let s = script.trim().trim_end_matches(';').trim();
    let unsupported = || Ok(Built::Unsupported(ACCEPTED.into()));
    if s.starts_with("db.") {
        let Some(call) = parse_db_call(s) else { return unsupported() };
        validate_chain(&call.chain).map_err(|e| e.to_string())?;
        return match call.method.as_str() {
            "find" | "findOne" => {
                let chain = parse_chain(&call.chain);
                let mut find = find_command(&call.coll, &call.args).map_err(|e| e.to_string())?;
                if let Some(sort) = chain.sort.as_deref().and_then(sort_document) {
                    find.insert("sort", sort);
                }
                if call.method == "findOne" {
                    find.insert("limit", 1i64);
                } else if let Some(n) = chain.limit.filter(|n| *n > 0) {
                    find.insert("limit", n);
                }
                Ok(Built::Command(find))
            }
            "count" | "countDocuments" => {
                let filter = parse_filter(&call.args).map_err(|e| e.to_string())?;
                Ok(Built::Command(doc! { "count": &call.coll, "query": filter.unwrap_or_default() }))
            }
            "estimatedDocumentCount" => Ok(Built::Command(doc! { "count": &call.coll })),
            "distinct" => {
                let parts = split_top_level(&call.args);
                let key = parts.first().map(|p| p.trim().trim_matches(['"', '\'']).to_string()).unwrap_or_default();
                if key.is_empty() {
                    return Err("db.<collection>.distinct requires a field name".into());
                }
                let query = match parts.get(1) {
                    Some(part) => parse_filter(part).map_err(|e| e.to_string())?,
                    None => None,
                };
                Ok(Built::Command(doc! { "distinct": &call.coll, "key": key, "query": query.unwrap_or_default() }))
            }
            "aggregate" => aggregate_command(&call.coll, &call.args).map(Built::Command),
            _ => unsupported(),
        };
    }
    // Bare JSON: an object is a find, an array is a pipeline.
    if s.starts_with('{') || s.starts_with('[') {
        let Some(collection) = collection else {
            return Ok(Built::Unsupported(
                "A bare query needs a collection. Use db.<collection>.find(<query>) instead.".into(),
            ));
        };
        if s.starts_with('[') {
            return aggregate_command(collection, s).map(Built::Command);
        }
        return find_command(collection, s).map(Built::Command).map_err(|e| e.to_string());
    }
    unsupported()
}

fn find_command(coll: &str, args: &str) -> DbResult<Document> {
    let filter = parse_filter(args)?;
    Ok(doc! { "find": coll, "filter": filter.unwrap_or_default() })
}

fn aggregate_command(coll: &str, args: &str) -> Result<Document, String> {
    let parsed: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(args))
        .map_err(|e| format!("invalid pipeline JSON: {e}"))?;
    let Some(items) = parsed.as_array() else {
        return Err("aggregate pipeline must be a JSON array".into());
    };
    let stages = items
        .iter()
        .map(|v| bson::to_document(v).map_err(|e| format!("invalid pipeline stage: {e}")))
        .collect::<Result<Vec<Document>, String>>()?;
    Ok(doc! { "aggregate": coll, "pipeline": stages, "cursor": {} })
}

fn sort_document(sort: &str) -> Option<Document> {
    let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(sort)).ok()?;
    bson::to_document(&v).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(script: &str, collection: Option<&str>) -> Document {
        match build_console_command(collection, script).unwrap() {
            Built::Command(c) => c,
            Built::Unsupported(m) => panic!("unsupported: {m}"),
        }
    }

    fn unsupported(script: &str) -> bool {
        matches!(build_console_command(None, script), Ok(Built::Unsupported(_)))
    }

    #[test]
    fn find_carries_filter_sort_and_limit() {
        let c = command(r#"db.orders.find({status: "open"}).sort({total: -1}).limit(5)"#, None);
        assert_eq!(c.get_str("find").unwrap(), "orders");
        assert_eq!(c.get_document("filter").unwrap(), &doc! { "status": "open" });
        assert_eq!(c.get_document("sort").unwrap(), &doc! { "total": -1i64 });
        assert_eq!(c.get_i64("limit").unwrap(), 5);
    }

    #[test]
    fn find_one_limits_to_one_and_count_takes_the_filter() {
        assert_eq!(command("db.o.findOne({a: 1})", None).get_i64("limit").unwrap(), 1);
        let c = command("db.o.countDocuments({a: 1})", None);
        assert_eq!(c.get_str("count").unwrap(), "o");
        assert_eq!(c.get_document("query").unwrap(), &doc! { "a": 1i64 });
    }

    #[test]
    fn distinct_names_its_key_and_query() {
        let c = command(r#"db.o.distinct("city", {a: 1})"#, None);
        assert_eq!((c.get_str("distinct").unwrap(), c.get_str("key").unwrap()), ("o", "city"));
        assert_eq!(c.get_document("query").unwrap(), &doc! { "a": 1i64 });
        assert!(build_console_command(None, "db.o.distinct()").is_err());
    }

    #[test]
    fn aggregate_and_bare_json_use_the_given_collection() {
        let c = command("db.o.aggregate([{$match: {a: 1}}])", None);
        assert_eq!(c.get_array("pipeline").unwrap().len(), 1);
        assert_eq!(command("[{\"$match\": {}}]", Some("orders")).get_str("aggregate").unwrap(), "orders");
        assert_eq!(command("{\"a\": 1}", Some("orders")).get_str("find").unwrap(), "orders");
        assert!(unsupported("{\"a\": 1}"));
    }

    #[test]
    fn writes_admin_and_shell_commands_are_unsupported() {
        for s in ["db.o.insertOne({a: 1})", "db.o.drop()", "use shop", "show collections", "db.runCommand({ping: 1})"] {
            assert!(unsupported(s), "{s}");
        }
    }

    #[test]
    fn a_pipeline_that_writes_is_named() {
        let out = command(r#"db.o.aggregate([{$match: {}}, {$out: "copy"}])"#, None);
        assert_eq!(writing_stage(&out), Some("$out"));
        let merge = command(r#"db.o.aggregate([{$merge: {into: "copy"}}])"#, None);
        assert_eq!(writing_stage(&merge), Some("$merge"));
        assert_eq!(writing_stage(&command("db.o.aggregate([{$match: {}}])", None)), None);
        assert_eq!(writing_stage(&command("db.o.find({})", None)), None);
    }
}
