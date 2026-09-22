use dh_server_client::auth::AuthCtx;
use dh_server_client::gateway::ConnWithAccess;
use dh_server_client::vault::{ConnInput, ConnMeta};
use crate::vault::AdapterParams;
use super::{ERR_FORBIDDEN, Gateway};

impl Gateway {
    /// Publish a NEW shared connection in `org_id`. Requires being a member
    /// of the org (every org role, `Member` and up, may publish). The
    /// creator gets an explicit full-access grant override so they keep
    /// full control even if their role default wouldn't otherwise cover it
    /// (relevant once per-connection restrictions are layered on more
    /// broadly).
    pub async fn create_connection(
        &self,
        ctx: &AuthCtx,
        org_id: &str,
        input: ConnInput,
    ) -> Result<ConnMeta, String> {
        self.store.org_role(org_id, &ctx.user_id).await?.ok_or(ERR_FORBIDDEN)?;
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
    ) -> Result<ConnMeta, String> {
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
            .ok_or(crate::vault::ERR_NOT_FOUND)?;
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
    /// connection in that org they're a member of, tagged with their
    /// effective access.
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
