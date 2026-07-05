/**
 * crypto-util.js - AES-256-GCM encryption for per-user LLM API keys.
 *
 * SHARED MODULE: imported by the bot (src/mu-fit-check.js) and by the
 * Next.js app (via the @bot/crypto-util alias). Keep it pure: node:crypto
 * only, no bot-specific imports.
 *
 * Blob format: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>"
 * Key derivation: SHA-256 of LLM_KEY_SECRET (a 32+ char random string).
 */
import crypto from "node:crypto";

const FORMAT_VERSION = "v1";

function deriveKey(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Encryption secret must be at least 32 characters");
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(blob, secret) {
  const parts = String(blob ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognized encrypted secret format");
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
