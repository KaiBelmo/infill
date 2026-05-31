// Web Crypto API implementations for profile sync

const SYNC_KDF_ITERATIONS = 310000;
const SYNC_KDF_ALGORITHM = "PBKDF2-SHA-256";
const ENCRYPTION_VERSION = 1;

export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return arrayBufferToBase64(salt.buffer);
}

export async function deriveEncryptionKey(passphrase: string, saltBase64: string, iterations = SYNC_KDF_ITERATIONS): Promise<CryptoKey> {
  const saltBuffer = base64ToArrayBuffer(saltBase64);
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations,
      hash: "SHA-256"
    },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptProfilePayload(
  key: CryptoKey,
  payload: unknown,
  kdfIterations = SYNC_KDF_ITERATIONS
): Promise<{ iv: string; ciphertext: string; encryptionVersion: 1; kdfAlgorithm: "PBKDF2-SHA-256"; kdfIterations: number }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedPayload = encoder.encode(JSON.stringify(payload));

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedPayload
  );

  return {
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    encryptionVersion: ENCRYPTION_VERSION,
    kdfAlgorithm: SYNC_KDF_ALGORITHM,
    kdfIterations
  };
}

export async function decryptProfilePayload(key: CryptoKey, ivBase64: string, ciphertextBase64: string): Promise<unknown> {
  const iv = base64ToArrayBuffer(ivBase64);
  const ciphertext = base64ToArrayBuffer(ciphertextBase64);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  } catch (error) {
    throw new Error("Failed to decrypt profile payload. Incorrect passphrase or corrupted data.");
  }
}

// --- Base64 helpers (binary safe) ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
