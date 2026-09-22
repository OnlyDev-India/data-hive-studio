use dh_server_client::crypto;
use crate::server::store::{now_ms, Store};
use uuid::Uuid;
use super::{ConnInput, ConnMeta, ERR_NOT_FOUND};
use super::rows::{kind_to_str, parse_conn_row};

impl Store {
    pub async fn conn_add(
        &self,
        org_id: &str,
        input: &ConnInput,
        created_by: &str,
    ) -> Result<ConnMeta, String> {
        let password = input.password.clone().unwrap_or_default();
        let enc = crypto::encrypt(&self.master_key, password.as_bytes())?;
        // SSH secrets only get encrypted/stored when a tunnel is actually
        // configured (`ssh_host` set) — otherwise NULL, same as "no tunnel".
        let ssh_secrets_enc = match &input.ssh_host {
            Some(_) => Some(self.encrypt_ssh_secrets(
                input.ssh_password.as_deref(),
                input.ssh_key_passphrase.as_deref(),
            )?),
            None => None,
        };
        let id = Uuid::new_v4().to_string();
        let ts = now_ms();
        let kind_str = kind_to_str(input.kind);
        sqlx::query(
            r#"INSERT INTO connections
               (id, org_id, name, kind, host, port, "user", password_enc, database, ssl_mode, auth_db, srv, tls, ssl_ca_file, ssl_client_cert_file, ssl_client_key_file, retry_writes, replica_set, pool_max, pool_min, connect_timeout_secs, idle_timeout_secs, max_lifetime_secs, server_selection_timeout_secs, ssh_host, ssh_port, ssh_user, ssh_auth_mode, ssh_key_file, ssh_host_key_fingerprint, ssh_secrets_enc, created_by, created_ms, updated_ms)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34)"#,
        )
        .bind(&id)
        .bind(org_id)
        .bind(&input.name)
        .bind(kind_str)
        .bind(&input.host)
        .bind(input.port as i64)
        .bind(&input.user)
        .bind(&enc)
        .bind(&input.database)
        .bind(&input.ssl_mode)
        .bind(&input.auth_db)
        .bind(input.srv as i64)
        .bind(input.tls as i64)
        .bind(&input.ssl_ca_file)
        .bind(&input.ssl_client_cert_file)
        .bind(&input.ssl_client_key_file)
        .bind(input.retry_writes as i64)
        .bind(&input.replica_set)
        .bind(input.pool_max.map(|v| v as i64))
        .bind(input.pool_min.map(|v| v as i64))
        .bind(input.connect_timeout_secs.map(|v| v as i64))
        .bind(input.idle_timeout_secs.map(|v| v as i64))
        .bind(input.max_lifetime_secs.map(|v| v as i64))
        .bind(input.server_selection_timeout_secs.map(|v| v as i64))
        .bind(&input.ssh_host)
        .bind(input.ssh_port.map(|p| p as i64))
        .bind(&input.ssh_user)
        .bind(&input.ssh_auth_mode)
        .bind(&input.ssh_key_file)
        .bind(&input.ssh_host_key_fingerprint)
        .bind(&ssh_secrets_enc)
        .bind(created_by)
        .bind(ts)
        .bind(ts)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(ConnMeta {
            id,
            org_id: org_id.to_string(),
            name: input.name.clone(),
            kind: input.kind,
            host: input.host.clone(),
            port: input.port,
            user: input.user.clone(),
            database: input.database.clone(),
            ssl_mode: input.ssl_mode.clone(),
            auth_db: input.auth_db.clone(),
            srv: input.srv,
            tls: input.tls,
            ssl_ca_file: input.ssl_ca_file.clone(),
            ssl_client_cert_file: input.ssl_client_cert_file.clone(),
            ssl_client_key_file: input.ssl_client_key_file.clone(),
            retry_writes: input.retry_writes,
            replica_set: input.replica_set.clone(),
            pool_max: input.pool_max,
            pool_min: input.pool_min,
            connect_timeout_secs: input.connect_timeout_secs,
            idle_timeout_secs: input.idle_timeout_secs,
            max_lifetime_secs: input.max_lifetime_secs,
            server_selection_timeout_secs: input.server_selection_timeout_secs,
            ssh_host: input.ssh_host.clone(),
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user.clone(),
            ssh_auth_mode: input.ssh_auth_mode.clone(),
            ssh_key_file: input.ssh_key_file.clone(),
            ssh_host_key_fingerprint: input.ssh_host_key_fingerprint.clone(),
            created_by: created_by.to_string(),
            created_ms: ts,
            updated_ms: ts,
        })
    }

    /// Edit stored details. Requires edit access (checked by callers).
    /// A `None` password in the input keeps the current one.
    pub async fn conn_update(&self, id: &str, input: &ConnInput) -> Result<ConnMeta, String> {
        let existing = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let enc = match &input.password {
            Some(p) => crypto::encrypt(&self.master_key, p.as_bytes())?,
            None => existing.password_enc,
        };
        // Disabling the tunnel (no ssh_host) drops any stored SSH secrets.
        // Otherwise, only re-encrypt the secret(s) actually provided —
        // `None` for either one keeps whatever was already stored for it.
        let ssh_secrets_enc = match &input.ssh_host {
            None => None,
            Some(_) => {
                let existing_secrets = existing
                    .ssh_secrets_enc
                    .as_ref()
                    .and_then(|enc| self.decrypt_ssh_secrets(enc).ok())
                    .unwrap_or_default();
                let password = input.ssh_password.clone().or(existing_secrets.password);
                let key_passphrase =
                    input.ssh_key_passphrase.clone().or(existing_secrets.key_passphrase);
                Some(self.encrypt_ssh_secrets(password.as_deref(), key_passphrase.as_deref())?)
            }
        };
        let ts = now_ms();
        sqlx::query(
            r#"UPDATE connections
               SET name=$1, host=$2, port=$3, "user"=$4, password_enc=$5, database=$6, ssl_mode=$7, auth_db=$8, srv=$9, tls=$10, ssl_ca_file=$11, ssl_client_cert_file=$12, ssl_client_key_file=$13, retry_writes=$14, replica_set=$15, pool_max=$16, pool_min=$17, connect_timeout_secs=$18, idle_timeout_secs=$19, max_lifetime_secs=$20, server_selection_timeout_secs=$21, ssh_host=$22, ssh_port=$23, ssh_user=$24, ssh_auth_mode=$25, ssh_key_file=$26, ssh_host_key_fingerprint=$27, ssh_secrets_enc=$28, updated_ms=$29
               WHERE id=$30"#,
        )
        .bind(&input.name)
        .bind(&input.host)
        .bind(input.port as i64)
        .bind(&input.user)
        .bind(&enc)
        .bind(&input.database)
        .bind(&input.ssl_mode)
        .bind(&input.auth_db)
        .bind(input.srv as i64)
        .bind(input.tls as i64)
        .bind(&input.ssl_ca_file)
        .bind(&input.ssl_client_cert_file)
        .bind(&input.ssl_client_key_file)
        .bind(input.retry_writes as i64)
        .bind(&input.replica_set)
        .bind(input.pool_max.map(|v| v as i64))
        .bind(input.pool_min.map(|v| v as i64))
        .bind(input.connect_timeout_secs.map(|v| v as i64))
        .bind(input.idle_timeout_secs.map(|v| v as i64))
        .bind(input.max_lifetime_secs.map(|v| v as i64))
        .bind(input.server_selection_timeout_secs.map(|v| v as i64))
        .bind(&input.ssh_host)
        .bind(input.ssh_port.map(|p| p as i64))
        .bind(&input.ssh_user)
        .bind(&input.ssh_auth_mode)
        .bind(&input.ssh_key_file)
        .bind(&input.ssh_host_key_fingerprint)
        .bind(&ssh_secrets_enc)
        .bind(ts)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        self.conn_get(id).await?.ok_or_else(|| ERR_NOT_FOUND.into())
    }

    pub async fn conn_archive(&self, id: &str) -> Result<(), String> {
        let n = sqlx::query("UPDATE connections SET archived=1 WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();
        if n == 0 {
            Err(ERR_NOT_FOUND.into())
        } else {
            Ok(())
        }
    }

    /// Metadata only — safe to send to any granted client.
    pub async fn conn_get(&self, id: &str) -> Result<Option<ConnMeta>, String> {
        let row = self.conn_get_row(id).await?;
        row.map(Self::row_to_meta).transpose()
    }

    pub async fn conn_list_active(&self, org_id: &str) -> Result<Vec<ConnMeta>, String> {
        let rows = sqlx::query(
            "SELECT * FROM connections WHERE org_id=$1 AND archived=0 ORDER BY created_ms DESC",
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        rows.iter().map(parse_conn_row).map(Self::row_to_meta).collect()
    }
}
