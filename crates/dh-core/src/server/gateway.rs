//! Grant-checked execution against shared PostgreSQL connections.
//!
//! The gateway owns one adapter per active shared connection, dispatched by
//! the connection's `kind` (see [`crate::server::vault::AdapterParams`]) so
//! adding a new database to the team-server means adding a variant there
//! plus a match arm in [`Gateway::adapter`] — not touching pooling,
//! authorization, or auditing below, which all go through the `DbAdapter`
//! trait object. Clients never see credentials — they address connections by
//! id, and every call re-checks the caller's grant (admins bypass
//! data-access checks but still go through the same execution path so
//! everything lands in the audit log).

use crate::api::{
    MongoDocumentsResult, MongoExtDocumentsResult, MongoRunResult, QueryOp, QueryResult, SchemaOp,
};
use crate::db::{CatalogOverview, DbAdapter, MongoAdapter, PgAdapter};
use crate::server::grants::DataAccess;
use crate::server::identity::AuthCtx;
use crate::server::store::Store;
use crate::server::vault::{AdapterParams, ConnInput};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;

/// Idle connections are evicted from the gateway cache after this duration.
const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

pub const ERR_FORBIDDEN: &str = "forbidden";
pub const ERR_READONLY: &str = "connection is read-only for this device";

/// A shared connection as visible to ONE caller: metadata plus that caller's
/// effective grant (admins always see readwrite + editable).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnWithAccess {
    #[serde(flatten)]
    pub meta: crate::server::vault::ConnMeta,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
}

pub struct Gateway {
    pub store: Store,
    pools: Mutex<HashMap<String, (Arc<dyn DbAdapter>, Instant)>>,
    /// Serialize pool creation per connection id.
    opening: AsyncMutex<()>,
}

/// Read ops are allowed under readonly grants; everything else needs readwrite.
fn op_is_read(op: &QueryOp) -> bool {
    matches!(
        op,
        QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. }
    )
}

/// Coarse action label for the audit trail.
fn op_action(op: &QueryOp) -> &'static str {
    match op {
        QueryOp::Select { .. } => "op.select",
        QueryOp::Count { .. } => "op.count",
        QueryOp::SelectDistinct { .. } => "op.distinct",
        QueryOp::Insert { .. } => "op.insert",
        QueryOp::Update { .. } => "op.update",
        QueryOp::Delete { .. } => "op.delete",
        QueryOp::DropTable { .. } => "op.drop_table",
    }
}

impl Gateway {
    pub fn new(store: Store) -> Self {
        Self { store, pools: Mutex::new(HashMap::new()), opening: AsyncMutex::new(()) }
    }

    /// Evict pools idle longer than `IDLE_TIMEOUT`.
    fn evict_idle(pools: &mut HashMap<String, (Arc<dyn DbAdapter>, Instant)>) {
        let now = Instant::now();
        pools.retain(|_, (_, last)| now.duration_since(*last) < IDLE_TIMEOUT);
    }

    async fn adapter(&self, conn_id: &str) -> Result<Arc<dyn DbAdapter>, String> {
        {
            let mut guard = self.pools.lock().unwrap();
            Self::evict_idle(&mut guard);
            if let Some((a, last)) = guard.get_mut(conn_id) {
                *last = Instant::now();
                return Ok(a.clone());
            }
        }
        let _guard = self.opening.lock().await;
        {
            let mut guard = self.pools.lock().unwrap();
            Self::evict_idle(&mut guard);
            if let Some((a, last)) = guard.get_mut(conn_id) {
                *last = Instant::now();
                return Ok(a.clone());
            }
        }
        let params = self.store.conn_secret_params(conn_id).await?;
        let arc: Arc<dyn DbAdapter> = match params {
            AdapterParams::Postgres(p) => {
                Arc::new(PgAdapter::connect(&p).await.map_err(|e| e.to_string())?)
            }
            AdapterParams::Mongodb(p) => {
                Arc::new(MongoAdapter::connect(&p).await.map_err(|e| e.to_string())?)
            }
        };
        self.pools.lock().unwrap().insert(conn_id.to_string(), (arc.clone(), Instant::now()));
        Ok(arc)
    }

