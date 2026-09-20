use crate::api::{
    MongoDocumentsResult,
    MongoExtDocumentsResult,
    MongoRunResult,
    QueryOp,
    QueryResult,
    SchemaOp,
};
use crate::server::router::{
    ActiveSchemaBody,
    CreateCollectionBody,
    DisconnectDatabaseBody,
    DuplicateBody,
    ExecuteOpBody,
    InsertDocumentBody,
    MongoDocumentsBody,
    RunMongoBody,
    SaveDocumentBody,
    SchemaOpsBody,
    SqlBody,
};
use super::ServerClient;

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
