import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeDb,
  initDb,
  upsertJobs,
  getNewJobs,
  pruneState,
  _invalidateSeenJobsCache,
} from "../src/state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-cache-"));
  tempDirs.push(dir);
  return initDb(path.join(dir, "jobs.db"));
}

function job(overrides = {}) {
  return {
    key: "source:job-1",
    sourceKey: "source",
    sourceLabel: "Source",
    id: "job-1",
    title: "Engineer",
    location: "Remote",
    url: "https://example.com/job-1",
    postedAt: "2026-01-01T00:00:00.000Z",
    postedPrecision: "second",
    countryCode: "US",
    seniorityLevel: "mid",
    roleCategories: ["software_engineer"],
    ...overrides,
  };
}

beforeEach(() => {
  delete process.env.SEEN_JOB_TOUCH_INTERVAL_MINUTES;
  delete process.env.SQLITE_UPSERT_CHUNK_DELAY_MS;
  delete process.env.SEEN_JOBS_CACHE_TTL_MINUTES;
});

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("seen_jobs in-memory cache", () => {
  it("populates cache from DB on first lookup", () => {
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    const db = makeDb();

    // Seed a row directly, bypassing upsertJobs so cache stays empty.
    db.prepare(
      `INSERT INTO seen_jobs (key, source_key, source_label, id, title, url, first_seen_at, last_seen_at)
       VALUES ('source:seeded', 'source', 'Source', 'seeded', 'X', 'https://seeded.example/x',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();

    _invalidateSeenJobsCache();

    // getNewJobs should see the seeded row via cache load.
    const filtered = getNewJobs([{ key: "source:seeded", sourceKey: "source", id: "seeded", url: "https://seeded.example/x" }]);
    expect(filtered).toHaveLength(0);
  });

  it("keeps cache in sync after upsertJobs", () => {
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    makeDb();

    upsertJobs([job()], "2026-01-01T00:00:00.000Z");

    // Second call with same job should hit cache → no new write needed.
    const stats = upsertJobs([job()], "2026-01-01T00:00:30.000Z");
    expect(stats).toMatchObject({ upserted: 0, skipped: 1 });

    // Different URL same key → cache picks up new URL.
    upsertJobs([job({ url: "https://example.com/job-1?utm=x" })], "2026-01-01T00:05:00.000Z");
    // getNewJobs against the same job's NEW url should return empty (already seen via key).
    const filtered = getNewJobs([{
      key: "source:job-1",
      sourceKey: "source",
      id: "job-1",
      url: "https://example.com/job-1?utm=x",
    }]);
    expect(filtered).toHaveLength(0);
  });

  it("detects sourceKey:id collision through cache index", () => {
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    makeDb();

    upsertJobs([job()], "2026-01-01T00:00:00.000Z");

    // A different "key" but same sourceKey + id should be deduped by cache.
    const filtered = getNewJobs([{
      key: "source:job-1-different-hash",
      sourceKey: "source",
      id: "job-1",
      url: "https://example.com/job-1",
    }]);
    expect(filtered).toHaveLength(0);
  });

  it("invalidates cache when pruneState deletes rows", () => {
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    const db = makeDb();

    upsertJobs([job()], "2026-01-01T00:00:00.000Z");

    // Backdate last_seen_at far beyond retention so prune deletes it.
    db.prepare("UPDATE seen_jobs SET last_seen_at = ? WHERE key = ?")
      .run("2024-01-01T00:00:00.000Z", "source:job-1");

    pruneState(45);

    // Row is gone from DB. Re-upserting should perform a fresh insert.
    const stats = upsertJobs([job()], "2026-03-01T00:00:00.000Z");
    expect(stats.upserted).toBe(1);

    // And the cache reflects the new row, not the deleted one.
    const filtered = getNewJobs([{ key: "source:job-1", sourceKey: "source", id: "job-1" }]);
    expect(filtered).toHaveLength(0);
  });

  it("TTL reload picks up rows written by another process (manual invalidate)", () => {
    process.env.SEEN_JOBS_CACHE_TTL_MINUTES = "1";
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    const db = makeDb();

    upsertJobs([job()], "2026-01-01T00:00:00.000Z");

    // External writer (e.g. sync-sheet) adds a row with a different URL.
    db.prepare(
      `INSERT INTO seen_jobs (key, source_key, source_label, id, title, url, first_seen_at, last_seen_at)
       VALUES ('sheet:external:row-9', 'sheet:external', 'External', 'row-9', 'External Role',
               'https://external.example/x', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();

    // Force cache reload to simulate TTL expiry.
    _invalidateSeenJobsCache();

    const filtered = getNewJobs([{ key: "sheet:external:row-9", sourceKey: "sheet:external", id: "row-9" }]);
    expect(filtered).toHaveLength(0);
  });

  it("TTL reload fires automatically once cached load time exceeds TTL", () => {
    // Cover the actual TTL comparison path in ensureSeenJobsCache, not just
    // the manual invalidation case.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    process.env.SEEN_JOBS_CACHE_TTL_MINUTES = "1";
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    try {
      const db = makeDb();
      upsertJobs([job()], "2026-01-01T00:00:00.000Z");

      // Insert a row directly so it's invisible to the loaded cache.
      db.prepare(
        `INSERT INTO seen_jobs (key, source_key, source_label, id, title, url, first_seen_at, last_seen_at)
         VALUES ('source:later', 'source', 'Source', 'later', 'Later', 'https://example.com/later',
                 '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
      ).run();

      // Before TTL elapses, the cache still treats the row as missing.
      vi.setSystemTime(new Date("2026-01-01T00:00:30.000Z"));
      let filtered = getNewJobs([{ key: "source:later", sourceKey: "source", id: "later" }]);
      expect(filtered).toHaveLength(1);

      // After TTL elapses, ensureSeenJobsCache reloads from disk and sees the row.
      vi.setSystemTime(new Date("2026-01-01T00:01:30.000Z"));
      filtered = getNewJobs([{ key: "source:later", sourceKey: "source", id: "later" }]);
      expect(filtered).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closeDb invalidates cache so a fresh DB starts clean", () => {
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    makeDb();
    upsertJobs([job()], "2026-01-01T00:00:00.000Z");
    closeDb();

    // Fresh DB in a new directory — cache should not bleed over.
    makeDb();
    const filtered = getNewJobs([{ key: "source:job-1", sourceKey: "source", id: "job-1" }]);
    expect(filtered).toHaveLength(1);
  });
});
