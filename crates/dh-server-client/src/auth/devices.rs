//! The device list shape (spec 0010). The `impl Store` methods that list
//! and end sessions live in `dh-server`'s own `auth::devices`.

/// One row of "My devices".
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub device_name: String,
    /// `desktop` or `web`.
    pub platform: String,
    pub created_ms: i64,
    pub last_used_ms: i64,
    /// Whether this is the session the request was made with.
    pub current: bool,
}
