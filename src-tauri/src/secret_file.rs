//! Encrypts secrets before writing them to the debug-build file fallback
//! used by `local_connections.rs` (saved connection passwords) and
//! `servers.rs` (team-server session tokens) — see either file's own doc
//! comment for why release builds use the OS keychain and debug builds
//! don't (an unsigned `tauri dev` rebuild would otherwise re-prompt macOS
//! keychain access on every single launch).
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

use std::path::{Path, PathBuf};

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
    let key = dh_core::server::crypto::random_key();
    write_locked(&path, &key)?;
    Ok(key)
}

/// Encrypt `secret` and write it to `path` (0600 on unix).
pub fn save(path: &Path, key: &[u8; 32], secret: &str) -> Result<(), String> {
    let sealed = dh_core::server::crypto::encrypt(key, secret.as_bytes())?;
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
    if let Ok(plain) = dh_core::server::crypto::decrypt(key, &raw) {
        return String::from_utf8(plain).map(Some).map_err(|e| e.to_string());
    }
    let legacy = String::from_utf8(raw).map_err(|e| e.to_string())?;
    save(path, key, &legacy)?;
    Ok(Some(legacy))
}
