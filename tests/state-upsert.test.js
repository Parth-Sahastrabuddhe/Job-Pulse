import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb, upsertJobs } from "../src/state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-upsert-"));
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

afterEach(() => {
  closeDb();
  delete process.env.SEEN_JOB_TOUCH_INTERVAL_MINUTES;
  delete process.env.SQLITE_UPSERT_CHUNK_DELAY_MS;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("upsertJobs write throttling", () => {
  it("skips unchanged rows until the touch interval expires", () => {
    process.env.SEEN_JOB_TOUCH_INTERVAL_MINUTES = "360";
    process.env.SQLITE_UPSERT_CHUNK_DELAY_MS = "1";
    const db = makeDb();

    const firstSeen = "2026-01-01T00:00:00.000Z";
    expect(upsertJobs([job()], firstSeen)).toMatchObject({ upserted: 1 });

    const skippedAt = "2026-01-01T00:05:00.000Z";
    expect(upsertJobs([job()], skippedAt)).toMatchObject({ skipped: 1, touched: 0, upserted: 0 });
    expect(db.prepare("SELECT last_seen_at FROM seen_jobs WHERE key = ?").get("source:job-1").last_seen_at).toBe(firstSeen);

    const touchedAt = "2026-01-01T07:00:00.000Z";
    expect(upsertJobs([job()], touchedAt)).toMatchObject({ touched: 1, upserted: 0 });
    expect(db.prepare("SELECT last_seen_at FROM seen_jobs WHERE key = ?").get("source:job-1").last_seen_at).toBe(touchedAt);
  });

  it("still writes when a meaningful indexed field changes", () => {
    process.env.SEEN_JOB_TOUCH_INTERVAL_MINUTES = "360";
    const db = makeDb();

    upsertJobs([job()], "2026-01-01T00:00:00.000Z");
    const changedAt = "2026-01-01T00:05:00.000Z";
    const stats = upsertJobs([job({ postedAt: "2026-01-02T00:00:00.000Z" })], changedAt);

    expect(stats).toMatchObject({ upserted: 1, skipped: 0 });
    const row = db.prepare("SELECT posted_at, last_seen_at FROM seen_jobs WHERE key = ?").get("source:job-1");
    expect(row.posted_at).toBe("2026-01-02T00:00:00.000Z");
    expect(row.last_seen_at).toBe(changedAt);
  });
});
