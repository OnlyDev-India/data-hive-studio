//! Organizations: creation, membership + roles, and shareable invite codes.
//!
//! Role hierarchy (`OrgRole`, ordered least → most privileged): `Viewer` <
//! `Member` < `Admin` < `Owner`. Default per-connection access for a role is
//! defined here (`OrgRole::default_access`) and used by `gateway.rs`'s
//! `authorize()` as the starting point before any `connection_grants`
//! override is applied.

use super::store::{now_ms, Store};
use sqlx::Row;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrgRole {
    Viewer,
    Member,
    Admin,
    Owner,
}

impl OrgRole {
    pub fn as_str(self) -> &'static str {
        match self {
            OrgRole::Owner => "owner",
            OrgRole::Admin => "admin",
            OrgRole::Member => "member",
            OrgRole::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(OrgRole::Owner),
            "admin" => Some(OrgRole::Admin),
            "member" => Some(OrgRole::Member),
            "viewer" => Some(OrgRole::Viewer),
            _ => None,
        }
    }

    /// Owner/Admin manage everything in the org (including deleting
    /// connections); Member gets read+write by default but not delete;
    /// Viewer is strictly read-only. `connection_grants` can override any
    /// of these per (connection, user) — see `gateway.rs`.
    pub fn default_access(self) -> (bool, bool, bool) {
        match self {
            OrgRole::Owner | OrgRole::Admin => (true, true, true),
            OrgRole::Member => (true, true, false),
            OrgRole::Viewer => (true, false, false),
        }
    }

    /// Owner/Admin may manage org membership (invite, change roles, remove
    /// members).
    pub fn can_manage_members(self) -> bool {
        matches!(self, OrgRole::Owner | OrgRole::Admin)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Organization {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_ms: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrgMember {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub role: OrgRole,
    pub joined_ms: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrgInvite {
    pub code: String,
    pub org_id: String,
    pub role: OrgRole,
    pub created_by: String,
    pub max_uses: Option<i32>,
    pub uses_count: i32,
    pub expires_ms: Option<i64>,
    pub created_ms: i64,
}

pub const ERR_NOT_A_MEMBER: &str = "not a member of this organization";
pub const ERR_INVITE_INVALID: &str = "invite code is invalid, expired, or exhausted";
pub const ERR_LAST_OWNER: &str = "cannot remove the organization's last owner";

fn slugify(name: &str) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let trimmed = base.trim_matches('-');
    if trimmed.is_empty() {
        "org".to_string()
    } else {
        // Collapse repeated dashes ("acme  inc" -> "acme-inc", not "acme--inc").
        let mut out = String::with_capacity(trimmed.len());
        let mut last_dash = false;
        for c in trimmed.chars() {
            if c == '-' {
                if !last_dash {
                    out.push(c);
                }
                last_dash = true;
            } else {
                out.push(c);
                last_dash = false;
            }
        }
        out
    }
}

impl Store {
    /// Create a new organization; the creator becomes its `Owner`.
    pub async fn org_create(&self, name: &str, creator_user_id: &str) -> Result<Organization, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let ts = now_ms();
        // Slugs must be unique; append a short suffix on collision rather
        // than failing the whole create — organization names collide far
        // more often than a person would care about the exact slug.
        let base_slug = slugify(name);
        let mut slug = base_slug.clone();
        for attempt in 1..20 {
            let exists: bool = sqlx::query("SELECT 1 FROM organizations WHERE slug=$1")
                .bind(&slug)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| e.to_string())?
                .is_some();
            if !exists {
                break;
            }
            slug = format!("{base_slug}-{attempt}");
        }

        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO organizations (id, name, slug, created_ms) VALUES ($1,$2,$3,$4)")
            .bind(&id)
            .bind(name)
            .bind(&slug)
            .bind(ts)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,'owner',$3)",
        )
        .bind(&id)
        .bind(creator_user_id)
        .bind(ts)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;

        Ok(Organization { id, name: name.to_string(), slug, created_ms: ts })
    }

    /// Every organization `user_id` belongs to, with their role in each.
    pub async fn orgs_for_user(&self, user_id: &str) -> Result<Vec<(Organization, OrgRole)>, String> {
        let rows = sqlx::query(
            "SELECT o.id AS id, o.name AS name, o.slug AS slug, o.created_ms AS created_ms, m.role AS role
             FROM organizations o JOIN org_members m ON m.org_id = o.id
             WHERE m.user_id = $1 ORDER BY o.created_ms ASC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let org = Organization {
                    id: r.get("id"),
                    name: r.get("name"),
                    slug: r.get("slug"),
                    created_ms: r.get("created_ms"),
                };
                let role = OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Viewer);
                (org, role)
            })
            .collect())
    }

    /// The caller's role in one org, if they're a member.
    pub async fn org_role(&self, org_id: &str, user_id: &str) -> Result<Option<OrgRole>, String> {
        let row = sqlx::query("SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2")
            .bind(org_id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.and_then(|r| OrgRole::parse(&r.get::<String, _>("role"))))
    }

    pub async fn org_members(&self, org_id: &str) -> Result<Vec<OrgMember>, String> {
        let rows = sqlx::query(
            "SELECT m.user_id AS user_id, u.email AS email, u.name AS name, m.role AS role, m.joined_ms AS joined_ms
             FROM org_members m JOIN users u ON u.id = m.user_id
             WHERE m.org_id = $1 ORDER BY m.joined_ms ASC",
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| OrgMember {
                user_id: r.get("user_id"),
                email: r.get("email"),
                name: r.get("name"),
                role: OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Viewer),
                joined_ms: r.get("joined_ms"),
            })
            .collect())
    }

    /// Change a member's role. Refuses to demote/remove the organization's
    /// LAST remaining owner — every org must always have at least one.
    pub async fn org_member_set_role(&self, org_id: &str, user_id: &str, role: OrgRole) -> Result<(), String> {
        if role != OrgRole::Owner && self.org_is_last_owner(org_id, user_id).await? {
            return Err(ERR_LAST_OWNER.into());
        }
        let n = sqlx::query("UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3")
            .bind(role.as_str())
            .bind(org_id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();
        if n == 0 {
            Err(ERR_NOT_A_MEMBER.into())
        } else {
            Ok(())
        }
    }

    pub async fn org_member_remove(&self, org_id: &str, user_id: &str) -> Result<(), String> {
        if self.org_is_last_owner(org_id, user_id).await? {
            return Err(ERR_LAST_OWNER.into());
        }
        sqlx::query("DELETE FROM org_members WHERE org_id=$1 AND user_id=$2")
            .bind(org_id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn org_is_last_owner(&self, org_id: &str, user_id: &str) -> Result<bool, String> {
        let role = self.org_role(org_id, user_id).await?;
        if role != Some(OrgRole::Owner) {
            return Ok(false);
        }
        let (owner_count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM org_members WHERE org_id=$1 AND role='owner'")
                .bind(org_id)
                .fetch_one(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        Ok(owner_count <= 1)
    }

    /// Mint a shareable invite code for `org_id`, granting `role` on redemption.
    pub async fn invite_create(
        &self,
        org_id: &str,
        role: OrgRole,
        created_by: &str,
        max_uses: Option<i32>,
        expires_ms: Option<i64>,
    ) -> Result<OrgInvite, String> {
        let code = hex::encode(rand::random::<[u8; 12]>());
        let ts = now_ms();
        sqlx::query(
            "INSERT INTO org_invites (code, org_id, role, created_by, max_uses, uses_count, expires_ms, created_ms)
             VALUES ($1,$2,$3,$4,$5,0,$6,$7)",
        )
        .bind(&code)
        .bind(org_id)
        .bind(role.as_str())
        .bind(created_by)
        .bind(max_uses)
        .bind(expires_ms)
        .bind(ts)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(OrgInvite {
            code,
            org_id: org_id.to_string(),
            role,
            created_by: created_by.to_string(),
            max_uses,
            uses_count: 0,
            expires_ms,
            created_ms: ts,
        })
    }

    pub async fn invites_for_org(&self, org_id: &str) -> Result<Vec<OrgInvite>, String> {
        let rows = sqlx::query(
            "SELECT code, org_id, role, created_by, max_uses, uses_count, expires_ms, created_ms
             FROM org_invites WHERE org_id=$1 ORDER BY created_ms DESC",
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| OrgInvite {
                code: r.get("code"),
                org_id: r.get("org_id"),
                role: OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Viewer),
                created_by: r.get("created_by"),
                max_uses: r.get("max_uses"),
                uses_count: r.get("uses_count"),
                expires_ms: r.get("expires_ms"),
                created_ms: r.get("created_ms"),
            })
            .collect())
    }

    pub async fn invite_revoke(&self, org_id: &str, code: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM org_invites WHERE org_id=$1 AND code=$2")
            .bind(org_id)
            .bind(code)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Redeem an invite code for `user_id` — adds them to the org with the
    /// invite's role (or, if already a member, leaves their existing role
    /// untouched rather than downgrading them). Atomic: the uses-count bump
    /// and membership insert happen in one transaction so concurrent
    /// redemptions of a `max_uses`-limited code can't both succeed past the
    /// limit.
    pub async fn invite_redeem(&self, code: &str, user_id: &str) -> Result<Organization, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let invite = sqlx::query(
            "SELECT org_id, role, max_uses, uses_count, expires_ms FROM org_invites WHERE code=$1 FOR UPDATE",
        )
        .bind(code)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or(ERR_INVITE_INVALID)?;

        let expires_ms: Option<i64> = invite.get("expires_ms");
        if expires_ms.is_some_and(|e| e < now_ms()) {
            return Err(ERR_INVITE_INVALID.into());
        }
        let max_uses: Option<i32> = invite.get("max_uses");
        let uses_count: i32 = invite.get("uses_count");
        if max_uses.is_some_and(|m| uses_count >= m) {
            return Err(ERR_INVITE_INVALID.into());
        }
        let org_id: String = invite.get("org_id");
        let role: OrgRole = OrgRole::parse(&invite.get::<String, _>("role")).unwrap_or(OrgRole::Viewer);

        sqlx::query("UPDATE org_invites SET uses_count = uses_count + 1 WHERE code=$1")
            .bind(code)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,$3,$4)
             ON CONFLICT (org_id, user_id) DO NOTHING",
        )
        .bind(&org_id)
        .bind(user_id)
        .bind(role.as_str())
        .bind(now_ms())
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;

        let org_row = sqlx::query("SELECT id, name, slug, created_ms FROM organizations WHERE id=$1")
            .bind(&org_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;

        Ok(Organization {
            id: org_row.get("id"),
            name: org_row.get("name"),
            slug: org_row.get("slug"),
            created_ms: org_row.get("created_ms"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn user(store: &Store, email: &str) -> String {
        store.user_upsert_oauth("google", email, email, email, None).await.unwrap().id
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn create_org_makes_creator_owner() {
        let store = super::super::store::test_store().await;
        let alice = user(&store, "alice").await;
        let org = store.org_create("Acme Inc", &alice).await.unwrap();
        assert_eq!(org.slug, "acme-inc");
        assert_eq!(store.org_role(&org.id, &alice).await.unwrap(), Some(OrgRole::Owner));
        let members = store.org_members(&org.id).await.unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].role, OrgRole::Owner);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn slug_collision_gets_suffixed() {
        let store = super::super::store::test_store().await;
        let alice = user(&store, "alice").await;
        let o1 = store.org_create("Acme", &alice).await.unwrap();
        let o2 = store.org_create("Acme", &alice).await.unwrap();
        assert_eq!(o1.slug, "acme");
        assert_eq!(o2.slug, "acme-1");
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn invite_lifecycle_and_limits() {
        let store = super::super::store::test_store().await;
        let alice = user(&store, "alice").await;
        let bob = user(&store, "bob").await;
        let org = store.org_create("Acme", &alice).await.unwrap();

        let invite = store.invite_create(&org.id, OrgRole::Member, &alice, Some(1), None).await.unwrap();
        assert_eq!(store.orgs_for_user(&bob).await.unwrap().len(), 0);

        let joined = store.invite_redeem(&invite.code, &bob).await.unwrap();
        assert_eq!(joined.id, org.id);
        assert_eq!(store.org_role(&org.id, &bob).await.unwrap(), Some(OrgRole::Member));

        // max_uses of 1 already consumed — a second redemption fails.
        let carol = user(&store, "carol").await;
        assert_eq!(
            store.invite_redeem(&invite.code, &carol).await.err().unwrap(),
            ERR_INVITE_INVALID
        );

        // Unknown code.
        assert_eq!(
            store.invite_redeem("does-not-exist", &carol).await.err().unwrap(),
            ERR_INVITE_INVALID
        );
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn last_owner_cannot_be_demoted_or_removed() {
        let store = super::super::store::test_store().await;
        let alice = user(&store, "alice").await;
        let org = store.org_create("Acme", &alice).await.unwrap();

        assert_eq!(
            store.org_member_set_role(&org.id, &alice, OrgRole::Admin).await.err().unwrap(),
            ERR_LAST_OWNER
        );
        assert_eq!(store.org_member_remove(&org.id, &alice).await.err().unwrap(), ERR_LAST_OWNER);

        // A second owner makes demoting/removing the first one fine.
        let bob = user(&store, "bob").await;
        let invite = store.invite_create(&org.id, OrgRole::Owner, &alice, None, None).await.unwrap();
        store.invite_redeem(&invite.code, &bob).await.unwrap();
        store.org_member_set_role(&org.id, &alice, OrgRole::Admin).await.unwrap();
        assert_eq!(store.org_role(&org.id, &alice).await.unwrap(), Some(OrgRole::Admin));
    }

    #[test]
    fn role_ordering_and_access() {
        assert!(OrgRole::Owner > OrgRole::Admin);
        assert!(OrgRole::Admin > OrgRole::Member);
        assert!(OrgRole::Member > OrgRole::Viewer);
        assert_eq!(OrgRole::Viewer.default_access(), (true, false, false));
        assert_eq!(OrgRole::Member.default_access(), (true, true, false));
        assert_eq!(OrgRole::Admin.default_access(), (true, true, true));
        assert!(!OrgRole::Member.can_manage_members());
        assert!(OrgRole::Admin.can_manage_members());
    }
}
