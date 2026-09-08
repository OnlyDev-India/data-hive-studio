//! Grant-checked execution against shared PostgreSQL connections.
//!
//! The gateway owns one adapter per active shared connection, dispatched by
//! the connection's `kind` (see [`crate::server::vault::AdapterParams`]) so
//! adding a new database to the team-server means adding a variant there
//! plus a match arm in [`Gateway::adapter`] — not touching pooling,
//! authorization, or auditing below, which all go through the `DbAdapter`
//! trait object. Clients never see credentials — they address connections by
//! id, and every call re-checks the caller's effective access, which is
//! their `OrgRole` default (owner/admin: full access; member: read+write;
//! viewer: read-only) overridden per-connection by any `connection_grants`
//! row for them — see `orgs.rs`/`grants.rs`.

use crate::api::{
    MongoDocumentsResult, MongoExtDocumentsResult, MongoRunResult, QueryOp, QueryResult, SchemaOp,
};
use crate::db::{CatalogOverview, DbAdapter, MongoAdapter, PgAdapter};
use crate::server::auth::AuthCtx;
use crate::server::grants::DataAccess;
use crate::server::orgs::OrgRole;
use crate::server::store::Store;
use crate::server::vault::{AdapterParams, ConnInput};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::Mutex as AsyncMutex;

/// Idle connections are evicted from the gateway cache after this duration.
const IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

pub const ERR_FORBIDDEN: &str = "forbidden";
pub const ERR_READONLY: &str = "connection is read-only for this user";

/// A shared connection as visible to ONE caller: metadata plus that caller's
/// effective access.
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

