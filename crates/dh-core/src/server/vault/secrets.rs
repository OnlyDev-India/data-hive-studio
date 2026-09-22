use dh_server_client::crypto;
use crate::server::store::Store;

/// SSH password + key passphrase, encrypted together as one JSON blob
/// (mirrors how the main `password_enc` column works, just two secrets
/// instead of one so a tunnel doesn't need two more AES-GCM columns).
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub(super) struct SshSecrets {
    pub(super) password: Option<String>,
    pub(super) key_passphrase: Option<String>,
}

impl Store {
    pub(super) fn encrypt_ssh_secrets(&self, password: Option<&str>, key_passphrase: Option<&str>) -> Result<Vec<u8>, String> {
        let json = serde_json::to_vec(&SshSecrets {
            password: password.map(str::to_string),
            key_passphrase: key_passphrase.map(str::to_string),
        })
        .map_err(|e| e.to_string())?;
        crypto::encrypt(&self.master_key, &json)
    }

    pub(super) fn decrypt_ssh_secrets(&self, enc: &[u8]) -> Result<SshSecrets, String> {
        let json = crypto::decrypt(&self.master_key, enc)?;
        serde_json::from_slice(&json).map_err(|e| e.to_string())
    }
}
