use dh_core::api::{
    MongoDocumentsResult,
    MongoExtDocumentsResult,
    MongoRunResult,
    QueryOp,
    QueryResult,
    SchemaOp,
};
use super::ServerClient;

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

impl ServerClient {
    pub async fn run_sql(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
    ) -> Result<QueryResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/sql"),
            SqlBody {
                sql: sql.into(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn execute_op(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> Result<QueryResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/op"),
            ExecuteOpBody {
                op: op.clone(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn disconnect_database(&self, conn_id: &str, database: &str) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/disconnect-database"),
            DisconnectDatabaseBody { database: database.into() },
        )
        .await
    }

    pub async fn set_active_schema(&self, conn_id: &str, schema: &str) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/c/{conn_id}/active-schema"),
            ActiveSchemaBody { schema: schema.into() },
        )
        .await
    }

    pub async fn apply_schema_ops_batch(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schema-ops"),
            SchemaOpsBody {
                ops: ops.to_vec(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn duplicate_table(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/duplicate"),
            DuplicateBody {
                source: source.into(),
                target: target.into(),
                copy_data,
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn list_documents(
        &self,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoDocumentsResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents"),
            MongoDocumentsBody { collection: collection.into(), filter, skip, limit },
        )
        .await
    }

    pub async fn list_documents_ext(
        &self,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoExtDocumentsResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/ext"),
            MongoDocumentsBody { collection: collection.into(), filter, skip, limit },
        )
        .await
    }

    pub async fn save_document(
        &self,
        conn_id: &str,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> Result<bool, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/save"),
            SaveDocumentBody {
                collection: collection.into(),
                id: id.into(),
                document_text: document_text.into(),
            },
        )
        .await
    }

    pub async fn insert_document(
        &self,
        conn_id: &str,
        collection: &str,
        document_text: &str,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/insert"),
            InsertDocumentBody { collection: collection.into(), document_text: document_text.into() },
        )
        .await
    }

    pub async fn run_mongo(
        &self,
        conn_id: &str,
        database: &str,
        collection: Option<&str>,
        script: &str,
    ) -> Result<MongoRunResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/run"),
            RunMongoBody {
                database: database.into(),
                collection: collection.map(|s| s.into()),
                script: script.into(),
            },
        )
        .await
    }

    pub async fn create_collection(
        &self,
        conn_id: &str,
        database: Option<&str>,
        name: &str,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/collections"),
            CreateCollectionBody {
                name: name.into(),
                database: database.map(str::to_string),
            },
        )
        .await
    }
}
