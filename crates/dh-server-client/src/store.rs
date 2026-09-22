//! Shapes shared between the desktop app and the team server for the
//! server's audit log and current time (spec 0012). The `Store` type
//! itself — the Postgres pool, migrations, and every other store method —
//! lives in `dh-server`'s own `store` module; it is genuinely server only.

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub ts_ms: i64,
    pub org_id: Option<String>,
    pub user_id: Option<String>,
    pub action: String,
    pub target: String,
    pub detail: Option<String>,
}
