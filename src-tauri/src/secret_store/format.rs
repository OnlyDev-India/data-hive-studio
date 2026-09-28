//! On disk format of `secrets.key` and `secrets.bin`, and the private,
//! atomic file writes both go through.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

pub(super) const VERSION: u64 = 1;
pub(super) const KEY_FILE: &str = "secrets.key";
pub(super) const BIN_FILE: &str = "secrets.bin";
const NONCE_LEN: usize = 12;

pub type Key = [u8; 32];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretRecord {
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
}

impl SecretRecord {
    pub fn is_empty(&self) -> bool {
        self.password.is_none() && self.ssh_password.is_none() && self.ssh_key_passphrase.is_none()
    }
}

pub(super) type SecretMap = BTreeMap<String, SecretRecord>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct Header {
    pub v: u64,
    pub keychain_imported: bool,
}

#[derive(Serialize, Deserialize)]
struct KeyFile {
    v: u64,
    kind: String,
    key: String,
}

pub(super) enum KeyRead {
    Absent,
    Newer,
    Found(Key),
}

pub(super) enum BinRead {
    Absent,
    Newer,
    Damaged,
    Opened(Header, SecretMap),
}

/// A missing, unparseable or wrong length key reads as `Absent`.
pub(super) fn read_key(dir: &Path) -> KeyRead {
    let Ok(raw) = std::fs::read(dir.join(KEY_FILE)) else {
        return KeyRead::Absent;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&raw) else {
        return KeyRead::Absent;
    };
    if value
        .get("v")
        .and_then(|v| v.as_u64())
        .is_some_and(|v| v > VERSION)
    {
        return KeyRead::Newer;
    }
    let Ok(file) = serde_json::from_value::<KeyFile>(value) else {
        return KeyRead::Absent;
    };
    if file.v != VERSION || file.kind != "plain" {
        return KeyRead::Absent;
    }
    match B64
        .decode(file.key)
        .ok()
        .and_then(|b| Key::try_from(b.as_slice()).ok())
    {
        Some(key) => KeyRead::Found(key),
        None => KeyRead::Absent,
    }
}

pub(super) fn write_key(dir: &Path, key: &Key) -> Result<(), String> {
    let file = KeyFile {
        v: VERSION,
        kind: "plain".into(),
        key: B64.encode(key),
    };
    let bytes = serde_json::to_vec(&file).map_err(|e| e.to_string())?;
    let path = dir.join(KEY_FILE);
    write_private(&path, &bytes)?;
    exclude_from_backup(&path);
    Ok(())
}

pub(super) fn read_bin(dir: &Path, key: Option<&Key>) -> BinRead {
    let Ok(raw) = std::fs::read(dir.join(BIN_FILE)) else {
        return BinRead::Absent;
    };
    let Some(split) = raw.iter().position(|b| *b == b'\n') else {
        return BinRead::Damaged;
    };
    let (header_bytes, sealed) = (&raw[..split], &raw[split + 1..]);
    let Ok(header) = serde_json::from_slice::<Header>(header_bytes) else {
        return BinRead::Damaged;
    };
    if header.v > VERSION {
        return BinRead::Newer;
    }
    if header.v != VERSION {
        return BinRead::Damaged;
    }
    let Some(key) = key else {
        return BinRead::Damaged;
    };
    let Some(plain) = open(key, header_bytes, sealed) else {
        return BinRead::Damaged;
    };
    match serde_json::from_slice::<SecretMap>(&plain) {
        Ok(map) => BinRead::Opened(header, map),
        Err(_) => BinRead::Damaged,
    }
}

pub(super) fn write_bin(
    dir: &Path,
    key: &Key,
    header: &Header,
    map: &SecretMap,
) -> Result<(), String> {
    let header_bytes = serde_json::to_vec(header).map_err(|e| e.to_string())?;
    let body = serde_json::to_vec(map).map_err(|e| e.to_string())?;
    let sealed = seal(key, &header_bytes, &body)?;
    let mut out = header_bytes;
    out.push(b'\n');
    out.extend_from_slice(&sealed);
    write_private(&dir.join(BIN_FILE), &out)
}

/// `nonce || ciphertext`, with `aad` authenticated but not encrypted.
pub(super) fn seal(key: &Key, aad: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plain, aad })
        .map_err(|_| "encrypt failed".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// `None` on a wrong key, a tampered byte or a changed `aad`.
pub(super) fn open(key: &Key, aad: &[u8], data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < NONCE_LEN {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let (nonce, ct) = data.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad })
        .ok()
}

pub(super) fn new_key() -> Key {
    use rand::RngCore;
    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    key
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Writes `<file>.tmp` created `0600` (never wider), syncs it, then renames
/// it over `path`, so readers see the old file or the new one, never half.
pub(super) fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = tmp_path(path);
    // A leftover from a crash may carry wider permissions; start fresh.
    let _ = std::fs::remove_file(&tmp);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&tmp).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        let _ = std::fs::File::open(dir).and_then(|d| d.sync_all());
    }
    Ok(())
}

/// Sets an existing file back to `0600` when it was found wider.
pub(super) fn repair_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            if meta.permissions().mode() & 0o777 != 0o600 {
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Keeps the key out of Time Machine, so a restored backup never carries the
/// key alongside the secrets it opens. Failure is ignored.
fn exclude_from_backup(path: &Path) {
    #[cfg(all(target_os = "macos", not(test)))]
    {
        let _ = std::process::Command::new("/usr/bin/tmutil")
            .arg("addexclusion")
            .arg(path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(not(all(target_os = "macos", not(test))))]
    let _ = path;
}
