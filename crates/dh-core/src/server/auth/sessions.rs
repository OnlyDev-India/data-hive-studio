//! Device sessions (spec 0010, sessions). A person has one session per device.
//! A session is a 15 minute access token (`dha_`) that renews from a renewal
//! token (`dhr_`) which changes on every use. A retired renewal token is
//! answered with the same new token for 30 seconds (a lost response, or two
//! tabs renewing together), and treated as theft after that.
//!
//! Every function that depends on the time takes `now`, so tests move the
//! clock instead of sleeping. Ending a session deletes its row, and its access
//! tokens go with it, so a revoke applies on the very next request.

use super::tokens::*;
use super::{AuthCtx, ServerRole};
use dh_server_client::crypto;
use crate::server::store::{audit_in, now_ms, Store};
use sqlx::{Postgres, Row, Transaction};

/// Why a token, code or verifier was refused. The router answers 401 for
/// `Unauthorized`, and clients never need to tell "expired" from "ended".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    Unauthorized,
    Other(String),
}

impl From<sqlx::Error> for AuthError {
    fn from(e: sqlx::Error) -> Self {
        AuthError::Other(e.to_string())
    }
}

/// Where a session lives: the desktop app (renewal token in the response body)
/// or the web page (renewal token only as an HttpOnly cookie).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Desktop,
    Web,
}

impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Desktop => "desktop",
            Platform::Web => "web",
        }
    }
}

/// The device a session belongs to. `device_id` is a random id the client made
/// once per install, and `device_name` is what the person sees in the list.
#[derive(Debug, Clone)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
}

/// A new pair of tokens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issued {
    pub user_id: String,
    pub session_id: String,
    pub access_token: String,
    /// Seconds the access token lives.
    pub expires_in: i64,
    pub refresh_token: String,
    /// Seconds until this session ends if it is not renewed (the web cookie's
    /// `Max-Age`).
    pub refresh_max_age_secs: i64,
}

impl Store {
    /// Start a session for `user_id` on `device`. A second sign in from the
    /// same device id replaces the first, and a person never holds more than
    /// 25: the one used longest ago makes room.
    pub async fn session_start(&self, user_id: &str, device: &DeviceInfo) -> Result<Issued, AuthError> {
        self.session_start_at(user_id, device, now_ms()).await
    }