/// Read ops are allowed under readonly access; everything else needs readwrite.
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

    /// The caller's effective (can_read, can_update, can_delete) for a
    /// connection: their `OrgRole` default in the connection's org,
    /// overridden by a `connection_grants` row if one exists. `None` when
    /// they aren't a member of that org at all (no access, not even to know
    /// the connection exists).
    async fn effective_access(
        &self,
        conn_id: &str,
        ctx: &AuthCtx,
    ) -> Result<Option<(String, bool, bool, bool)>, String> {
        let meta = self.store.conn_get(conn_id).await?.ok_or(crate::server::vault::ERR_NOT_FOUND)?;
        let Some(role) = self.store.org_role(&meta.org_id, &ctx.user_id).await? else {
            return Ok(None);
        };
        let (mut can_read, mut can_update, mut can_delete) = role.default_access();
        if let Some(g) = self.store.grant_for_user(conn_id, &ctx.user_id).await? {
            can_read = g.can_read;
            can_update = g.can_update;
            can_delete = g.can_delete;
        }
        Ok(Some((meta.org_id, can_read, can_update, can_delete)))
    }

    /// Resolve the caller's effective data access for a connection, gating
    /// on it. Returns the connection's `org_id` alongside the access level
    /// so write-path callers can pass it straight to `store.audit`.
    pub async fn authorize(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        write: bool,
    ) -> Result<(DataAccess, String), String> {
        let Some((org_id, can_read, can_update, _can_delete)) =
            self.effective_access(conn_id, ctx).await?
        else {
            return Err(ERR_FORBIDDEN.into());
        };
        if !can_read {
            return Err(ERR_FORBIDDEN.into());
        }
        if write {
            if !can_update {
                return Err(ERR_READONLY.into());
            }
            Ok((DataAccess::Readwrite, org_id))
        } else {
            Ok((DataAccess::Readonly, org_id))
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
        let (_, org_id) = self.authorize(ctx, conn_id, !op_is_read(op)).await?;
        let outcome = self.adapter(conn_id).await?.execute_op(op).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), op_action(op), conn_id, outcome.sql.as_deref()).await?;
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
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let saved = self
            .adapter(conn_id)
            .await?
            .save_document(collection, id, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, Some(&org_id), "doc.save", conn_id, Some(&format!("{collection}/{id}")))
            .await?;
        Ok(saved)
    }

    pub async fn insert_document(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        collection: &str,
        document_text: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id)
            .await?
            .insert_document(collection, document_text)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "doc.insert", conn_id, Some(collection)).await?;
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
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let result = self
            .adapter(conn_id)
            .await?
            .run_mongo(db, collection, script)
            .await
            .map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "mongo.run", conn_id, Some(&result.command)).await?;
        Ok(result)
    }

    pub async fn create_collection(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        name: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.create_collection(name).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "collection.create", conn_id, Some(name)).await?;
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
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .duplicate_table(source, target, copy_data)
            .await
            .map_err(|e| e.to_string())?;
        self.store
            .audit(ctx, Some(&org_id), "collection.duplicate", conn_id, Some(&format!("{source} → {target}")))
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
    /// that reason (requires update access, same as any other mutation).
    pub async fn set_active_schema(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        schema: &str,
    ) -> Result<(), String> {
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        self.adapter(conn_id).await?.set_active_schema(schema).await.map_err(|e| e.to_string())?;
        self.store.audit(ctx, Some(&org_id), "schema.switch", conn_id, Some(schema)).await?;
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
        let (_, org_id) = self.authorize(ctx, conn_id, true).await?;
        let stmts = self
            .adapter(conn_id)
            .await?
            .apply_schema_ops_batch(ops)
            .await
            .map_err(|e| e.to_string())?;
        if !stmts.is_empty() {
            self.store.audit(ctx, Some(&org_id), "schema_ops", conn_id, Some(&stmts.join(";\n"))).await?;
        }
        Ok(stmts)
    }

    /// Publish a NEW shared connection in `org_id`. Requires at least
    /// `Member` (viewers can't create connections, by definition of what a
    /// viewer is). The creator gets an explicit full-access grant override
    /// so they keep full control even if their role default wouldn't
    /// otherwise cover it (relevant once per-connection restrictions are
    /// layered on more broadly).
    pub async fn create_connection(
        &self,
        ctx: &AuthCtx,
        org_id: &str,
        input: ConnInput,
    ) -> Result<crate::server::vault::ConnMeta, String> {
        let role = self.store.org_role(org_id, &ctx.user_id).await?.ok_or(ERR_FORBIDDEN)?;
        if role < OrgRole::Member {
            return Err(ERR_FORBIDDEN.into());
        }
        let meta = self.store.conn_add(org_id, &input, &ctx.user_id).await?;
        self.store.grant_upsert(&meta.id, &ctx.user_id, true, true, true).await?;
        self.store.audit(ctx, Some(org_id), "conn.create", &meta.id, Some(&meta.name)).await?;
        Ok(meta)
    }

    /// Edit stored details — needs update access. Editing credentials drops
    /// the cached pool so the next query reconnects.
    pub async fn update_conn_details(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
        input: ConnInput,
    ) -> Result<crate::server::vault::ConnMeta, String> {
        let Some((org_id, _can_read, can_update, _can_delete)) =
            self.effective_access(conn_id, ctx).await?
        else {
            return Err(ERR_FORBIDDEN.into());
        };
        if !can_update {
            return Err(ERR_FORBIDDEN.into());
        }
        let meta = self.store.conn_update(conn_id, &input).await?;
        self.invalidate(conn_id).await;
        self.store.audit(ctx, Some(&org_id), "conn.edit", conn_id, Some("details updated")).await?;
        Ok(meta)
    }

    /// Archive a shared connection. Requires delete access (role default or
    /// an explicit `connection_grants` override).
    pub async fn delete_connection(&self, ctx: &AuthCtx, conn_id: &str) -> Result<(), String> {
        let meta = self
            .store
            .conn_get(conn_id)
            .await?
            .ok_or(crate::server::vault::ERR_NOT_FOUND)?;
        let Some((org_id, _can_read, _can_update, can_delete)) =
            self.effective_access(conn_id, ctx).await?
        else {
            return Err(ERR_FORBIDDEN.into());
        };
        if !can_delete {
            return Err(ERR_FORBIDDEN.into());
        }
        self.store.conn_archive(conn_id).await?;
        self.invalidate(conn_id).await;
        self.store.audit(ctx, Some(&org_id), "conn.delete", conn_id, Some(&meta.name)).await?;
        Ok(())
    }

    /// Connections visible to a user within one org: every active
    /// connection in that org they're at least a Viewer of, tagged with
    /// their effective access.
    pub async fn visible_connections(
        &self,
        ctx: &AuthCtx,
        org_id: &str,
    ) -> Result<Vec<ConnWithAccess>, String> {
        if self.store.org_role(org_id, &ctx.user_id).await?.is_none() {
            return Err(ERR_FORBIDDEN.into());
        }
        let metas = self.store.conn_list_active(org_id).await?;
        let mut out = Vec::with_capacity(metas.len());
        for m in metas {
            // Role is already confirmed present above; effective_access()
            // re-derives it per-connection (cheap, and keeps this the one
            // place the role-default+override merge logic lives). A grant
            // override can drop can_read to false — that connection is
            // excluded from the list entirely, not shown with can_read:
            // false, matching "you can't even see this" rather than "you
            // can see it but not open it."
            if let Some((_, can_read, can_update, can_delete)) = self.effective_access(&m.id, ctx).await? {
                if can_read {
                    out.push(ConnWithAccess { meta: m, can_read, can_update, can_delete });
                }
            }
        }
        Ok(out)
    }

    /// Return decrypted connection credentials for authorized callers.
    pub async fn conn_credentials(
        &self,
        ctx: &AuthCtx,
        conn_id: &str,
    ) -> Result<serde_json::Value, String> {
        let Some((_org_id, can_read, _can_update, _can_delete)) =
            self.effective_access(conn_id, ctx).await?
        else {
            return Err(ERR_FORBIDDEN.into());
        };
        if !can_read {
            return Err(ERR_FORBIDDEN.into());
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

    /// Release (close) the cached pool for a connection. Used when a web
    /// client disconnects so resources are freed immediately instead of
    /// waiting for the idle timeout. Requires at least read access.
    pub async fn release_connection(&self, ctx: &AuthCtx, conn_id: &str) -> Result<(), String> {
        let Some((_org_id, can_read, _can_update, _can_delete)) =
            self.effective_access(conn_id, ctx).await?
        else {
            return Err(ERR_FORBIDDEN.into());
        };
        if !can_read {
            return Err(ERR_FORBIDDEN.into());
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
            ssl_ca_file: None,
            ssl_client_cert_file: None,
            ssl_client_key_file: None,
            retry_writes: false,
            replica_set: None,
            pool_max: None,
            pool_min: None,
            connect_timeout_secs: None,
            idle_timeout_secs: None,
            max_lifetime_secs: None,
            server_selection_timeout_secs: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_mode: None,
            ssh_key_file: None,
            ssh_host_key_fingerprint: None,
            ssh_password: None,
            ssh_key_passphrase: None,
        }
    }

    async fn owner_and_org(store: &Store) -> (AuthCtx, String) {
        // Unique subject/email per call — tests create several orgs (each
        // with its own owner) in one run, and `users.email` is UNIQUE.
        let sub = format!("owner-{}", uuid::Uuid::new_v4());
        let email = format!("{sub}@x.com");
        let user = store.user_upsert_oauth("google", &sub, &email, "Owner", None).await.unwrap();
        let org = store.org_create("Acme", &user.id).await.unwrap();
        (AuthCtx { user_id: user.id, email, name: "Owner".into() }, org.id)
    }

    async fn member_of(store: &Store, org_id: &str, role: OrgRole) -> AuthCtx {
        let sub = format!("member-{}", uuid::Uuid::new_v4());
        let email = format!("{sub}@x.com");
        let user = store.user_upsert_oauth("google", &sub, &email, "Member", None).await.unwrap();
        let owner = store.org_members(org_id).await.unwrap();
        let owner_id = owner.iter().find(|m| m.role == OrgRole::Owner).unwrap().user_id.clone();
        let invite = store.invite_create(org_id, role, &owner_id, None, None).await.unwrap();
        store.invite_redeem(&invite.code, &user.id).await.unwrap();
        AuthCtx { user_id: user.id, email, name: "Member".into() }
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn authorization_gates() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let (owner, org_id) = owner_and_org(&store).await;
        let meta = gw.create_connection(&owner, &org_id, input()).await.unwrap();

        // Owner passes even against a dead adapter (that fails later, not at authz).
        let err = gw.execute_op(&owner, &meta.id, &read_op()).await.err().unwrap();
        assert!(!err.contains(ERR_FORBIDDEN), "owner should pass authz");

        // Someone from a DIFFERENT org (not a member at all) is forbidden outright.
        let outsider_store = test_store().await;
        let _ = outsider_store; // separate schema; just need a non-member ctx below
        let (_other_owner, other_org) = owner_and_org(&store).await;
        let outsider = member_of(&store, &other_org, OrgRole::Owner).await;
        let err = gw.list_tables(&outsider, &meta.id).await.err().unwrap();
        assert_eq!(err, ERR_FORBIDDEN);

        // A Viewer in the SAME org can read but not write.
        let viewer = member_of(&store, &org_id, OrgRole::Viewer).await;
        let err = gw.run_sql(&viewer, &meta.id, "SELECT 1").await.err().unwrap();
        assert_eq!(err, ERR_READONLY);
        let err3 = gw.execute_op(&viewer, &meta.id, &read_op()).await.err().unwrap();
        assert!(!err3.contains(ERR_FORBIDDEN) && !err3.contains(ERR_READONLY));

        // A Member gets read+write by default but not delete.
        let member = member_of(&store, &org_id, OrgRole::Member).await;
        let edited = gw.update_conn_details(&member, &meta.id, input()).await.unwrap();
        assert_eq!(edited.name, "gw");
        assert_eq!(gw.delete_connection(&member, &meta.id).await.err().unwrap(), ERR_FORBIDDEN);

        // An explicit grant override can lift a Viewer above their role default.
        store.grant_upsert(&meta.id, &viewer.user_id, true, true, true).await.unwrap();
        gw.delete_connection(&viewer, &meta.id).await.unwrap();
        assert!(gw.visible_connections(&owner, &org_id).await.unwrap().is_empty());
    }

    fn read_op() -> QueryOp {
        serde_json::from_str(r#"{"kind":"select","table":"t","limit":5}"#).unwrap()
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn visibility_filtering() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let (owner, org_id) = owner_and_org(&store).await;
        let m1 = gw.create_connection(&owner, &org_id, input()).await.unwrap();
        let _m2 = gw.create_connection(&owner, &org_id, input()).await.unwrap();

        assert_eq!(gw.visible_connections(&owner, &org_id).await.unwrap().len(), 2);

        // A fresh member sees BOTH (org-wide default access), unlike the old
        // flat per-token model where absence of a grant meant zero visibility.
        let member = member_of(&store, &org_id, OrgRole::Member).await;
        assert_eq!(gw.visible_connections(&member, &org_id).await.unwrap().len(), 2);

        // A grant override can also RESTRICT visibility below the role
        // default by dropping can_read.
        store.grant_upsert(&m1.id, &member.user_id, false, false, false).await.unwrap();
        let vis = gw.visible_connections(&member, &org_id).await.unwrap();
        assert_eq!(vis.len(), 1);
        assert!(!serde_json::to_string(&vis).unwrap().contains("password"));
    }

    /// A non-Postgres `kind` connection dispatches to the matching adapter
    /// (`MongoAdapter::connect`, per its distinctive error text) instead of
    /// always going through Postgres — the point of generalizing `pools` to
    /// `Arc<dyn DbAdapter>` and matching on `AdapterParams` in `adapter()`.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn dispatches_by_connection_kind() {
        let store = test_store().await;
        let gw = Gateway::new(store.clone());
        let (owner, org_id) = owner_and_org(&store).await;
        let mut mongo_input = input();
        mongo_input.kind = crate::api::DbKind::Mongodb;
        let meta = gw.create_connection(&owner, &org_id, mongo_input).await.unwrap();
        assert_eq!(meta.kind, crate::api::DbKind::Mongodb);

        let err = gw.list_tables(&owner, &meta.id).await.err().unwrap();
        // Postgres's connect error never mentions "mongo" — this fails via
        // MongoAdapter::connect's own error text, confirming dispatch.
        assert!(err.contains("mongo"), "expected a Mongo connect error, got: {err}");
    }
}
