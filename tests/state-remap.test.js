import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb, upsertJobs } from "../src/state.js";
import { claimQueuedJobDelivery } from "../src/multi-user-state.js";

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

  it("moves a legacy mutable hash to the incoming stable key without losing fit data", () => {
    const db = makeDb();
    insertSeenJob(db, "legacy-title-location-hash", "2026-01-01T00:00:00.000Z");
    db.prepare(`UPDATE seen_jobs
                  SET fit_score = 91,
                      fit_scores_json = '{"skills":91}',
                      legitimacy_tier = 'high_confidence',
                      legitimacy_signals_json = '["verified"]'
                WHERE key = 'legacy-title-location-hash'`).run();
    db.prepare(`
      INSERT INTO user_seen_jobs
        (user_id, job_key, status, notified_at, fit_score, fit_verdict,
         fit_scores_json, fit_assessment, fit_checked_at)
      VALUES
        (1, 'legacy-title-location-hash', 'notified', '2026-01-01', 88,
         'strong', '{"resume":88}', 'Good match', '2026-01-02')
    `).run();

    upsertJobs([{
      key: "stable-source-id-hash",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Engineer, Renamed",
      location: "New York",
      url: "https://example.com/job-1",
    }], "2026-01-11T00:00:00.000Z");

    expect(db.prepare("SELECT 1 FROM seen_jobs WHERE key = 'legacy-title-location-hash'").get()).toBeUndefined();
    const job = db.prepare("SELECT * FROM seen_jobs WHERE key = 'stable-source-id-hash'").get();
    expect(job).toMatchObject({
      title: "Engineer, Renamed",
      location: "New York",
      fit_score: 91,
      fit_scores_json: '{"skills":91}',
      legitimacy_tier: "high_confidence",
      legitimacy_signals_json: '["verified"]',
    });
    const userJob = db.prepare("SELECT * FROM user_seen_jobs WHERE user_id = 1 AND job_key = 'stable-source-id-hash'").get();
    expect(userJob).toMatchObject({
      fit_score: 88,
      fit_verdict: "strong",
      fit_scores_json: '{"resume":88}',
      fit_assessment: "Good match",
      fit_checked_at: "2026-01-02",
    });
  });

  it("reconciles every legacy hash for the same non-empty source id", () => {
    const db = makeDb();
    insertSeenJob(db, "legacy-old-title", "2025-12-01T00:00:00.000Z");
    insertSeenJob(db, "legacy-new-title", "2026-01-01T00:00:00.000Z");

    const stats = upsertJobs([{
      key: "stable-source-id-hash",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Current Engineer",
    }], "2026-01-11T00:00:00.000Z");

    expect(stats.remapped).toBe(2);
    expect(db.prepare("SELECT key FROM seen_jobs WHERE source_key = 'source' AND id = 'job-1'").all()).toEqual([
      { key: "stable-source-id-hash" },
    ]);
    expect(db.prepare("SELECT first_seen_at FROM seen_jobs WHERE key = 'stable-source-id-hash'").get().first_seen_at)
      .toBe("2025-12-01T00:00:00.000Z");
  });

  it("finds legacy source/id rows even when the cache index points at the canonical key", () => {
    const db = makeDb();
    // Insertion order makes the cache's one-value source/id index end on the
    // canonical row. The DB query must still discover the older mutable hash.
    insertSeenJob(db, "legacy-applied", "2026-01-01T00:00:00.000Z");
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    db.prepare(`
      INSERT INTO user_seen_jobs (user_id, job_key, status, notified_at, applied_at)
      VALUES (1, 'legacy-applied', 'applied', '2026-01-01', '2026-01-02')
    `).run();

    upsertJobs([{
      key: "canonical",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Current Engineer",
    }], "2026-01-11T00:00:00.000Z");

    expect(db.prepare("SELECT key FROM seen_jobs WHERE source_key = 'source' AND id = 'job-1'").all())
      .toEqual([{ key: "canonical" }]);
    expect(db.prepare("SELECT status FROM user_seen_jobs WHERE user_id = 1 AND job_key = 'canonical'").get().status)
      .toBe("applied");
  });

  it("prefers a sent delivery claim over queued while remapping duplicates", () => {
    const db = makeDb();
    insertSeenJob(db, "legacy-sent", "2026-01-01T00:00:00.000Z");
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    db.prepare(`
      INSERT INTO delivery_claims (user_id, job_key, status, claimed_at, lease_until, updated_at)
      VALUES (1, 'legacy-sent', 'sent', '2026-01-01', NULL, '2026-01-01'),
             (1, 'canonical', 'queued', '2026-01-05', NULL, '2026-01-05')
    `).run();
    db.prepare(`
      INSERT INTO dm_log (user_id, job_key, status, sent_at)
      VALUES (1, 'legacy-sent', 'sent', '2026-01-01'),
             (1, 'canonical', 'queued', '2026-01-05')
    `).run();

    upsertJobs([{
      key: "canonical",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Current Engineer",
    }], "2026-01-11T00:00:00.000Z");

    expect(db.prepare("SELECT status FROM delivery_claims WHERE user_id = 1 AND job_key = 'canonical'").get().status)
      .toBe("sent");
    expect(claimQueuedJobDelivery(1, "canonical")).toBeNull();
  });

  it("preserves the winning sending token when only one remapped key is active", () => {
    const db = makeDb();
    insertSeenJob(db, "legacy", "2026-01-01T00:00:00.000Z");
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
      VALUES
        (1, 'legacy', 'sending', 'legacy-owner', '2026-01-01', '2026-02-01', '2026-01-01'),
        (1, 'canonical', 'queued', NULL, '2026-01-05', NULL, '2026-01-05')
    `).run();

    upsertJobs([{
      key: "canonical",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Current Engineer",
    }], "2026-01-11T00:00:00.000Z");

    expect(db.prepare(`
      SELECT job_key, status, claim_token, lease_until
        FROM delivery_claims WHERE user_id = 1
    `).get()).toEqual({
      job_key: "canonical",
      status: "sending",
      claim_token: "legacy-owner",
      lease_until: "2026-02-01",
    });
  });

  it("marks a remap collision uncertain when both keys crossed the send boundary", () => {
    const db = makeDb();
    insertSeenJob(db, "legacy", "2026-01-01T00:00:00.000Z");
    insertSeenJob(db, "canonical", "2026-01-05T00:00:00.000Z");
    db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
      VALUES
        (1, 'legacy', 'digest_sending', 'legacy-owner', '2026-01-01', '2026-02-01', '2026-01-01'),
        (1, 'canonical', 'sending', 'canonical-owner', '2026-01-05', '2026-02-05', '2026-01-05')
    `).run();

    upsertJobs([{
      key: "canonical",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Current Engineer",
    }], "2026-01-11T00:00:00.000Z");

    expect(db.prepare(`
      SELECT job_key, status, claim_token, lease_until
        FROM delivery_claims WHERE user_id = 1
    `).get()).toEqual({
      job_key: "canonical",
      status: "uncertain",
      claim_token: null,
      lease_until: null,
    });
    expect(db.prepare("SELECT 1 FROM delivery_claims WHERE job_key = 'legacy'").get()).toBeUndefined();
  });
});
