//! Request bodies of the data routes. The path, method and shape of each are
//! unchanged from the old server.

use dh_core::api::{QueryOp, SchemaOp};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SqlBody {
    pub sql: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
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

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemaOpsBody {
    pub ops: Vec<SchemaOp>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
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
