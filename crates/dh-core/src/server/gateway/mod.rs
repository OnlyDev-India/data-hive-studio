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

mod browse;
mod data;
mod connections;
#[cfg(test)]
mod tests;

use crate::api::QueryOp;
use crate::db::{DbAdapter, MongoAdapter, PgAdapter};
use crate::server::auth::AuthCtx;
use crate::server::grants::DataAccess;
use crate::server::store::Store;
use crate::server::vault::AdapterParams;
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

/// Coarse action label for the audit trail.
fn op_action(op: &QueryOp) -> &'static str {
    match op {
        QueryOp::Select { .. } => "op.select",
        QueryOp::Count { .. } => "op.count",
        QueryOp::SelectDistinct { .. } => "op.distinct",
        QueryOp::Insert { .. } => "op.insert",
        QueryOp::Update { .. } => "op.update",
        QueryOp::BulkUpdate { .. } => "op.bulk_update",
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

    pub(super) async fn adapter(&self, conn_id: &str) -> Result<Arc<dyn DbAdapter>, String> {
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
    pub(super) async fn effective_access(
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
}
