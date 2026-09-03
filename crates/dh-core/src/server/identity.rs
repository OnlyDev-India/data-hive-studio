//! Server-side identity: `adm_` / `tem_` bearer-token auth.
//!
//! Tokens and devices are SEPARATE concepts:
//!
//!   tokens   — the credential itself (`adm_…` or `tem_…`). Created by an
//!              admin; multiple devices can share one token simultaneously.
//!   devices  — actual connections tracked per token. A row is created when
//!              a device first authenticates; updated on every request.

use sqlx::Row;

pub const ADM_PREFIX: &str = "adm_";
pub const TEM_PREFIX: &str = "tem_";
pub const TEAM_HEADER: &str = "x-team";

fn new_token(prefix: &str) -> String {
    let bytes: [u8; 16] = rand::random();
    format!("{prefix}{}", hex::encode(bytes))
}

fn device_id_from_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(token.as_bytes());
    hex::encode(hash)
}

/// Auth context resolved from a Bearer token (+ `X-Team` for tem_ tokens).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuthCtx {
    pub token: String,
    pub user_name: String,
    pub prefix: String,
    pub team_name: Option<String>,
    pub is_admin: bool,
}

/// One minted token as shown in the admin UI.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenInfo {
    pub token: String,
    pub prefix: String,
    pub user_name: String,
    pub team_name: Option<String>,
    pub created_ms: i64,
}

/// One issued token as shown in the admin Devices tab.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceInfo {
    pub token: String,
    pub prefix: String,
    pub user_name: String,
    pub team_name: Option<String>,
    pub admin: bool,
    pub created_ms: i64,
}

/// One device that has connected using a token.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceEntry {
    pub id: String,
    pub token: String,
    pub ip_address: Option<String>,
    pub first_seen_ms: i64,
    pub last_connected_ms: i64,
}

use crate::server::store::Store;

