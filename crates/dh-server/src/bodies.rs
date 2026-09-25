//! Request bodies of the data routes. The path, method and shape of each are
//! unchanged from the old server.

use dh_core::api::{ImportRequest, QueryOp, SchemaOp};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SqlBody {
    pub sql: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    /// Names the run for `/cancel`; only the streaming route reads it.
    #[serde(default)]
    pub run_id: Option<String>,
}

/// Explain (spec 0011). `run_id` is accepted and ignored: the web build has no
/// Stop route yet, so nothing can cancel a remote plan.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ExplainSqlBody {
    pub sql: String,
    #[serde(default)]
    pub analyze: bool,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
}

/// `#[serde(flatten)]` keeps `op`'s own tagged JSON shape at the top level
/// (`{ kind: "select", table: ..., ... }`) with `database`/`schema` as
/// sibling fields, rather than nesting the op under its own key.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ExecuteOpBody {
    #[serde(flatten)]
    pub op: QueryOp,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

/// `POST /v1/c/{handle}/cancel`.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct CancelBody {
    pub run_id: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemaOpsBody {
    pub ops: Vec<SchemaOp>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

/// An import (spec 0008): every parsed row in one request. `run_id` inside
/// the request is ignored here, a remote import cannot be cancelled yet.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ImportBody {
    pub request: ImportRequest,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ImportCapabilitiesBody {
    #[serde(default)]
    pub database: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DuplicateBody {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub copy_data: bool,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DisconnectDatabaseBody {
    pub database: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ActiveSchemaBody {
    pub schema: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct MongoDocumentsBody {
    pub collection: String,
    #[serde(default)]
    pub filter: Option<serde_json::Value>,
    #[serde(default)]
    pub skip: u64,
    #[serde(default = "default_doc_limit")]
    pub limit: u64,
}

fn default_doc_limit() -> u64 {
    50
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SaveDocumentBody {
    pub collection: String,
    pub id: String,
    pub document_text: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct InsertDocumentBody {
    pub collection: String,
    pub document_text: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RunMongoBody {
    pub database: String,
    #[serde(default)]
    pub collection: Option<String>,
    pub script: String,
    /// Names the run for `/cancel`; only the streaming route reads it.
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ExplainMongoBody {
    pub database: String,
    #[serde(default)]
    pub collection: Option<String>,
    pub script: String,
    #[serde(default)]
    pub analyze: bool,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct CreateCollectionBody {
    pub name: String,
    #[serde(default)]
    pub database: Option<String>,
}

/// Sidebar catalog tree surface: schemas, objects and roles, optionally for a
/// sibling database on the same server.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemasInBody {
    pub database: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemaObjectsBody {
    pub database: Option<String>,
    pub schema: String,
    pub kind: dh_core::db::SchemaObjectKind,
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ExtensionsBody {
    pub database: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T, serde_json::Error> {
        serde_json::from_value(v)
    }

    #[test]
    fn a_documents_request_defaults_to_the_first_50() {
        let b: MongoDocumentsBody = parse(json!({"collection": "c"})).unwrap();
        assert_eq!((b.skip, b.limit), (0, 50));
        assert!(b.filter.is_none());
    }

    #[test]
    fn a_documents_request_keeps_the_paging_it_was_given() {
        let b: MongoDocumentsBody =
            parse(json!({"collection": "c", "skip": 100, "limit": 5, "filter": {"a": 1}})).unwrap();
        assert_eq!((b.skip, b.limit), (100, 5));
        assert_eq!(b.filter, Some(json!({"a": 1})));
    }

    #[test]
    fn a_duplicate_request_copies_no_data_unless_asked() {
        let b: DuplicateBody = parse(json!({"source": "a", "target": "b"})).unwrap();
        assert!(!b.copy_data && b.database.is_none() && b.schema.is_none());
        let b: DuplicateBody =
            parse(json!({"source": "a", "target": "b", "copy_data": true})).unwrap();
        assert!(b.copy_data);
    }

    #[test]
    fn an_op_body_reads_database_and_schema_beside_the_op_fields() {
        let b: ExecuteOpBody = parse(
            json!({"kind": "drop_table", "table": "t", "database": "d", "schema": "s"}),
        )
        .unwrap();
        assert_eq!(b.database.as_deref(), Some("d"));
        assert_eq!(b.schema.as_deref(), Some("s"));
    }

    #[test]
    fn a_body_missing_a_required_field_is_rejected() {
        assert!(parse::<SqlBody>(json!({"database": "d"})).is_err());
        assert!(parse::<RunMongoBody>(json!({"database": "d"})).is_err());
        assert!(parse::<SaveDocumentBody>(json!({"collection": "c", "id": "1"})).is_err());
        assert!(parse::<DisconnectDatabaseBody>(json!({})).is_err());
    }

    #[test]
    fn a_sql_body_needs_only_the_sql() {
        let b: SqlBody = parse(json!({"sql": "select 1"})).unwrap();
        assert!(b.database.is_none() && b.schema.is_none());
    }
}
