//! One time carry over of secrets saved by older builds: release builds kept
//! them in the OS Keychain, debug builds in `connection-passwords/`.

use super::format::{self, Key, SecretMap, SecretRecord};
use serde::Deserialize;
use std::path::Path;

const KEYRING_SERVICE: &str = "dh-studio-connections";
const DEV_DIR: &str = "connection-passwords";

pub enum LegacyRead {
    Found(String),
    Missing,
    Failed,
}

/// Where the old secrets are read from: the Keychain in the app, a map in
/// tests.
pub trait LegacySource {
    fn read(&mut self, account: &str) -> LegacyRead;
    fn delete(&mut self, account: &str);
}

pub struct Keychain;

impl LegacySource for Keychain {
    fn read(&mut self, account: &str) -> LegacyRead {
        let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) else {
            return LegacyRead::Failed;
        };
        match entry.get_password() {
            Ok(value) => LegacyRead::Found(value),
            Err(keyring::Error::NoEntry) => LegacyRead::Missing,
            Err(_) => LegacyRead::Failed,
        }
    }

    fn delete(&mut self, account: &str) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) {
            let _ = entry.delete_credential();
        }
    }
}

#[derive(Default, Deserialize)]
struct SshBlob {
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    key_passphrase: Option<String>,
}

fn ssh_blob(raw: Option<String>) -> SshBlob {
    raw.and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub(super) struct Collected {
    pub map: SecretMap,
    /// Connection names with a Keychain read that failed.
    pub failed: Vec<String>,
    /// Keychain accounts that held a value, deleted once the file is written.
    pub found: Vec<String>,
}

/// Reads every old secret for `names`. The Keychain wins over the dev files
/// field by field.
pub(super) fn collect(dir: &Path, names: &[String], source: &mut dyn LegacySource) -> Collected {
    let dev_dir = dir.join(DEV_DIR);
    let dev = DevFiles::open(&dev_dir);
    let mut out = Collected {
        map: SecretMap::new(),
        failed: Vec::new(),
        found: Vec::new(),
    };
    for name in names {
        let ssh_account = format!("{name}::ssh");
        let mut failed = false;
        let mut read = |account: &str| match source.read(account) {
            LegacyRead::Found(value) => {
                out.found.push(account.to_string());
                Some(value)
            }
            LegacyRead::Missing => None,
            LegacyRead::Failed => {
                failed = true;
                None
            }
        };
        let kc_password = read(name);
        let kc_ssh = ssh_blob(read(&ssh_account));
        if failed {
            out.failed.push(name.clone());
        }
        let file_ssh = ssh_blob(dev.read(&ssh_account));
        let record = SecretRecord {
            password: kc_password.or_else(|| dev.read(name)),
            ssh_password: kc_ssh.password.or(file_ssh.password),
            ssh_key_passphrase: kc_ssh.key_passphrase.or(file_ssh.key_passphrase),
        };
        if !record.is_empty() {
            out.map.insert(name.clone(), record);
        }
    }
    out
}

/// Best effort; only called after `secrets.bin` holds everything collected.
pub(super) fn forget(dir: &Path, found: &[String], source: &mut dyn LegacySource) {
    for account in found {
        source.delete(account);
    }
    let _ = std::fs::remove_dir_all(dir.join(DEV_DIR));
}

pub(super) fn dev_file_name(account: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(account.len() * 2);
    for b in account.as_bytes() {
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// The old debug build files: `.key` holds 32 raw bytes, and each secret is
/// a file named by the hex of its account, sealed as `nonce || ciphertext`,
/// or plain text from before encryption existed.
struct DevFiles<'a> {
    dir: &'a Path,
    key: Option<Key>,
}

impl<'a> DevFiles<'a> {
    fn open(dir: &'a Path) -> Self {
        let key = std::fs::read(dir.join(".key"))
            .ok()
            .and_then(|raw| Key::try_from(raw.as_slice()).ok());
        Self { dir, key }
    }

    fn read(&self, account: &str) -> Option<String> {
        let raw = std::fs::read(self.dir.join(dev_file_name(account))).ok()?;
        if let Some(plain) = self.key.as_ref().and_then(|k| format::open(k, &[], &raw)) {
            return String::from_utf8(plain).ok();
        }
        String::from_utf8(raw).ok()
    }
}
