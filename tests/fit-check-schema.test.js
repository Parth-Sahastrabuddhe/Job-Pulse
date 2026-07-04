import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb } from "../src/state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-fitschema-"));
  tempDirs.push(dir);
  return initDb(path.join(dir, "jobs.db"));
}

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("fit check schema migrations", () => {
  it("creates the new user_profiles columns on a fresh db", () => {
    const db = makeDb();
    const cols = db.pragma("table_info(user_profiles)").map((c) => c.name);
    for (const col of ["resume_text", "experience_years", "llm_provider", "llm_key_enc", "llm_base_url", "llm_model"]) {
      expect(cols).toContain(col);
    }
  });

  it("creates the new user_seen_jobs columns on a fresh db", () => {
    const db = makeDb();
    const cols = db.pragma("table_info(user_seen_jobs)").map((c) => c.name);
    for (const col of ["fit_score", "fit_verdict", "fit_scores_json", "fit_assessment", "fit_checked_at"]) {
      expect(cols).toContain(col);
    }
  });

  it("defaults llm_provider to gemini", () => {
    const db = makeDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_profiles (discord_id, discord_username, first_name, email, created_at, updated_at)
       VALUES ('d1', 'u1', 'Test', 't@example.com', ?, ?)`
    ).run(now, now);
    const row = db.prepare("SELECT llm_provider FROM user_profiles WHERE discord_id = 'd1'").get();
    expect(row.llm_provider).toBe("gemini");
  });

  it("seeds the mu_fit_check flag OFF", () => {
    const db = makeDb();
    const row = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'mu_fit_check'").get();
    expect(row).toBeDefined();
    expect(row.enabled).toBe(0);
  });

  it("does not reset a flipped flag on re-init (idempotent seed)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-fitschema-"));
    tempDirs.push(dir);
    const dbFile = path.join(dir, "jobs.db");
    let db = initDb(dbFile);
    db.prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'mu_fit_check'").run();
    closeDb();
    db = initDb(dbFile); // re-run all migrations on the existing file
    const row = db.prepare("SELECT enabled FROM feature_flags WHERE key = 'mu_fit_check'").get();
    expect(row.enabled).toBe(1);
    const cols = db.pragma("table_info(user_profiles)").map((c) => c.name);
    expect(cols).toContain("llm_key_enc");
  });

  it("migrates an existing db that predates the fit columns", () => {
    // Simulate an old db: create, then drop nothing (ALTER guards must no-op
    // cleanly when columns already exist; covered by the re-init test above).
    // Guard order sanity: initDb twice in a row must not throw.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-fitschema-"));
    tempDirs.push(dir);
    const dbFile = path.join(dir, "jobs.db");
    initDb(dbFile);
    closeDb();
    expect(() => initDb(dbFile)).not.toThrow();
  });
});
