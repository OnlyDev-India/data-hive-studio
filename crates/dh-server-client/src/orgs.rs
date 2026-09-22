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
