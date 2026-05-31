import { describe, expect, it } from "vitest";
import { deriveEncryptionKey, encryptProfilePayload, decryptProfilePayload, generateSalt } from "./profile-crypto";

// We need a polyfill/mock for Web Crypto API in Node.js environment if it's missing,
// but modern Node (>=19) has global crypto.subtle.
import { webcrypto } from "node:crypto";
if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = webcrypto;
} else if (typeof globalThis.crypto.subtle === "undefined") {
  (globalThis.crypto as any).subtle = webcrypto.subtle;
  (globalThis.crypto as any).getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
}

describe("profile-crypto", () => {
  it("derives different keys for different salts", async () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toBe(salt2);
    
    // We can't directly compare CryptoKey objects, so we'll encrypt something and verify ciphertexts differ
    const key1 = await deriveEncryptionKey("mypassword", salt1, 1000); // lower iterations for faster tests
    const key2 = await deriveEncryptionKey("mypassword", salt2, 1000);

    const payload = { test: 123 };
    const enc1 = await encryptProfilePayload(key1, payload, 1000);
    const enc2 = await encryptProfilePayload(key2, payload, 1000);
    
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it("encrypts and decrypts a profile payload round-trip", async () => {
    const salt = generateSalt();
    const key = await deriveEncryptionKey("super-secret-sync", salt, 1000);

    const originalPayload = {
      name: "My Profile",
      facts: [
        { key: "identity.name", value: "Alice" },
        { key: "contact.email", value: "alice@example.com" }
      ]
    };

    const encrypted = await encryptProfilePayload(key, originalPayload, 1000);
    
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.encryptionVersion).toBe(1);
    expect(encrypted.kdfAlgorithm).toBe("PBKDF2-SHA-256");

    const decrypted = await decryptProfilePayload(key, encrypted.iv, encrypted.ciphertext);
    expect(decrypted).toEqual(originalPayload);
  });

  it("fails to decrypt with wrong passphrase", async () => {
    const salt = generateSalt();
    const correctKey = await deriveEncryptionKey("correct-passphrase", salt, 1000);
    const wrongKey = await deriveEncryptionKey("wrong-passphrase", salt, 1000);

    const originalPayload = { test: "data" };
    const encrypted = await encryptProfilePayload(correctKey, originalPayload, 1000);

    await expect(decryptProfilePayload(wrongKey, encrypted.iv, encrypted.ciphertext))
      .rejects.toThrow(/Failed to decrypt/);
  });

  it("fails to decrypt with corrupted ciphertext", async () => {
    const salt = generateSalt();
    const key = await deriveEncryptionKey("mypassphrase", salt, 1000);

    const encrypted = await encryptProfilePayload(key, { test: "data" }, 1000);
    
    const corruptedBytes = Uint8Array.from(atob(encrypted.ciphertext), (char) => char.charCodeAt(0));
    corruptedBytes[0] = corruptedBytes[0]! ^ 1;
    let binary = "";
    for (const byte of corruptedBytes) {
      binary += String.fromCharCode(byte);
    }
    const corrupted = btoa(binary);

    await expect(decryptProfilePayload(key, encrypted.iv, corrupted))
      .rejects.toThrow(/Failed to decrypt/);
  });
});
