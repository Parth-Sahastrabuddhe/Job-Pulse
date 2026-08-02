import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { getConfig, PROJECT_ROOT } from "../src/private-config.js";

const originalDbFile = process.env.DB_FILE;
const originalDbPath = process.env.DB_PATH;

afterEach(() => {
  if (originalDbFile === undefined) delete process.env.DB_FILE;
  else process.env.DB_FILE = originalDbFile;
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe("private database configuration", () => {
  it("uses DB_FILE consistently and treats DB_PATH only as a legacy fallback", () => {
    process.env.DB_FILE = "data/canonical.db";
    process.env.DB_PATH = "data/legacy.db";
    expect(getConfig().dbFile).toBe(path.join(PROJECT_ROOT, "data", "canonical.db"));

    delete process.env.DB_FILE;
    expect(getConfig().dbFile).toBe(path.join(PROJECT_ROOT, "data", "legacy.db"));
  });
});
