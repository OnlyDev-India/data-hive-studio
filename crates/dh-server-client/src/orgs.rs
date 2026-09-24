//! Organization shapes shared between the desktop app and the team server.
//!
//! Role hierarchy (`OrgRole`, ordered least → most privileged): `Member` <
//! `Admin` < `Owner`. Default per-connection access for a role is defined
//! here (`OrgRole::default_access`) and used by `dh-server`'s
//! `gateway::Gateway::authorize()` as the starting point before any
//! `connection_grants` override is applied. The `impl Store` methods
//! (creation, membership, invites) live in `dh-server`'s own `orgs` module.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrgRole {
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
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(OrgRole::Owner),
            "admin" => Some(OrgRole::Admin),
            "member" => Some(OrgRole::Member),
            _ => None,
        }
    }

    /// Owner/Admin manage everything in the org (including deleting
    /// connections); Member gets read+write by default but not delete.
    /// `connection_grants` can override any of these per (connection, user)
    /// — see `dh-server`'s `gateway` module.
    pub fn default_access(self) -> (bool, bool, bool) {
        match self {
            OrgRole::Owner | OrgRole::Admin => (true, true, true),
            OrgRole::Member => (true, true, false),
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

/// A shareable link (spec 0011): always the `member` role, with a use limit
/// of 1 to 100 and an expiry, both required.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrgLink {
    pub code: String,
    pub org_id: String,
    pub role: OrgRole,
    pub created_by: String,
    pub max_uses: i32,
    pub uses_count: i32,
    pub expires_ms: i64,
    pub created_ms: i64,
}

/// An email invite into one org, as the org's Invites tab shows it (spec
/// 0011). Different from [`OrgLink`], the shareable link.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OrgEmailInvite {
    pub id: String,
    pub org_id: String,
    pub email: String,
    pub role: OrgRole,
    /// Email of the person who made the invite.
    pub created_by: String,
    pub created_ms: i64,
    pub expires_ms: Option<i64>,
    pub used_ms: Option<i64>,
    /// Email of the account that accepted it.
    pub used_by: Option<String>,
    pub status: crate::auth::InviteStatus,
}

/// A new email invite is `Created` (HTTP 201); inviting an email that already
/// has an unused invite into the org `Refreshed` it (HTTP 200).
#[derive(Debug, Clone)]
pub enum OrgInviteWrite {
    Created(OrgEmailInvite),
    Refreshed(OrgEmailInvite),
}

/// An invite waiting for the signed in person to accept or decline.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingInvite {
    pub id: String,
    pub org_id: String,
    pub org_name: String,
    pub role: OrgRole,
    pub inviter_name: String,
    pub inviter_email: String,
    pub expires_ms: Option<i64>,
}

/// One row of the server owner's org list (spec 0011, AC-3): names and
/// counts only, never members, invites or connections.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ServerOrg {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_ms: i64,
    /// The creator's email; null for an org that predates spec 0011.
    pub created_by: Option<String>,
    pub member_count: i64,
    /// Emails of the org's owners.
    pub owners: Vec<String>,
}

/// Server wide settings the owner can read on the Server access page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ServerSettings {
    pub open_org_creation: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_ordering_and_access() {
        assert!(OrgRole::Owner > OrgRole::Admin);
        assert!(OrgRole::Admin > OrgRole::Member);
        assert_eq!(OrgRole::Member.default_access(), (true, true, false));
        assert_eq!(OrgRole::Admin.default_access(), (true, true, true));
        assert!(!OrgRole::Member.can_manage_members());
        assert!(OrgRole::Admin.can_manage_members());
    }
}
