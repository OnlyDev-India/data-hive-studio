use dh_server_client::crypto;
use crate::server::store::Store;
use crate::api::DbKind;
use super::{AdapterParams, ERR_NOT_FOUND};
use super::secrets::SshSecrets;
use super::rows::kind_from_str;

impl Store {
    /// Decrypt the password and build the params for whichever adapter this
    /// connection's `kind` needs. Gateway-internal; never serialize this type.
    pub async fn conn_secret_params(&self, id: &str) -> Result<AdapterParams, String> {
        let row = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let password = String::from_utf8(crypto::decrypt(&self.master_key, &row.password_enc)?)
            .map_err(|_| "stored password is not utf-8".to_string())?;
        let ssh = match &row.ssh_host {
            None => None,
            Some(host) => {
                let secrets = match &row.ssh_secrets_enc {
                    Some(enc) => self.decrypt_ssh_secrets(enc)?,
                    None => SshSecrets::default(),
                };
                Some(crate::ssh_tunnel::SshConfig {
                    host: host.clone(),
                    port: row.ssh_port.unwrap_or(22),
                    user: row.ssh_user.clone().unwrap_or_default(),
                    auth_mode: row.ssh_auth_mode.clone().unwrap_or_else(|| "password".into()),
                    password: secrets.password,
                    key_file: row.ssh_key_file.clone(),
                    key_passphrase: secrets.key_passphrase,
                    host_key_fingerprint: row.ssh_host_key_fingerprint.clone(),
                })
            }
        };
        Ok(match kind_from_str(&row.kind) {
            // DocumentDB speaks the MongoDB wire protocol — same adapter,
            // same params shape, just a distinct `kind` for display.
            DbKind::Mongodb | DbKind::DocumentDb => AdapterParams::Mongodb(crate::db::MongoParams {
                host: row.host,
                port: row.port as u16,
                user: row.user,
                password,
                database: row.database,
                auth_db: row.auth_db,
                srv: row.srv != 0,
                tls: row.tls != 0,
                ssl_ca_file: row.ssl_ca_file,
                ssl_client_cert_file: row.ssl_client_cert_file,
                retry_writes: if row.retry_writes != 0 { Some(false) } else { None },
                replica_set: row.replica_set,
                pool_max: row.pool_max.map(|v| v as u32),
                pool_min: row.pool_min.map(|v| v as u32),
                connect_timeout_secs: row.connect_timeout_secs.map(|v| v as u32),
                server_selection_timeout_secs: row.server_selection_timeout_secs.map(|v| v as u32),
                max_idle_time_secs: row.idle_timeout_secs.map(|v| v as u32),
                // Shared connections carry no guard yet (spec 0007, task 12).
                guard: Default::default(),
                ssh,
            }),
            // Postgres, and every other kind until it gets its own adapter
            // params shape — matches the column's own default.
            _ => AdapterParams::Postgres(crate::db::PgParams {
                host: row.host,
                port: row.port as u16,
                user: row.user,
                password,
                database: row.database,
                ssl_mode: row.ssl_mode,
                ssl_ca_file: row.ssl_ca_file,
                ssl_client_cert_file: row.ssl_client_cert_file,
                ssl_client_key_file: row.ssl_client_key_file,
                pool_max: row.pool_max.map(|v| v as u32),
                pool_min: row.pool_min.map(|v| v as u32),
                connect_timeout_secs: row.connect_timeout_secs.map(|v| v as u32),
                idle_timeout_secs: row.idle_timeout_secs.map(|v| v as u32),
                max_lifetime_secs: row.max_lifetime_secs.map(|v| v as u32),
                // Shared connections carry no guard yet (spec 0007, task 12).
                guard: Default::default(),
                ssh,
            }),
        })
    }
}
