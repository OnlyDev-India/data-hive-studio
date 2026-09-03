//! AES-256-GCM encryption for vault payloads and SHA-256 hashing for tokens.

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use sha2::{Digest, Sha256};

const NONCE_LEN: usize = 12;

/// Encrypt `plaintext` with a fresh random nonce; output is `nonce || ciphertext`.
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce_bytes = rand::random::<[u8; NONCE_LEN]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| "encrypt failed".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Decrypt data produced by [`encrypt`]. Fails on tampered or wrong-key input.
pub fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < NONCE_LEN {
        return Err("ciphertext too short".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let (nonce, ct) = data.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "decrypt failed (wrong key or tampered)".to_string())
}

/// Opaque bearer tokens are stored hashed; only enrollment sees the raw token.
pub fn hash_token(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex::encode(h.finalize())
}

/// `dhk_`-prefixed 192-bit random token.
pub fn new_device_token() -> String {
    let bytes: [u8; 24] = rand::random();
    format!("dhk_{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_tamper() {
        let key = rand::random::<[u8; 32]>();
        let msg = b"secret password";
        let sealed = encrypt(&key, msg).unwrap();
        assert_eq!(decrypt(&key, &sealed).unwrap(), msg);

        let mut bad_key = key;
        bad_key[0] ^= 1;
        assert!(decrypt(&bad_key, &sealed).is_err());

        let mut tampered = sealed.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(decrypt(&key, &tampered).is_err());
    }

    #[test]
    fn unique_nonces() {
        let key = [7u8; 32];
        let a = encrypt(&key, b"x").unwrap();
        let b = encrypt(&key, b"x").unwrap();
        assert_ne!(a, b, "nonce reuse would be catastrophic");
    }

    #[test]
    fn token_shape_and_hash_stability() {
        let t = new_device_token();
        assert!(t.starts_with("dhk_"));
        assert_eq!(t.len(), "dhk_".len() + 48);
        assert_eq!(hash_token("abc"), hash_token("abc"));
        assert_ne!(hash_token("abc"), hash_token("abd"));
    }
}
