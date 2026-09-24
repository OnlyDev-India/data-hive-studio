//! Organizations: creation, membership + roles, and shareable invite codes.
//! Files, by job:
//! - `create`: who may create an org, the org itself, the server owner's list
//! - `members`: role changes, removal and leaving
//! - `invites`: email invites into an org, pending list, accept and decline
//! - `links`: the shareable link (create, list, revoke, redeem)
//! The shared shapes (`OrgRole`, `Organization`, `OrgMember`, `OrgInvite`)
//! live in `dh_server_client::orgs` (spec 0012).

use crate::store::Store;
use dh_server_client::orgs::{OrgMember, OrgRole, Organization};
use sqlx::Row;

pub const ERR_NOT_A_MEMBER: &str = "not a member of this organization";
pub const ERR_INVITE_INVALID: &str = "invite code is invalid, expired, or exhausted";

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

mod create;
mod invites;
mod links;
mod members;
#[cfg(test)]
mod create_tests;
#[cfg(test)]
mod invites_tests;
#[cfg(test)]
mod links_tests;
#[cfg(test)]
mod members_tests;
#[cfg(test)]
mod tests;

impl Store {
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
                let role = OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Member);
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
                role: OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Member),
                joined_ms: r.get("joined_ms"),
            })
            .collect())
    }
}