    pub(crate) async fn session_start_at(
        &self,
        user_id: &str,
        device: &DeviceInfo,
        now: i64,
    ) -> Result<Issued, AuthError> {
        let mut tx = self.pool.begin().await?;
        // One start per person at a time, so the one per device rule and the
        // cap hold even when two sign ins land together.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))").bind(user_id).execute(&mut *tx).await?;
        sweep_expired(&mut tx, Some(user_id), now).await?;
        sqlx::query("DELETE FROM device_sessions WHERE user_id=$1 AND device_id=$2")
            .bind(user_id)
            .bind(&device.device_id)
            .execute(&mut *tx)
            .await?;
        let held: i64 = sqlx::query_scalar("SELECT count(*) FROM device_sessions WHERE user_id=$1")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;
        if held >= MAX_SESSIONS_PER_USER {
            sqlx::query(
                "DELETE FROM device_sessions WHERE id IN (
                     SELECT id FROM device_sessions WHERE user_id=$1
                     ORDER BY last_used_ms ASC, created_ms ASC LIMIT $2)",
            )
            .bind(user_id)
            .bind(held - (MAX_SESSIONS_PER_USER - 1))
            .execute(&mut *tx)
            .await?;
        }
        let session_id = uuid::Uuid::new_v4().to_string();
        let refresh_token = new_refresh_token();
        let absolute = now + ABSOLUTE_TTL_MS;
        let idle = (now + IDLE_TTL_MS).min(absolute);
        sqlx::query(
            "INSERT INTO device_sessions
                 (id, user_id, device_id, device_name, platform, created_ms, last_used_ms,
                  idle_expires_ms, absolute_expires_ms, refresh_hash, rotated_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$6)",
        )
        .bind(&session_id)
        .bind(user_id)
        .bind(&device.device_id)
        .bind(&device.device_name)
        .bind(device.platform.as_str())
        .bind(now)
        .bind(idle)
        .bind(absolute)
        .bind(crypto::hash_token(&refresh_token))
        .execute(&mut *tx)
        .await?;
        let access_token = insert_access_token(&mut tx, &session_id, now).await?;
        audit_in(&mut *tx, user_id, "session.created", &session_id, Some(&device.device_name)).await?;
        tx.commit().await?;
        Ok(Issued {
            user_id: user_id.to_string(),
            session_id,
            access_token,
            expires_in: ACCESS_TTL_MS / 1000,
            refresh_token,
            refresh_max_age_secs: (idle - now) / 1000,
        })
    }

    /// Renew a session from its renewal token. One transaction locks the
    /// session row, so two renewals can never both rotate.
    ///
    /// - the current token rotates to a new one and the old one is retired
    /// - a retired token inside 30 seconds gets the same new token again
    /// - a retired token after that ends the session (`session.reuse_detected`)
    /// - an unknown token, or a session past its idle or 90 day end, is refused
    pub async fn session_refresh(&self, refresh_token: &str) -> Result<Issued, AuthError> {
        self.session_refresh_at(refresh_token, now_ms()).await
    }

    pub(crate) async fn session_refresh_at(&self, refresh_token: &str, now: i64) -> Result<Issued, AuthError> {
        if !refresh_token.starts_with(REFRESH_PREFIX) {
            return Err(AuthError::Unauthorized);
        }
        let hash = crypto::hash_token(refresh_token);
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, user_id, device_name, idle_expires_ms, absolute_expires_ms, refresh_hash,
                    rotated_ms, replay_enc
             FROM device_sessions WHERE refresh_hash = $1 OR prev_refresh_hash = $1 FOR UPDATE",
        )
        .bind(&hash)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AuthError::Unauthorized)?;
        let id: String = row.get("id");
        let user_id: String = row.get("user_id");
        let absolute: i64 = row.get("absolute_expires_ms");
        if now > row.get::<i64, _>("idle_expires_ms") || now > absolute {
            end_row(&mut tx, &id).await?;
            tx.commit().await?;
            return Err(AuthError::Unauthorized);
        }
        let (idle_end, refresh_token) = if row.get::<String, _>("refresh_hash") == hash {
            let renewed = rotate(&mut tx, &self.master_key, &id, &hash, absolute, now).await?;
            sweep_expired(&mut tx, Some(&user_id), now).await?;
            renewed
        } else {
            let replay: Option<Vec<u8>> = row.get("replay_enc");
            let within = now - row.get::<i64, _>("rotated_ms") <= REPLAY_WINDOW_MS;
            match replay.filter(|_| within) {
                Some(enc) => {
                    let token = String::from_utf8(crypto::decrypt(&self.master_key, &enc)?)
                        .map_err(|e| AuthError::Other(e.to_string()))?;
                    (row.get("idle_expires_ms"), token)
                }
                None => {
                    end_row(&mut tx, &id).await?;
                    let name: String = row.get("device_name");
                    audit_in(&mut *tx, &user_id, "session.reuse_detected", &id, Some(&name)).await?;
                    tx.commit().await?;
                    return Err(AuthError::Unauthorized);
                }
            }
        };
        let access_token = insert_access_token(&mut tx, &id, now).await?;
        tx.commit().await?;
        Ok(Issued {
            user_id,
            session_id: id,
            access_token,
            expires_in: ACCESS_TTL_MS / 1000,
            refresh_token,
            refresh_max_age_secs: (idle_end - now) / 1000,
        })
    }

    /// Resolve a Bearer access token to the person and the session it belongs
    /// to. One query joins the token, its session and the user, so a demotion
    /// applies at once and a deleted session refuses on the next request.
    /// `last_used_ms` is written at most once a minute, in the same statement
    /// that clears a replay window that has passed.
    pub async fn verify_access(&self, bearer: &str) -> Option<AuthCtx> {
        self.verify_access_at(bearer, now_ms()).await
    }

    pub(crate) async fn verify_access_at(&self, bearer: &str, now: i64) -> Option<AuthCtx> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        if !token.starts_with(ACCESS_PREFIX) {
            return None;
        }
        let row = sqlx::query(
            "SELECT s.id AS session_id, s.user_id AS user_id, s.last_used_ms AS last_used_ms,
                    u.email AS email, u.name AS name,
                    u.server_role AS server_role, u.can_manage_roles AS can_manage_roles
             FROM access_tokens a
             JOIN device_sessions s ON s.id = a.session_id
             JOIN users u ON u.id = s.user_id
             WHERE a.token_hash = $1 AND a.expires_ms > $2
               AND s.idle_expires_ms > $2 AND s.absolute_expires_ms > $2",
        )
        .bind(crypto::hash_token(token))
        .bind(now)
        .fetch_optional(&self.pool)
        .await
        .ok()??;
        let session_id: String = row.get("session_id");
        if now - row.get::<i64, _>("last_used_ms") >= LAST_USED_THROTTLE_MS {
            let _ = sqlx::query(
                "UPDATE device_sessions
                 SET last_used_ms = $1,
                     replay_enc = CASE WHEN rotated_ms + $3 < $1 THEN NULL ELSE replay_enc END
                 WHERE id = $2",
            )
            .bind(now)
            .bind(&session_id)
            .bind(REPLAY_WINDOW_MS)
            .execute(&self.pool)
            .await;
        }
        let role: String = row.get("server_role");
        Some(AuthCtx {
            user_id: row.get("user_id"),
            session_id,
            email: row.get("email"),
            name: row.get("name"),
            server_role: ServerRole::parse(&role).unwrap_or(ServerRole::Member),
            can_manage_roles: row.get("can_manage_roles"),
        })
    }
}

