//! Encrypts secrets before writing them to the debug-build file fallback
//! used by `local_connections` (saved connection passwords). Release builds
//! use the OS keychain; debug builds don't, since an unsigned `tauri dev`
//! rebuild would otherwise re-prompt macOS keychain access on every launch.
//!
//! This is NOT real secret storage: the key lives right next to what it
//! protects, on the same disk, readable by the same OS account. It only
//! raises the bar above "open the file in a text editor and read the
//! password" — the floor debug builds started at — for a path that's never
//! part of a shipped release build in the first place.

// The whole module, not just individual functions — every call site is
// itself behind `#[cfg(debug_assertions)]`, so left ungated this would just
// be dead code (and an unused-`aes_gcm`-import warning) in release builds.
#![cfg(debug_assertions)]

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use std::path::{Path, PathBuf};

const NONCE_LEN: usize = 12;

/// Encrypt with a fresh random nonce; the output is `nonce || ciphertext`.
fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce_bytes = rand::random::<[u8; NONCE_LEN]>();
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| "encrypt failed".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decrypt what [`encrypt`] made. Fails on a wrong key or tampered data.
fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_LEN {
        return Err("ciphertext too short".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let (nonce, ct) = data.split_at(NONCE_LEN);
    cipher.decrypt(Nonce::from_slice(nonce), ct).map_err(|_| "decrypt failed".to_string())
}

fn write_locked(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The random per-directory key — generated once on first use (one file
/// alongside the secrets it protects), reused after. `dir` must already
/// exist.
pub fn master_key(dir: &Path) -> Result<[u8; 32], String> {
    let path: PathBuf = dir.join(".key");
    if let Ok(existing) = std::fs::read(&path) {
        if let Ok(key) = <[u8; 32]>::try_from(existing.as_slice()) {
            return Ok(key);
        }
    }
    let key = rand::random::<[u8; 32]>();
    write_locked(&path, &key)?;
    Ok(key)
}

/// Encrypt `secret` and write it to `path` (0600 on unix).
pub fn save(path: &Path, key: &[u8; 32], secret: &str) -> Result<(), String> {
    let sealed = encrypt(key, secret.as_bytes())?;
    write_locked(path, &sealed)
}

/// Read `path` back, `None` if it doesn't exist. Transparently migrates a
/// pre-encryption plaintext file (written before this module existed) by
/// re-saving it encrypted on the way out.
pub fn load(path: &Path, key: &[u8; 32]) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read(path).map_err(|e| e.to_string())?;
    if let Ok(plain) = decrypt(key, &raw) {
        return String::from_utf8(plain).map(Some).map_err(|e| e.to_string());
    }
    let legacy = String::from_utf8(raw).map_err(|e| e.to_string())?;
    save(path, key, &legacy)?;
    Ok(Some(legacy))
}
