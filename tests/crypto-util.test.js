import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/crypto-util.js";

const SECRET = "0123456789abcdef0123456789abcdef"; // 32 chars

describe("crypto-util", () => {
  it("round-trips a key", () => {
    const blob = encryptSecret("AIzaSy-test-key-123", SECRET);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob, SECRET)).toBe("AIzaSy-test-key-123");
  });

  it("produces a different blob each time (random IV)", () => {
    expect(encryptSecret("same", SECRET)).not.toBe(encryptSecret("same", SECRET));
  });

  it("throws on the wrong secret", () => {
    const blob = encryptSecret("k", SECRET);
    expect(() => decryptSecret(blob, "f".repeat(32))).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const parts = encryptSecret("k", SECRET).split(":");
    parts[3] = Buffer.from("tampered-ct").toString("base64");
    expect(() => decryptSecret(parts.join(":"), SECRET)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const parts = encryptSecret("k", SECRET).split(":");
    parts[2] = Buffer.alloc(16, 7).toString("base64");
    expect(() => decryptSecret(parts.join(":"), SECRET)).toThrow();
  });

  it("throws on unknown format", () => {
    expect(() => decryptSecret("v2:a:b:c", SECRET)).toThrow(/format/i);
    expect(() => decryptSecret("garbage", SECRET)).toThrow(/format/i);
    expect(() => decryptSecret(null, SECRET)).toThrow(/format/i);
  });

  it("rejects a short secret", () => {
    expect(() => encryptSecret("k", "short")).toThrow(/32/);
  });
});