/// Move a session to a new renewal token. The old one is kept as the previous
/// token, and the new one is kept encrypted for the replay window. Returns the
/// new idle end and the new token.
async fn rotate(
    tx: &mut Transaction<'_, Postgres>,
    master_key: &[u8; 32],
    id: &str,
    old_hash: &str,
    absolute: i64,
    now: i64,
) -> Result<(i64, String), AuthError> {
    let token = new_refresh_token();
    let idle = (now + IDLE_TTL_MS).min(absolute);
    sqlx::query(
        "UPDATE device_sessions
         SET prev_refresh_hash = $1, refresh_hash = $2, rotated_ms = $3, replay_enc = $4,
             idle_expires_ms = $5, last_used_ms = $3
         WHERE id = $6",
    )
    .bind(old_hash)
    .bind(crypto::hash_token(&token))
    .bind(now)
    .bind(crypto::encrypt(master_key, token.as_bytes())?)
    .bind(idle)
    .bind(id)
    .execute(&mut **tx)
    .await?;
    Ok((idle, token))
}

async fn insert_access_token(tx: &mut Transaction<'_, Postgres>, session_id: &str, now: i64) -> Result<String, AuthError> {
    let token = new_access_token();
    sqlx::query("INSERT INTO access_tokens (token_hash, session_id, expires_ms) VALUES ($1,$2,$3)")
        .bind(crypto::hash_token(&token))
        .bind(session_id)
        .bind(now + ACCESS_TTL_MS)
        .execute(&mut **tx)
        .await?;
    Ok(token)
}

async fn end_row(tx: &mut Transaction<'_, Postgres>, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM device_sessions WHERE id = $1").bind(id).execute(&mut **tx).await?;
    Ok(())
}

/// Lazy cleanup, run by sign in and renewal so no background task is needed:
/// expired login codes, expired access tokens, and the person's own sessions
/// that have passed either end.
async fn sweep_expired(tx: &mut Transaction<'_, Postgres>, user_id: Option<&str>, now: i64) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM login_codes WHERE expires_ms < $1").bind(now).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM access_tokens WHERE expires_ms < $1").bind(now).execute(&mut **tx).await?;
    if let Some(user_id) = user_id {
        sqlx::query(
            "DELETE FROM device_sessions
             WHERE user_id = $1 AND (idle_expires_ms < $2 OR absolute_expires_ms < $2)",
        )
        .bind(user_id)
        .bind(now)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

impl From<String> for AuthError {
    fn from(e: String) -> Self {
        AuthError::Other(e)
    }
}

/// "Chrome on macOS" from a `User-Agent` header, `Web browser` when the header
/// says nothing useful. The server reads it, so the page cannot lie about it.
pub fn device_name_from_user_agent(ua: &str) -> String {
    let browser = if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        Some("Edge")
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        Some("Opera")
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        Some("Firefox")
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") {
        Some("Chrome")
    } else if ua.contains("Safari/") {
        Some("Safari")
    } else {
        None
    };
    // Android and iOS agents also say Linux and Mac OS X, so they go first.
    let os = if ua.contains("Android") {
        Some("Android")
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        Some("iOS")
    } else if ua.contains("Windows") {
        Some("Windows")
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        Some("macOS")
    } else if ua.contains("CrOS") {
        Some("ChromeOS")
    } else if ua.contains("Linux") || ua.contains("X11") {
        Some("Linux")
    } else {
        None
    };
    match (browser, os) {
        (Some(b), Some(o)) => format!("{b} on {o}"),
        (Some(b), None) => b.to_string(),
        _ => "Web browser".to_string(),
    }
}

/// A device name as stored: trimmed, cut at 80 characters, `fallback` when empty.
pub fn clean_device_name(raw: &str, fallback: &str) -> String {
    let name: String = raw.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if name.trim().is_empty() {
        fallback.to_string()
    } else {
        name
    }
}

#[cfg(test)]
#[path = "sessions_tests.rs"]
mod tests;