    /// Drop the cached pool (after credential edit or archive).
    pub async fn invalidate(&self, conn_id: &str) {
        let removed = self.pools.lock().unwrap().remove(conn_id);
        if let Some((a, _)) = removed {
            a.close().await;
        }
    }

    /// Resolve the caller's effective data access for a connection.
    /// Admin scope = full readwrite. Others need a grant with can_read (and
    /// can_update for writes).
    pub async fn authorize(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        write: bool,
    ) -> Result<DataAccess, String> {
        let exists = self.store.conn_get(conn_id).await?.is_some();
        if !exists {
            return Err(crate::server::vault::ERR_NOT_FOUND.into());
        }
        if ctx.is_admin {
            return Ok(DataAccess::Readwrite);
        }
        let can_read = self.store.grant_can_read(&ctx.token, conn_id).await?;
        if !can_read {
            return Err(ERR_FORBIDDEN.into());
        }
        if write {
            let can_update = self.store.grant_can_update(&ctx.token, conn_id).await?;
            if !can_update {
                return Err(ERR_READONLY.into());
            }
            Ok(DataAccess::Readwrite)
        } else {
            Ok(DataAccess::Readonly)
        }
    }

    pub async fn list_tables(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<Vec<crate::api::TableInfo>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_tables().await.map_err(|e| e.to_string())
    }

