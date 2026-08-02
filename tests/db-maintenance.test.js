import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, initDb } from "../src/state.js";
import { finalizeJob } from "../src/sources/shared.js";

const tempDirs = [];

afterEach(() => {
  try { closeDb(); } catch {}
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("db maintenance", () => {
  it("reuses the runtime remapper and leaves ambiguous cleanup for manual review", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-maintenance-"));
    tempDirs.push(dir);
    const dbFile = path.join(dir, "jobs.db");
    const db = initDb(dbFile);
    db.prepare(`
      INSERT INTO user_profiles
        (id, discord_id, discord_username, first_name, email, created_at, updated_at)
      VALUES (1, 'd1', 'user', 'User', 'u@example.com', '2026-01-01', '2026-01-01')
    `).run();
    const insertSeen = db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, url, first_seen_at, last_seen_at)
      VALUES (?, ?, 'Source', ?, ?, ?, ?, ?)
    `);
    insertSeen.run("legacy-old", "source", "job-1", "Engineer", "https://example.com/job-1", "2026-01-01", "2026-01-01");
    insertSeen.run("legacy-new", "source", "job-1", "Engineer II", "https://example.com/job-1", "2026-01-02", "2026-01-02");
    // Blank IDs are not a stable identity and must never be mass-merged.
    insertSeen.run("blank-a", "source", "", "A", "https://example.com/shared", "2026-01-01", "2026-01-01");
    insertSeen.run("blank-b", "source", "", "B", "https://example.com/shared", "2026-01-01", "2026-01-01");

    db.prepare(`
      INSERT INTO user_seen_jobs
        (user_id, job_key, status, notified_at, fit_score, fit_verdict,
         fit_scores_json, fit_assessment, fit_checked_at)
      VALUES (1, 'legacy-old', 'applied', '2026-01-01', 91, 'strong',
              '{"resume":91}', 'Great match', '2026-01-02')
    `).run();
    db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claimed_at, lease_until, updated_at)
      VALUES (1, 'legacy-old', 'sent', '2026-01-01', NULL, '2026-01-01'),
             (1, 'legacy-new', 'queued', '2026-01-02', NULL, '2026-01-02'),
             (1, 'missing-job', 'sent', '2026-01-01', NULL, '2026-01-01')
    `).run();
    db.prepare("INSERT INTO job_posts (job_key, message_id, channel_id) VALUES ('legacy-old', 'm1', 'c1')").run();
    db.prepare("INSERT INTO dm_log (user_id, job_key, status, sent_at) VALUES (1, 'missing-job', 'sent', '2026-01-01')").run();
    closeDb();

    const result = spawnSync(process.execPath, ["scripts/db-maintenance.js", "--apply"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, DB_FILE: dbFile },
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

    const inspected = new Database(dbFile);
    try {
      const canonicalKey = finalizeJob({ sourceKey: "source", id: "job-1" }).key;
      expect(inspected.prepare("SELECT key FROM seen_jobs WHERE source_key = 'source' AND id = 'job-1'").all())
        .toEqual([{ key: canonicalKey }]);
      expect(inspected.prepare("SELECT key FROM seen_jobs WHERE id = '' ORDER BY key").all())
        .toEqual([{ key: "blank-a" }, { key: "blank-b" }]);
      expect(inspected.prepare("SELECT status, fit_score, fit_verdict FROM user_seen_jobs WHERE job_key = ?").get(canonicalKey))
        .toEqual({ status: "applied", fit_score: 91, fit_verdict: "strong" });
      expect(inspected.prepare("SELECT status FROM delivery_claims WHERE user_id = 1 AND job_key = ?").get(canonicalKey))
        .toEqual({ status: "sent" });
      expect(inspected.prepare("SELECT job_key FROM job_posts WHERE message_id = 'm1'").get())
        .toEqual({ job_key: canonicalKey });
      expect(inspected.prepare("SELECT old_key, canonical_key FROM job_key_aliases ORDER BY old_key").all())
        .toEqual([
          { old_key: "legacy-new", canonical_key: canonicalKey },
          { old_key: "legacy-old", canonical_key: canonicalKey },
        ]);
      // Automated maintenance reports orphans but does not destroy evidence or
      // potentially recoverable delivery history.
      expect(inspected.prepare("SELECT status FROM dm_log WHERE job_key = 'missing-job'").get())
        .toEqual({ status: "sent" });
      expect(inspected.prepare("SELECT status FROM delivery_claims WHERE job_key = 'missing-job'").get())
        .toEqual({ status: "sent" });
    } finally {
      inspected.close();
    }
  });
});
