import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb, upsertJobs } from "../src/state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-state-"));
  tempDirs.push(dir);
  const db = initDb(path.join(dir, "jobs.db"));
  const now = "2026-01-10T00:00:00.000Z";
  db.prepare(`
    INSERT INTO user_profiles
      (id, discord_id, discord_username, first_name, email, created_at, updated_at)
    VALUES (1, 'u1', 'user', 'User', 'u1@example.com', ?, ?)
  `).run(now, now);
  return db;
}

function insertSeenJob(db, key, firstSeenAt) {
  db.prepare(`
    INSERT INTO seen_jobs
      (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
    VALUES (?, 'source', 'Source', 'job-1', 'Engineer', ?, ?)
  `).run(key, firstSeenAt, firstSeenAt);
}

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("seen job re-key remapping", () => {
  it("promotes actioned user status when a duplicate key is folded into an existing row", () => {
    const db = makeDb();
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    insertSeenJob(db, "duplicate", "2026-01-01T00:00:00.000Z");
    db.prepare(`
      INSERT INTO user_seen_jobs
        (user_id, job_key, status, notified_at, updated_at)
      VALUES (1, 'canonical', 'notified', '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO user_seen_jobs
        (user_id, job_key, status, notified_at, applied_at, updated_at)
      VALUES (1, 'duplicate', 'applied', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z')
    `).run();

    upsertJobs([
      { key: "canonical", sourceKey: "source", sourceLabel: "Source", id: "job-1", title: "Engineer" },
    ], "2026-01-11T00:00:00.000Z");

    const merged = db.prepare("SELECT * FROM user_seen_jobs WHERE user_id = 1 AND job_key = 'canonical'").get();
    expect(merged.status).toBe("applied");
    expect(merged.notified_at).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.applied_at).toBe("2026-01-02T00:00:00.000Z");
    expect(db.prepare("SELECT 1 FROM user_seen_jobs WHERE job_key = 'duplicate'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM seen_jobs WHERE key = 'duplicate'").get()).toBeUndefined();
  });

  it("keeps both keys when both already have Discord message rows", () => {
    const db = makeDb();
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    insertSeenJob(db, "duplicate", "2026-01-01T00:00:00.000Z");
    db.prepare("INSERT INTO job_posts (job_key, message_id, channel_id) VALUES ('canonical', 'm1', 'c1')").run();
    db.prepare("INSERT INTO job_posts (job_key, message_id, channel_id) VALUES ('duplicate', 'm2', 'c1')").run();

    upsertJobs([
      { key: "canonical", sourceKey: "source", sourceLabel: "Source", id: "job-1", title: "Engineer" },
    ], "2026-01-11T00:00:00.000Z");

    expect(db.prepare("SELECT message_id FROM job_posts WHERE job_key = 'canonical'").get().message_id).toBe("m1");
    expect(db.prepare("SELECT message_id FROM job_posts WHERE job_key = 'duplicate'").get().message_id).toBe("m2");
    expect(db.prepare("SELECT 1 FROM seen_jobs WHERE key = 'duplicate'").get()).toBeDefined();
  });
});
