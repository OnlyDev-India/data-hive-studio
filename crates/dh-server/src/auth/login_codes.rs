//! One time login codes (spec 0010, sessions). The provider callback turns a
//! successful sign in into a code bound to the client's PKCE challenge, so the
//! code that travels in an address is useless without the verifier that never
//! left the client.

use crate::store::{now_ms, Store};
use dh_server_client::auth::{new_login_code, verifier_matches, AuthError, CODE_PREFIX, LOGIN_CODE_TTL_MS};
use dh_server_client::crypto;
use sqlx::Row;

impl Store {
    /// Make a login code for `user_id`, valid 60 seconds and usable once.
    /// Only its hash is stored. Old codes are swept here, so no background
    /// task is needed.
    pub async fn login_code_create(&self, user_id: &str, code_challenge: &str) -> Result<String, String> {
        self.login_code_create_at(user_id, code_challenge, now_ms()).await
    }

    pub(crate) async fn login_code_create_at(
        &self,
        user_id: &str,
        code_challenge: &str,
        now: i64,
    ) -> Result<String, String> {
        let code = new_login_code();
        sqlx::query("DELETE FROM login_codes WHERE expires_ms < $1")
            .bind(now)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO login_codes (code_hash, user_id, code_challenge, expires_ms) VALUES ($1,$2,$3,$4)")
            .bind(crypto::hash_token(&code))
            .bind(user_id)
            .bind(code_challenge)
            .bind(now + LOGIN_CODE_TTL_MS)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(code)
    }

    /// Trade a code and its verifier for the person it was made for. The code
    /// is deleted by the same statement that reads it, so of two callers
    /// exactly one can win, and a wrong verifier burns the code.
    pub async fn login_code_redeem(&self, code: &str, verifier: &str) -> Result<String, AuthError> {
        self.login_code_redeem_at(code, verifier, now_ms()).await
    }

    pub(crate) async fn login_code_redeem_at(
        &self,
        code: &str,
        verifier: &str,
        now: i64,
    ) -> Result<String, AuthError> {
        if !code.starts_with(CODE_PREFIX) {
            return Err(AuthError::Unauthorized);
        }
        let row = sqlx::query(
            "DELETE FROM login_codes WHERE code_hash = $1 RETURNING user_id, code_challenge, expires_ms",
        )
        .bind(crypto::hash_token(code))
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| AuthError::Other(e.to_string()))?
        .ok_or(AuthError::Unauthorized)?;
        let expires_ms: i64 = row.get("expires_ms");
        let challenge: String = row.get("code_challenge");
        if expires_ms < now || !verifier_matches(verifier, &challenge) {
            return Err(AuthError::Unauthorized);
        }
        Ok(row.get("user_id"))
    }
}