impl Store {
    /// List all connected devices (for admin Devices tab).
    pub async fn devices_list(&self) -> Result<Vec<DeviceEntry>, String> {
        let (sql, _) = self.query_ph(
            "SELECT id, token, ip_address, first_seen_ms, last_connected_ms
             FROM devices ORDER BY last_connected_ms DESC",
        );
        let mut out = Vec::new();
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                let rows = sqlx::query(&sql).fetch_all(p).await.map_err(|e| e.to_string())?;
                for r in rows {
                    out.push(DeviceEntry {
                        id: r.get("id"),
                        token: r.get("token"),
                        ip_address: r.get("ip_address"),
                        first_seen_ms: r.get("first_seen_ms"),
                        last_connected_ms: r.get("last_connected_ms"),
                    });
                }
            }
            super::store::StorePool::Postgres(p) => {
                let rows = sqlx::query(&sql).fetch_all(p).await.map_err(|e| e.to_string())?;
                for r in rows {
                    out.push(DeviceEntry {
                        id: r.get("id"),
                        token: r.get("token"),
                        ip_address: r.get("ip_address"),
                        first_seen_ms: r.get("first_seen_ms"),
                        last_connected_ms: r.get("last_connected_ms"),
                    });
                }
            }
        }
        Ok(out)
    }

    /// Remove one device tracking record.
    pub async fn device_revoke(&self, device_id: &str) -> Result<(), String> {
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query("DELETE FROM devices WHERE id = ?").bind(device_id)
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query("DELETE FROM devices WHERE id = ?").bind(device_id)
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    /// Verify a Bearer token (with X-Team header for tem_ tokens).
    /// Also creates or updates the device tracking row so we know who is
    /// actually connecting. Returns None if the token is unknown or revoked.
    pub async fn verify(
        &self,
        bearer: &str,
        team_header: Option<&str>,
    ) -> Option<AuthCtx> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        if token.is_empty() {
            return None;
        }
        let needs_team = token.starts_with(TEM_PREFIX);
        if needs_team && team_header.is_none() {
            return None;
        }
        // Team tokens require at least one admin token to exist.
        if needs_team && !self.has_admin_token().await {
            return None;
        }

        // Look up the token row.
        let (sql, _) = self.query_ph(
            r#"SELECT t.token AS token, t.prefix AS prefix,
                      t.user_name AS user_name, t.team_name AS team_name
               FROM tokens t WHERE t.token = ?"#,
        );
        macro_rules! finish {
            ($pool:expr) => {{
                let r = sqlx::query(&sql)
                    .bind(token)
                    .fetch_optional($pool)
                    .await
                    .ok()?;
                match r {
                    Some(row) => {
                        let prefix: String = row.try_get("prefix").unwrap_or_default();
                        let stored_team: Option<String> = row.try_get("team_name").ok();
                        let user: String = row.try_get("user_name").unwrap_or_default();
                        if prefix.starts_with("tem") {
                            match (&stored_team, team_header) {
                                (Some(t), Some(h)) if h == t => {}
                                _ => return None,
                            }
                        }
                        Some(AuthCtx {
                            token: token.to_string(),
                            user_name: user,
                            prefix: prefix.clone(),
                            team_name: stored_team,
                            is_admin: prefix == ADM_PREFIX,
                        })
                    }
                    None => None,
                }
            }};
        }
        let ctx = match &self.pool {
            super::store::StorePool::Sqlite(p) => finish!(p),
            super::store::StorePool::Postgres(p) => finish!(p),
        };
        if ctx.is_some() {
            self.upsert_device(token).await;
        }
        ctx
    }

    /// Create or update the device tracking row for the given token.
    async fn upsert_device(&self, token: &str) {
        let id = device_id_from_token(token);
        let now = crate::server::store::now_ms();
        let (sql, _) = self.query_ph(
            "INSERT INTO devices (id, token, ip_address, first_seen_ms, last_connected_ms)
             VALUES (?, ?, NULL, ?, ?)
             ON CONFLICT (id) DO UPDATE SET last_connected_ms = excluded.last_connected_ms",
        );
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                let _ = sqlx::query(&sql)
                    .bind(&id).bind(token).bind(now).bind(now)
                    .execute(p).await;
            }
            super::store::StorePool::Postgres(p) => {
                let (sql_pg, _) = self.query_ph(
                    "INSERT INTO devices (id, token, ip_address, first_seen_ms, last_connected_ms)
                     VALUES (?, ?, NULL, ?, ?)
                     ON CONFLICT (id) DO UPDATE SET last_connected_ms = EXCLUDED.last_connected_ms",
                );
                let _ = sqlx::query(&sql_pg)
                    .bind(&id).bind(token).bind(now).bind(now)
                    .execute(p).await;
            }
        }
    }

    /// Mint an ADMIN token — rotates: deletes all existing admin tokens first.
    pub async fn mint_admin(&self, user_name: &str) -> Result<String, String> {
        self.delete_all_admin_tokens().await?;
        self.insert_token(ADM_PREFIX, user_name.trim(), None).await
    }

    async fn delete_all_admin_tokens(&self) -> Result<(), String> {
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query("DELETE FROM tokens WHERE prefix = 'adm_'")
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query("DELETE FROM tokens WHERE prefix = 'adm_'")
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    async fn has_admin_token(&self) -> bool {
        let q = "SELECT COUNT(*) FROM tokens WHERE prefix = 'adm_'";
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query_as::<_, (i64,)>(q)
                    .fetch_one(p)
                    .await
                    .map(|(n,)| n > 0)
                    .unwrap_or(false)
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query_as::<_, (i64,)>(q)
                    .fetch_one(p)
                    .await
                    .map(|(n,)| n > 0)
                    .unwrap_or(false)
            }
        }
    }

    /// Mint a scoped TEAM token bound to `team_name` with optional grants.
    pub async fn mint_team_token(
        &self,
        user_name: &str,
        team_name: &str,
        grants: &[TokenGrantSpec],
    ) -> Result<String, String> {
        if team_name.trim().is_empty() {
            return Err("team name must not be empty".into());
        }
        let token = self.insert_token(TEM_PREFIX, user_name.trim(), Some(team_name.trim())).await?;
        // Copy grants onto this token.
        for g in grants {
            self.insert_grant(&token, &g.conn_id, g.can_read, g.can_update, g.can_delete).await?;
        }
        Ok(token)
    }

    /// Rotate: wipe every existing admin token, mint a fresh one.
    /// Mint the bootstrap ADMIN token when the server has none. Returns the
    /// plaintext `adm_…` once, or None when an admin device already exists.
    pub async fn ensure_bootstrap_admin(&self) -> Result<Option<String>, String> {
        let has_admin: i64 = match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                let (n,): (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM tokens WHERE prefix = 'adm_'",
                )
                .fetch_one(p)
                .await
                .map_err(|e| e.to_string())?;
                n
            }
            super::store::StorePool::Postgres(p) => {
                let (n,): (i64,) = sqlx::query_as(
                    "SELECT COUNT(*) FROM tokens WHERE prefix = 'adm_'",
                )
                .fetch_one(p)
                .await
                .map_err(|e| e.to_string())?;
                n
            }
        };
        if has_admin > 0 {
            return Ok(None);
        }
        Ok(Some(self.mint_admin("server-admin").await?))
    }

    pub async fn rotate_admin(&self) -> Result<String, String> {
        self.mint_admin("server-admin").await
    }

    /// List all active tokens for the admin UI.
    pub async fn tokens_list(&self) -> Result<Vec<TokenInfo>, String> {
        let (sql, _) = self.query_ph(
            "SELECT token, prefix, user_name, team_name, created_ms
             FROM tokens ORDER BY created_ms DESC",
        );
        let mut out = Vec::new();
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                let rows = sqlx::query(&sql).fetch_all(p).await.map_err(|e| e.to_string())?;
                for r in rows {
                    out.push(TokenInfo {
                        token: r.get("token"),
                        prefix: r.get("prefix"),
                        user_name: r.get("user_name"),
                        team_name: r.get("team_name"),
                        created_ms: r.get("created_ms"),
                    });
                }
            }
            super::store::StorePool::Postgres(p) => {
                let rows = sqlx::query(&sql).fetch_all(p).await.map_err(|e| e.to_string())?;
                for r in rows {
                    out.push(TokenInfo {
                        token: r.get("token"),
                        prefix: r.get("prefix"),
                        user_name: r.get("user_name"),
                        team_name: r.get("team_name"),
                        created_ms: r.get("created_ms"),
                    });
                }
            }
        }
        Ok(out)
    }

    /// Revoke one token by its value (removes from tokens table).
    pub async fn token_revoke(&self, token: &str) -> Result<(), String> {
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query("DELETE FROM tokens WHERE token = ?")
                    .bind(token)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query("DELETE FROM tokens WHERE token = ?")
                    .bind(token)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// Insert one token row; returns the plaintext.
    async fn insert_token(
        &self,
        prefix: &str,
        user_name: &str,
        team_name: Option<&str>,
    ) -> Result<String, String> {
        let token = new_token(prefix);
        let (sql, _) = self.query_ph(
            "INSERT INTO tokens (token, prefix, user_name, team_name, created_ms) VALUES (?, ?, ?, ?, ?)",
        );
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(&token).bind(prefix).bind(user_name)
                    .bind(team_name)
                    .bind(crate::server::store::now_ms())
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(&token).bind(prefix).bind(user_name)
                    .bind(team_name)
                    .bind(crate::server::store::now_ms())
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(token)
    }

    /// Insert one grant row for a token.
    async fn insert_grant(
        &self,
        token: &str,
        conn_id: &str,
        can_read: bool,
        can_update: bool,
        can_delete: bool,
    ) -> Result<(), String> {
        let (sql, _) = self.query_ph(
            "INSERT INTO grants (token, conn_id, can_read, can_update, can_delete) VALUES (?,?,?,?,?)",
        );
        match &self.pool {
            super::store::StorePool::Sqlite(p) => {
                sqlx::query(&sql).bind(token).bind(conn_id)
                    .bind(can_read as i64).bind(can_update as i64).bind(can_delete as i64)
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
            super::store::StorePool::Postgres(p) => {
                sqlx::query(&sql).bind(token).bind(conn_id)
                    .bind(can_read as i64).bind(can_update as i64).bind(can_delete as i64)
                    .execute(p).await.map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

// ---- Free functions / types ------------------------------------------------

/// Per-connection access granted to a team token at mint time.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TokenGrantSpec {
    pub conn_id: String,
    #[serde(default)]
    pub can_read: bool,
    #[serde(default)]
    pub can_update: bool,
    #[serde(default)]
    pub can_delete: bool,
}
