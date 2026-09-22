//! The connection gateway's one shared shape. The `Gateway` struct and
//! every execution method are genuinely server only and live in
//! `dh-server`'s own `gateway` module (spec 0012).

use crate::vault::ConnMeta;

/// A shared connection as visible to ONE caller: metadata plus that caller's
/// effective access.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnWithAccess {
    #[serde(flatten)]
    pub meta: ConnMeta,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
}
