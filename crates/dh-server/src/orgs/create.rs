//! Org creation (spec 0011): who may create one, the org itself, and the
//! server owner's org list. `may_create_org` (in `dh_server_client::auth`) is
//! the one place eligibility is decided.

use super::slugify;
use crate::store::{audit_org_in, now_ms, Store};
use dh_server_client::auth::{may_create_org, AccessError, AuthCtx, ServerRole};
use dh_server_client::orgs::{Organization, ServerOrg};
use sqlx::Row;

const NAME_MAX: usize = 80;

fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

impl Store {
    /// Whether `ctx` may create an org right now, for `/v1/me`. Reads the
    /// person's current row, the open policy and their created org count.
    pub async fn can_create_org(&self, ctx: &AuthCtx) -> Result<bool, String> {
        if ctx.is_owner() {
            return Ok(true);
        }
        let open = self.open_org_creation().await?;
        let created: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM organizations WHERE created_by=$1)")
            .bind(&ctx.user_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(may_create_org(ctx, open, created))
    }

    /// Create a new organization; the creator becomes its owner. One
    /// transaction that first locks the caller's `users` row, so two
    /// simultaneous creates by one person make exactly one org.
    pub async fn org_create(&self, ctx: &AuthCtx, name: &str) -> Result<Organization, AccessError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > NAME_MAX {
            return Err(AccessError::BadRequest(format!("name must be 1 to {NAME_MAX} characters")));
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        // Re-read the role and switch under the lock: the request's copy may
        // be a moment stale, and this decision must not be.
        let row = sqlx::query("SELECT server_role, can_create_orgs FROM users WHERE id=$1 FOR UPDATE")
            .bind(&ctx.user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(sqlx_err)?
            .ok_or(AccessError::Forbidden)?;
        let fresh = AuthCtx {
            server_role: ServerRole::parse(&row.get::<String, _>("server_role")).unwrap_or(ServerRole::Member),
            can_create_orgs: row.get("can_create_orgs"),
            ..ctx.clone()
        };
        if !fresh.is_owner() {
            let created: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM organizations WHERE created_by=$1)")
                    .bind(&ctx.user_id)
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(sqlx_err)?;
            // The limit counts every org ever created, whichever policy let
            // the person in, so a person who already made one hears
            // `org_limit` even if the policy or switch has since changed.
            if created {
                return Err(AccessError::OrgLimit);
            }
            let open: bool = sqlx::query_scalar("SELECT open_org_creation FROM server_settings WHERE id=1")
                .fetch_one(&mut *tx)
                .await
                .map_err(sqlx_err)?;
            if !may_create_org(&fresh, open, created) {
                return Err(AccessError::Forbidden);
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let ts = now_ms();
        // Slugs are unique; suffix a clash instead of failing the create.
        let base_slug = slugify(name);
        let mut slug = base_slug.clone();
        for attempt in 1..20 {
            let exists = sqlx::query("SELECT 1 FROM organizations WHERE slug=$1")
                .bind(&slug)
                .fetch_optional(&mut *tx)
                .await
                .map_err(sqlx_err)?
                .is_some();
            if !exists {
                break;
            }
            slug = format!("{base_slug}-{attempt}");
        }
        sqlx::query("INSERT INTO organizations (id, name, slug, created_ms, created_by) VALUES ($1,$2,$3,$4,$5)")
            .bind(&id)
            .bind(name)
            .bind(&slug)
            .bind(ts)
            .bind(&ctx.user_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        sqlx::query("INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,'owner',$3)")
            .bind(&id)
            .bind(&ctx.user_id)
            .bind(ts)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        audit_org_in(&mut *tx, Some(&id), &ctx.user_id, "org.created", &id, None).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;

        Ok(Organization { id, name: name.to_string(), slug, created_ms: ts })
    }

    /// Every org with its creator, owners and member count, for the server
    /// owner (AC-3). Names and counts only: no members, invites or connections.
    pub async fn server_orgs_list(&self, actor: &AuthCtx) -> Result<Vec<ServerOrg>, AccessError> {
        if !actor.is_owner() {
            return Err(AccessError::Forbidden);
        }
        let rows = sqlx::query(
            "SELECT o.id, o.name, o.slug, o.created_ms, cu.email AS created_by,
                    (SELECT count(*) FROM org_members m WHERE m.org_id = o.id) AS member_count,
                    ARRAY(SELECT u.email FROM org_members m JOIN users u ON u.id = m.user_id
                          WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY u.email) AS owners
             FROM organizations o LEFT JOIN users cu ON cu.id = o.created_by
             ORDER BY o.created_ms, o.id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(sqlx_err)?;
        Ok(rows
            .into_iter()
            .map(|r| ServerOrg {
                id: r.get("id"),
                name: r.get("name"),
                slug: r.get("slug"),
                created_ms: r.get("created_ms"),
                created_by: r.get("created_by"),
                member_count: r.get("member_count"),
                owners: r.get("owners"),
            })
            .collect())
    }
}
