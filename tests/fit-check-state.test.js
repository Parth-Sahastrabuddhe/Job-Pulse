import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb } from "../src/state.js";
import { countFitChecksToday, getFitResult, isFeatureEnabled, saveFitResult } from "../src/multi-user-state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-fitstate-"));
  tempDirs.push(dir);
  return initDb(path.join(dir, "jobs.db"));
}

function seedUserAndJob(db) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_profiles (discord_id, discord_username, first_name, email, created_at, updated_at)
     VALUES ('d1', 'u1', 'Test', 't@example.com', ?, ?)`
  ).run(now, now);
  const userId = db.prepare("SELECT id FROM user_profiles WHERE discord_id = 'd1'").get().id;
  db.prepare(
    `INSERT INTO seen_jobs (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
     VALUES ('src:1', 'src', 'Src', '1', 'Engineer', ?, ?)`
  ).run(now, now);
  db.prepare(
    "INSERT INTO user_seen_jobs (user_id, job_key, status, notified_at) VALUES (?, 'src:1', 'notified', ?)"
  ).run(userId, now);
  return userId;
}

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("feature flags", () => {
  it("reads the seeded flag as disabled, and enabled after flip", () => {
    const db = makeDb();
    expect(isFeatureEnabled("mu_fit_check")).toBe(false);
    db.prepare("UPDATE feature_flags SET enabled = 1 WHERE key = 'mu_fit_check'").run();
    expect(isFeatureEnabled("mu_fit_check")).toBe(true);
  });

  it("fails closed on unknown keys", () => {
    makeDb();
    expect(isFeatureEnabled("nonexistent_flag")).toBe(false);
  });
});

describe("fit results", () => {
  it("round-trips a result and counts it toward today", () => {
    const db = makeDb();
    const userId = seedUserAndJob(db);
    expect(getFitResult(userId, "src:1")).toBeUndefined();
    saveFitResult(userId, "src:1", {
      fitScore: 82,
      fitVerdict: "YES",
      fitScoresJson: JSON.stringify({ score: 82, skills: 85, experience: 75, domain: 90, level: 78 }),
      fitAssessment: "solid match",
    });
    const row = getFitResult(userId, "src:1");
    expect(row.fit_score).toBe(82);
    expect(row.fit_verdict).toBe("YES");
    expect(row.fit_assessment).toBe("solid match");
    expect(row.fit_checked_at).toBeTruthy();
    expect(countFitChecksToday(userId)).toBe(1);
  });

  it("trims the assessment to 1500 chars", () => {
    const db = makeDb();
    const userId = seedUserAndJob(db);
    saveFitResult(userId, "src:1", { fitScore: 1, fitVerdict: "NO", fitScoresJson: null, fitAssessment: "x".repeat(5000) });
    expect(getFitResult(userId, "src:1").fit_assessment.length).toBe(1500);
  });

  it("does not count yesterday's checks toward today", () => {
    const db = makeDb();
    const userId = seedUserAndJob(db);
    saveFitResult(userId, "src:1", { fitScore: 50, fitVerdict: "STRETCH", fitScoresJson: null, fitAssessment: "" });
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    db.prepare("UPDATE user_seen_jobs SET fit_checked_at = ? WHERE user_id = ? AND job_key = 'src:1'").run(yesterday, userId);
    expect(countFitChecksToday(userId)).toBe(0);
  });
});
