//! The device list and sign out (spec 0010, sessions): what a person can see
//! and end about their own sessions, and the one owner call that ends every
//! session of someone else. Sign out everywhere, the owner call and (in a
//! later slice) suspend all go through [`Store::sessions_end_for_user`].

use super::AccessError;
use crate::server::store::{audit_in, now_ms, Store};
use sqlx::Row;

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

impl Store {
    /// The caller's live sessions, most recently used first. Never anyone
    /// else's.
    pub async fn sessions_list(&self, user_id: &str, current_session_id: &str) -> Result<Vec<SessionInfo>, String> {
        self.sessions_list_at(user_id, current_session_id, now_ms()).await
    }

    pub(crate) async fn sessions_list_at(
        &self,
        user_id: &str,
        current_session_id: &str,
        now: i64,
    ) -> Result<Vec<SessionInfo>, String> {
        let rows = sqlx::query(
            "SELECT id, device_name, platform, created_ms, last_used_ms FROM device_sessions
             WHERE user_id = $1 AND idle_expires_ms > $2 AND absolute_expires_ms > $2
             ORDER BY last_used_ms DESC, created_ms DESC",
        )
        .bind(user_id)
        .bind(now)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let id: String = r.get("id");
                SessionInfo {
                    current: id == current_session_id,
                    id,
                    device_name: r.get("device_name"),
                    platform: r.get("platform"),
                    created_ms: r.get("created_ms"),
                    last_used_ms: r.get("last_used_ms"),
                }
            })
            .collect())
    }

    /// End one of the caller's sessions. A session that is not the caller's is
    /// `NotFound`, never `Forbidden`, so ids cannot be probed. Signing out this
    /// device is the same call with the current session id.
    pub async fn session_end(&self, user_id: &str, session_id: &str) -> Result<(), AccessError> {
        let row = sqlx::query("DELETE FROM device_sessions WHERE id = $1 AND user_id = $2 RETURNING device_name")
            .bind(session_id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AccessError::NotFound)?;
        let name: String = row.get("device_name");
        let _ = audit_in(&self.pool, user_id, "session.ended", session_id, Some(&name)).await;
        Ok(())
    }

    /// End every session of `user_id`, and every access token with them.
    /// Returns how many sessions ended. Writes no audit row: the callers say
    /// why (sign out everywhere, the owner, later a suspend).
    pub async fn sessions_end_for_user(&self, user_id: &str) -> Result<u64, String> {
        sqlx::query("DELETE FROM device_sessions WHERE user_id = $1")
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map(|r| r.rows_affected())
            .map_err(|e| e.to_string())
    }

    /// Sign out everywhere: every session of the caller, this one included.
    pub async fn sessions_end_all(&self, user_id: &str, current_session_id: &str) -> Result<u64, String> {
        let ended = self.sessions_end_for_user(user_id).await?;
        let _ = audit_in(&self.pool, user_id, "session.ended_all", current_session_id, Some(&format!("{ended} sessions")))
            .await;
        Ok(ended)
    }

    /// The server owner ends every session of `user_id`. The caller must
    /// already be checked as the owner. `NotFound` when there is no such
    /// person. The audit row carries the person's id, not the owner's, and
    /// names the owner in its detail.
    pub async fn sessions_end_by_owner(&self, owner_id: &str, user_id: &str) -> Result<u64, AccessError> {
        if self.user_get(user_id).await.map_err(AccessError::Other)?.is_none() {
            return Err(AccessError::NotFound);
        }
        let ended = self.sessions_end_for_user(user_id).await.map_err(AccessError::Other)?;
        let _ = audit_in(
            &self.pool,
            user_id,
            "session.ended_by_owner",
            user_id,
            Some(&format!("{ended} sessions, ended by {owner_id}")),
        )
        .await;
        Ok(ended)
    }
}
