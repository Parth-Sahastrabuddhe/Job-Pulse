import { describe, expect, it } from "vitest";
import { getConfig, parseBoundedInteger } from "../src/config.js";

describe("parseBoundedInteger", () => {
  it("uses the fallback only when the setting is absent", () => {
    expect(parseBoundedInteger(undefined, 20, { min: 1, max: 100 })).toBe(20);
    expect(parseBoundedInteger("", 20, { min: 1, max: 100 })).toBe(20);
  });

  it("accepts integers inside the declared range", () => {
    expect(parseBoundedInteger(" 42 ", 20, { min: 1, max: 100 })).toBe(42);
    expect(parseBoundedInteger("0", 20, { min: 0, max: 100 })).toBe(0);
  });

  it("fails fast for malformed, zero, negative, and oversized values", () => {
    const options = { name: "BATCH_SIZE", min: 1, max: 500 };
    expect(() => parseBoundedInteger("nope", 20, options)).toThrow("BATCH_SIZE must be an integer");
    expect(() => parseBoundedInteger("1.5", 20, options)).toThrow("BATCH_SIZE must be an integer");
    expect(() => parseBoundedInteger("0", 20, options)).toThrow("BATCH_SIZE must be between 1 and 500");
    expect(() => parseBoundedInteger("-1", 20, options)).toThrow("BATCH_SIZE must be between 1 and 500");
    expect(() => parseBoundedInteger("501", 20, options)).toThrow("BATCH_SIZE must be between 1 and 500");
  });
});

describe("public configuration boundary", () => {
  it("does not expose private database, delivery, heartbeat, or applicant settings", () => {
    const config = getConfig();
    for (const key of ["dbFile", "stateFile", "notifications", "heartbeat", "applicant"]) {
      expect(config).not.toHaveProperty(key);
    }
  });
});
