use dh_core::api::{FieldShape, TableInfo, TableSchema};
use dh_core::db::CatalogOverview;
use super::{ServerClient, urlencode};

/// Sidebar catalog tree surface — schemas/objects/roles, optionally for a
/// sibling database on the same server (matches `dh-server`'s
/// `router::browse::SchemasInBody`).
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

impl ServerClient {
    // ---- Connection data surface (unchanged from the pre-org model) -------
    pub async fn list_tables(&self, conn_id: &str) -> Result<Vec<TableInfo>, String> {
        self.get(&format!("/v1/c/{conn_id}/tables")).await
    }

    pub async fn list_schemas(&self, conn_id: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/v1/c/{conn_id}/schemas")).await
    }

    /// `database`/`schema`: `None` = this connection's own primary database
    /// / active schema — see `DbAdapter::table_schema`'s doc comment.
    pub async fn table_schema(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> Result<TableSchema, String> {
        let mut query = String::new();
        if let Some(d) = database {
            query.push_str(&format!("?database={}", urlencode(d)));
        }
        if let Some(s) = schema {
            query.push_str(&format!("{}schema={}", if query.is_empty() { "?" } else { "&" }, urlencode(s)));
        }
        self.get(&format!("/v1/c/{conn_id}/schema/{table}{query}")).await
    }

    /// Spec 0001's "Fields" view — `database` is required, unlike
    /// `table_schema`'s optional "ambient" one.
    pub async fn field_tree(
        &self,
        conn_id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Vec<FieldShape>, String> {
        self.get(&format!(
            "/v1/c/{conn_id}/mongo/field-tree/{collection}?database={}",
            urlencode(database)
        ))
        .await
    }

    pub async fn list_databases(&self, conn_id: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/v1/c/{conn_id}/databases")).await
    }

    pub async fn catalog_overview(&self, conn_id: &str) -> Result<CatalogOverview, String> {
        self.get(&format!("/v1/c/{conn_id}/catalog")).await
    }

    pub async fn list_schemas_in(
        &self,
        conn_id: &str,
        database: Option<&str>,
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schemas-in"),
            SchemasInBody { database: database.map(str::to_string) },
        )
        .await
    }

    pub async fn list_schema_objects(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: &str,
        kind: dh_core::db::SchemaObjectKind,
    ) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schema-objects"),
            SchemaObjectsBody {
                database: database.map(str::to_string),
                schema: schema.to_string(),
                kind,
            },
        )
        .await
    }

    pub async fn list_roles(&self, conn_id: &str) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.get(&format!("/v1/c/{conn_id}/roles")).await
    }

    pub async fn list_role_details(&self, conn_id: &str) -> Result<Vec<dh_core::db::RoleDetail>, String> {
        self.get(&format!("/v1/c/{conn_id}/role-details")).await
    }

    pub async fn list_extensions(
        &self,
        conn_id: &str,
        database: Option<&str>,
    ) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/extensions"),
            ExtensionsBody { database: database.map(str::to_string) },
        )
        .await
    }

    pub async fn active_schema(&self, conn_id: &str) -> Result<String, String> {
        self.get(&format!("/v1/c/{conn_id}/active-schema")).await
    }
}
