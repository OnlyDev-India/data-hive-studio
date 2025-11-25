/**
 * Simple encryption/decryption utilities
 * Uses AES-GCM for secure encryption
 */

// Generate a key from a passphrase (for client-server communication)
// In production, use a more secure key management system
const ENCRYPTION_KEY = process.env.NEXT_PUBLIC_ENCRYPTION_KEY || "data-hive-studio-encryption-key-2024";

/**
 * Convert string to ArrayBuffer
 */
function stringToArrayBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

/**
 * Convert ArrayBuffer to string
 */
function arrayBufferToString(buffer: ArrayBuffer): string {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

/**
 * Derive a key from a passphrase using PBKDF2
 */
async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    stringToArrayBuffer(passphrase),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  // Ensure salt is a proper Uint8Array with ArrayBuffer backing
  const saltBuffer = new Uint8Array(salt);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt data using AES-GCM
 */
export async function encrypt(data: string): Promise<string> {
  try {
    // Generate a random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key from passphrase
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Encrypt the data
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      stringToArrayBuffer(data)
    );

    // Combine salt, IV, and encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64 for transmission
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/**
 * Decrypt data using AES-GCM
 */
export async function decrypt(encryptedData: string): Promise<string> {
  try {
    // Convert from base64
    const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0));

    // Extract salt, IV, and encrypted data
    const salt = new Uint8Array(combined.slice(0, 16));
    const iv = new Uint8Array(combined.slice(16, 28));
    const encryptedSlice = combined.slice(28);
    const encrypted = encryptedSlice.buffer.slice(
      encryptedSlice.byteOffset,
      encryptedSlice.byteOffset + encryptedSlice.byteLength
    );

    // Derive key from passphrase
    const key = await deriveKey(ENCRYPTION_KEY, salt);

    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      encrypted
    );

    return arrayBufferToString(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error("Failed to decrypt data");
  }
}

