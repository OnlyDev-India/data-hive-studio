use dh_core::db::CatalogOverview;
use dh_server_client::auth::AuthCtx;
use super::Gateway;

impl Gateway {
    pub async fn list_tables(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<Vec<dh_core::api::TableInfo>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_tables().await.map_err(|e| e.to_string())
    }

    pub async fn table_schema(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> Result<dh_core::api::TableSchema, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .table_schema(database, schema, table)
            .await
            .map(|t| t.0)
            .map_err(|e| e.to_string())
    }

    /// Spec 0001's "Fields" view, team-server passthrough — read only, same
    /// authorize gate as `table_schema` above.
    pub async fn field_tree(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Vec<dh_core::api::FieldShape>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .field_tree(database, collection)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_schemas(&self, ctx: &AuthCtx, conn_id: &str) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_schemas().await.map_err(|e| e.to_string())
    }

    pub async fn list_databases(&self, ctx: &AuthCtx, conn_id: &str) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_databases().await.map_err(|e| e.to_string())
    }

    pub async fn catalog_overview(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<CatalogOverview, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.catalog_overview().await.map_err(|e| e.to_string())
    }

    /// Sidebar catalog tree surface — schemas/objects/roles for a specific
    /// (possibly sibling, possibly non-active) database on the connection's
    /// server. Same authorize→adapter→map-err shape as everything else here;
    /// the actual sibling-database routing (Postgres secondary pools, Mongo's
    /// free multi-database addressing) lives entirely in the adapter.
    pub async fn list_schemas_in(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
    ) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .list_schemas_in(database)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_schema_objects(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
        schema: &str,
        kind: dh_core::db::SchemaObjectKind,
    ) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .list_schema_objects(database, schema, kind)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_roles(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_roles().await.map_err(|e| e.to_string())
    }

    pub async fn list_extensions(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        database: Option<&str>,
    ) -> Result<Vec<dh_core::db::SchemaObject>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .list_extensions(database)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_role_details(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<Vec<dh_core::db::RoleDetail>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id)
            .await?
            .list_role_details()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn active_schema(&self, ctx: &AuthCtx, conn_id: &str) -> Result<String, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.active_schema().await.map_err(|e| e.to_string())
    }
}
