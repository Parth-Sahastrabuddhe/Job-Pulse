import crypto from "node:crypto";

const KNOWN_PLACEHOLDERS = new Set([
  "generate-a-random-32-char-string",
  "change-me",
  "changeme",
  "replace-me",
  "your-session-secret",
  "your-secret-here",
]);

function sampleEntropyBits(value) {
  const frequencies = new Map();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) || 0) + 1);
  }
  let bitsPerCharacter = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    bitsPerCharacter -= probability * Math.log2(probability);
  }
  return bitsPerCharacter * value.length;
}

export function sessionSecretProblem(value) {
  if (typeof value !== "string" || !value) return "is not set";
  if (KNOWN_PLACEHOLDERS.has(value.trim().toLowerCase())) return "is a known placeholder";
  if (Buffer.byteLength(value, "utf8") < 32) return "must be at least 32 bytes";
  if (/^(.{1,16})\1+$/.test(value)) return "is a repeated pattern";
  if (new Set(value).size < 12 || sampleEntropyBits(value) < 120) {
    return "does not contain enough entropy";
  }
  return null;
}

export function resolveSessionSecret(value, { production = false } = {}) {
  const problem = sessionSecretProblem(value);
  if (!problem) return value;
  if (production) {
    throw new Error(
      `SESSION_SECRET ${problem}. Generate one with: openssl rand -base64 48`
    );
  }
  return crypto.randomBytes(48).toString("base64url");
}

export function sessionVersionMatches(tokenVersion, storedVersion) {
  const token = Number.isSafeInteger(tokenVersion) && tokenVersion >= 0 ? tokenVersion : 0;
  const stored = Number.isSafeInteger(storedVersion) && storedVersion >= 0 ? storedVersion : 0;
  return token === stored;
}