    pub async fn table_schema(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        table: &str,
    ) -> Result<crate::api::TableSchema, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.table_schema(table).await.map(|t| t.0).map_err(|e| e.to_string())
    }

    pub async fn run_sql(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        // SQL console can contain anything → requires readwrite.
        self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.run_sql(sql).await.map_err(|e| e.to_string())
    }

    pub async fn execute_op(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        op: &QueryOp,
    ) -> Result<QueryResult, String> {
        self.authorize(ctx, conn_id, !op_is_read(op)).await?;
        let outcome = self.adapter(conn_id).await?.execute_op(op).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, op_action(op), conn_id, outcome.sql.as_deref()).await?;
        Ok(outcome.result)
    }

    pub async fn list_schemas(&self, ctx: &AuthCtx, conn_id: &str) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.list_schemas().await.map_err(|e| e.to_string())
    }

    // ---- MongoDB surface -----------------------------------------------
    //
    // Every method below is engine-agnostic on the `Gateway`/`DbAdapter`
    // side (same authorize→adapter→map-err shape as `run_sql`/`execute_op`
    // above) — a non-Mongo adapter just returns its own `InvalidOperation`.
    // These exist so the desktop app's Mongo features (document grid,
    // console, index manager, collection create/drop/rename/duplicate,
    // database switcher) work identically against a shared team-server
    // connection, not just a local one.

    pub async fn list_documents(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoDocumentsResult, String> {
        self.authorize(ctx, conn_id, false).await?;
        let (documents, total) = self
            .adapter(conn_id)
            .await?
            .list_documents(collection, filter, skip, limit)
            .await
            .map_err(|e| e.to_string())?;
        Ok(MongoDocumentsResult { documents, total })
    }

    pub async fn list_documents_ext(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoExtDocumentsResult, String> {
        self.authorize(ctx, conn_id, false).await?;
        let (documents, total) = self
            .adapter(conn_id)
            .await?
            .list_documents_ext(collection, filter, skip, limit)
            .await
            .map_err(|e| e.to_string())?;
        Ok(MongoExtDocumentsResult { documents, total })
    }

    pub async fn save_document(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> Result<bool, String> {
        self.authorize(ctx, conn_id, true).await?;
        let saved = self
            .adapter(conn_id)
            .await?
            .save_document(collection, id, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, "doc.save", conn_id, Some(&format!("{collection}/{id}"))).await?;
        Ok(saved)
    }

    pub async fn insert_document(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        document_text: &str,
    ) -> Result<(), String> {
        self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .insert_document(collection, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, "doc.insert", conn_id, Some(collection)).await?;
        Ok(())
    }

    /// Mongo console. Requires readwrite, same reasoning as `run_sql`: the
    /// script is arbitrary free text, so it's treated as a potential write.
    pub async fn run_mongo(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        db: &str,
        collection: Option<&str>,
        script: &str,
    ) -> Result<MongoRunResult, String> {
        self.authorize(ctx, conn_id, true).await?;
        let result = self
            .adapter(conn_id)
            .await?
            .run_mongo(db, collection, script)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, "mongo.run", conn_id, Some(&result.command)).await?;
        Ok(result)
    }

    pub async fn create_collection(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        name: &str,
    ) -> Result<(), String> {
        self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.create_collection(name).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, "collection.create", conn_id, Some(name)).await?;
        Ok(())
    }

    /// Duplicate a table/collection. `copy_data` is Mongo-specific (see the
    /// `DbAdapter::duplicate_table` doc comment) but the op itself is
    /// generic — this is the same method Postgres's future "duplicate with
    /// data" UI will call too.
    pub async fn duplicate_table(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .duplicate_table(source, target, copy_data)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, "collection.duplicate", conn_id, Some(&format!("{source} → {target}")))
            .await?;
        Ok(stmts)
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

    /// Switches which database/schema UNQUALIFIED operations on this shared
    /// connection target. This is per-adapter-instance state, not per-caller
    /// — since the gateway pools one adapter per connection id for every
    /// caller, switching it affects every other user of this same shared
    /// connection until someone switches it back. Treated as a write for
    /// that reason (requires a can_update grant, same as any other mutation).
    pub async fn set_active_schema(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        schema: &str,
    ) -> Result<(), String> {
        self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.set_active_schema(schema).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, "schema.switch", conn_id, Some(schema)).await?;
        Ok(())
    }

    pub async fn active_schema(&self, ctx: &AuthCtx, conn_id: &str) -> Result<String, String> {
        self.authorize(ctx, conn_id, false).await?;
        self.adapter(conn_id).await?.active_schema().await.map_err(|e| e.to_string())
    }

    /// Apply staged schema (DDL) ops — collection rename and the full index
    /// manager (create/drop, including TTL/sparse/partial/direction) for
    /// Mongo; the generic SQL DDL surface for other engines.
    pub async fn apply_schema_ops_batch(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        ops: &[SchemaOp],
    ) -> Result<Vec<String>, String> {
        self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .apply_schema_ops_batch(ops)
            .await
            .map_err(|e| e.to_string())?;
        if !stmts.is_empty() {
            self.store.audit(ctx, "schema_ops", conn_id, Some(&stmts.join(";\n"))).await?;
        }
        Ok(stmts)
    }

    /// Edit stored details — needs `can_edit` on the grant or admin scope.
    /// Editing credentials drops the cached pool so the next query reconnects.
    pub async fn update_conn_details(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        input: ConnInput,
    ) -> Result<crate::server::vault::ConnMeta, String> {
        let is_admin = ctx.is_admin;
        if !is_admin && !self.store.grant_can_update(&ctx.token, conn_id).await? {
            return Err(ERR_FORBIDDEN.into());
        }
        let meta = self.store.conn_update(conn_id, &input).await?;
        self.invalidate(conn_id).await;
        self.store
            .audit(ctx, "conn.edit", conn_id, Some("details updated"))
            .await?;
        Ok(meta)
    }

    /// Connections visible to a device: admin sees all; others see granted ones only.
    /// Archive a shared connection. Requires admin scope OR an explicit
    /// `can_delete` grant on this device for that connection.
    pub async fn delete_connection(&self, ctx: &AuthCtx, conn_id: &str) -> Result<(), String> {
        let meta = self
            .store
            .conn_get(conn_id)
            .await?
            .ok_or(crate::server::vault::ERR_NOT_FOUND)?;
        let allowed =
            ctx.is_admin || self.store.grant_can_delete(&ctx.token, conn_id).await?;
        if !allowed {
            return Err(ERR_FORBIDDEN.into());
        }
        self.store.conn_archive(conn_id).await?;
        self.invalidate(conn_id).await;
        self.store.audit(ctx, "conn.delete", conn_id, Some(&meta.name)).await?;
        Ok(())
    }

    pub async fn visible_connections(
        &self,
        ctx: &AuthCtx,
    ) -> Result<Vec<ConnWithAccess>, String> {
        let metas = self.store.conn_list_active().await?;
        let grants = self.store.grants_for_device(&ctx.token).await?;
        let mut out = Vec::new();
        for m in metas {
            if ctx.is_admin {
                out.push(ConnWithAccess {
                    meta: m,
                    can_read: true,
                    can_update: true,
                    can_delete: true,
                });
                continue;
            }
            if let Some(g) = grants.iter().find(|g| g.conn_id == m.id) {
                out.push(ConnWithAccess {
                    meta: m,
                    can_read: g.can_read,
                    can_update: g.can_update,
                    can_delete: g.can_delete,
                });
            }
        }
        Ok(out)
    }

    /// Return decrypted connection credentials for authorized callers.
    /// Admins always get access; team tokens need a can_read grant.
    pub async fn conn_credentials(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<serde_json::Value, String> {
        // Check authorization.
        if !ctx.is_admin {
            let allowed = self.store.grant_can_read(&ctx.token, conn_id).await?;
            if !allowed {
                return Err(ERR_FORBIDDEN.into());
            }
        }
        let params = self.store.conn_secret_params(conn_id).await?;
        Ok(match params {
            AdapterParams::Postgres(p) => serde_json::json!({
                "host": p.host,
                "port": p.port,
                "user": p.user,
                "password": p.password,
                "database": p.database,
                "ssl_mode": p.ssl_mode,
            }),
            AdapterParams::Mongodb(p) => serde_json::json!({
                "host": p.host,
                "port": p.port,
                "user": p.user,
                "password": p.password,
                "database": p.database,
                "auth_db": p.auth_db,
                "srv": p.srv,
                "tls": p.tls,
            }),
        })
    }

    /// Release (close) the cached pool for a connection. Used when a web client
    /// disconnects so resources are freed immediately instead of waiting for the
    /// idle timeout. Requires admin or a read grant on the connection.
    pub async fn release_connection(&self, ctx: &AuthCtx, conn_id: &str) -> Result<(), String> {
        if !ctx.is_admin {
            let allowed = self.store.grant_can_read(&ctx.token, conn_id).await?;
            if !allowed {
                return Err(ERR_FORBIDDEN.into());
            }
        }
        self.invalidate(conn_id).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::store::test_store;
    use crate::server::vault::ConnInput;

    fn input() -> ConnInput {
        ConnInput {
            name: "gw".into(),
            kind: crate::api::DbKind::Postgres,
            host: "127.0.0.1".into(),
            port: 1, // nothing listens here; connect must fail cleanly
            user: "u".into(),
            password: Some("p".into()),
            database: "d".into(),
            ssl_mode: None,
            auth_db: None,
            srv: false,
            tls: false,
        }
    }

    #[tokio::test]
    async fn authorization_gates() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let meta = store.conn_add(&input(), "admin-dev").await.unwrap();

        let admin = AuthCtx { token: "admin-dev".into(), user_name: "admin".into(), prefix: "adm_".into(), team_name: None, is_admin: true };
        // Admin passes even with zero grants (but adapter connect fails — that's fine).
        let err = gw.execute_op(&admin, &meta.id, &read_op()).await.err().unwrap();
        assert!(!err.contains(ERR_FORBIDDEN), "admin should pass authz");

        let dev = AuthCtx { token: "dev".into(), user_name: "dev".into(), prefix: "adm_".into(), team_name: Some("acme".into()), is_admin: false };
        let err = gw.list_tables(&dev, &meta.id).await.err().unwrap();
        assert_eq!(err, ERR_FORBIDDEN);

        store.grant_upsert("dev", &meta.id, true, false, false).await.unwrap();
        let err = gw.run_sql(&dev, &meta.id, "SELECT 1").await.err().unwrap();
        assert_eq!(err, ERR_READONLY);

        let err2 = gw.execute_op(&dev, &meta.id, &write_op()).await.err().unwrap();
        assert_eq!(err2, ERR_READONLY);

        // Read op passes authz (fails later at pool connect).
        let err3 = gw.execute_op(&dev, &meta.id, &read_op()).await.err().unwrap();
        assert!(!err3.contains(ERR_FORBIDDEN) && !err3.contains(ERR_READONLY));

        // Edit access gates detail edits.
        assert_eq!(
            gw.update_conn_details(&dev, &meta.id, input()).await.err().unwrap(),
            ERR_FORBIDDEN
        );
        store.grant_upsert("dev", &meta.id, true, true, false).await.unwrap();
        let edited = gw.update_conn_details(&dev, &meta.id, input()).await.unwrap();
        assert_eq!(edited.name, "gw");

        // Delete requires can_delete (or admin): denied by default…
        assert_eq!(
            gw.delete_connection(&dev, &meta.id).await.err().unwrap(),
            ERR_FORBIDDEN
        );
        // …granted → archives it, drops it from listings.
        store.grant_upsert("dev", &meta.id, true, true, true).await.unwrap();
        gw.delete_connection(&dev, &meta.id).await.unwrap();
        assert!(gw.visible_connections(&dev).await.unwrap().is_empty());
    }

    fn read_op() -> QueryOp {
        serde_json::from_str(r#"{"kind":"select","table":"t","limit":5}"#).unwrap()
    }
    fn write_op() -> QueryOp {
        serde_json::from_str(r#"{"kind":"delete","table":"t","match_row":{}}"#).unwrap()
    }

    #[tokio::test]
    async fn visibility_filtering() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let m1 = store.conn_add(&input(), "a").await.unwrap();
        let _m2 = store.conn_add(&input(), "a").await.unwrap();

        let admin = AuthCtx { token: "a".into(), user_name: "a".into(), prefix: "adm_".into(), team_name: None, is_admin: true };
        assert_eq!(gw.visible_connections(&admin).await.unwrap().len(), 2);

        let dev = AuthCtx { token: "d".into(), user_name: "d".into(), prefix: "adm_".into(), team_name: Some("acme".into()), is_admin: false };
        assert!(gw.visible_connections(&dev).await.unwrap().is_empty());
        store.grant_upsert("d", &m1.id, true, false, false).await.unwrap();
        let vis = gw.visible_connections(&dev).await.unwrap();
        assert_eq!(vis.len(), 1);
        assert_eq!(vis[0].meta.id, m1.id);
        assert!(!serde_json::to_string(&vis).unwrap().contains("password"));
    }

    /// A non-Postgres `kind` connection dispatches to the matching adapter
    /// (`MongoAdapter::connect`, per its distinctive error text) instead of
    /// always going through Postgres — the point of generalizing `pools` to
    /// `Arc<dyn DbAdapter>` and matching on `AdapterParams` in `adapter()`.
    #[tokio::test]
    async fn dispatches_by_connection_kind() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let mut mongo_input = input();
        mongo_input.kind = crate::api::DbKind::Mongodb;
        let meta = store.conn_add(&mongo_input, "admin-dev").await.unwrap();
        assert_eq!(meta.kind, crate::api::DbKind::Mongodb);

        let admin = AuthCtx { token: "admin-dev".into(), user_name: "admin".into(), prefix: "adm_".into(), team_name: None, is_admin: true };
        let err = gw.list_tables(&admin, &meta.id).await.err().unwrap();
        // Postgres's connect error never mentions "mongo" — this fails via
        // MongoAdapter::connect's own error text, confirming dispatch.
        assert!(err.contains("mongo"), "expected a Mongo connect error, got: {err}");
    }
}
