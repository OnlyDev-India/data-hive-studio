//! Per-connection grant override shapes shared between the desktop app and
//! the team server: `(connection, user)` → three booleans
//! (`can_read`/`can_update`/`can_delete`). Unlike the old per-token grant
//! table, this is no longer the ONLY access-control mechanism — it's an
//! exception list layered on top of the caller's `OrgRole` default (see
//! `orgs::OrgRole::default_access` and `dh-server`'s
//! `gateway::Gateway::authorize`). A row here means "this specific user's
//! access to this specific connection is different from what their org role
//! would normally give them" — restrict a member to read only on one
//! connection, or grant one extra access. The `impl Store` methods live in
//! `dh-server`'s own `grants` module.

/// Effective data-access level derived from a caller's resolved grant
/// (role default merged with any override). Returned by
/// `Gateway::authorize()` so callers know what they can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataAccess {
    Readonly,
    Readwrite,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Grant {
    pub conn_id: String,
    pub user_id: String,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
}
