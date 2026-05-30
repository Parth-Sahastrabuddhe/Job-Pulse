import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb } from "../src/state.js";
import {
  recordJobDelivery,
  flushDmLog,
  flushDmLogSync,
  getMuDeliveredJobKeys,
  _dmLogBufferSize,
} from "../src/multi-user-state.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-dmbuf-"));
  tempDirs.push(dir);
  const db = initDb(path.join(dir, "jobs.db"));
  // multi-user tables are migrated by initDb (state.js holds the schema).
  // Seed one user so foreign-key references are valid for dm_log.
  db.prepare(
    `INSERT INTO user_profiles
      (discord_id, discord_username, first_name, email, created_at, updated_at)
     VALUES ('d1', 'u1', 'Alice', 'a@example.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
  ).run();
  return { db, userId: 1 };
}

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.DM_LOG_FLUSH_INTERVAL_MS;
  delete process.env.DM_LOG_FLUSH_MAX_SIZE;
});

afterEach(() => {
  vi.useRealTimers();
  // Drain anything left in the buffer before closing the DB.
  try { flushDmLogSync(); } catch (_) { /* ignore */ }
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("dm_log write-behind buffer", () => {
  it("does not write to DB until flush is triggered", () => {
    const { db, userId } = makeDb();
    recordJobDelivery(userId, "source:job-1", "sent");

    expect(_dmLogBufferSize()).toBe(1);
    const dmCount = db.prepare("SELECT COUNT(*) AS cnt FROM dm_log").get().cnt;
    expect(dmCount).toBe(0);

    const flushed = flushDmLog();
    expect(flushed).toBe(1);
    expect(_dmLogBufferSize()).toBe(0);

    const after = db.prepare("SELECT COUNT(*) AS cnt FROM dm_log").get().cnt;
    expect(after).toBe(1);
    const usj = db.prepare("SELECT COUNT(*) AS cnt FROM user_seen_jobs").get().cnt;
    expect(usj).toBe(1);
  });

  it("size trigger forces an immediate flush", () => {
    process.env.DM_LOG_FLUSH_MAX_SIZE = "3";
    const { db, userId } = makeDb();

    recordJobDelivery(userId, "source:a", "sent");
    recordJobDelivery(userId, "source:b", "sent");
    expect(_dmLogBufferSize()).toBe(2);

    recordJobDelivery(userId, "source:c", "sent");
    // Third entry triggers flush.
    expect(_dmLogBufferSize()).toBe(0);
    const dmCount = db.prepare("SELECT COUNT(*) AS cnt FROM dm_log").get().cnt;
    expect(dmCount).toBe(3);
  });

  it("scheduled timer fires a flush", () => {
    process.env.DM_LOG_FLUSH_INTERVAL_MS = "1000";
    const { db, userId } = makeDb();

    recordJobDelivery(userId, "source:a", "sent");
    expect(_dmLogBufferSize()).toBe(1);

    vi.advanceTimersByTime(1100);
    // Microtasks / setTimeout callback now fired.
    expect(_dmLogBufferSize()).toBe(0);
    const dmCount = db.prepare("SELECT COUNT(*) AS cnt FROM dm_log").get().cnt;
    expect(dmCount).toBe(1);
  });

  it("getMuDeliveredJobKeys merges buffered entries before flush", () => {
    const { userId } = makeDb();

    recordJobDelivery(userId, "source:fresh", "sent");
    // Not flushed yet — dm_log on disk is empty, but the buffer holds it.
    const keys = getMuDeliveredJobKeys(userId);
    expect(keys.has("source:fresh")).toBe(true);
  });

  it("does not buffer 'failed' status for dedup", () => {
    const { userId } = makeDb();

    recordJobDelivery(userId, "source:nope", "failed");
    // Buffered for write, but NOT in the dedup set (matches pre-buffer behavior:
    // a failed send shouldn't prevent retry).
    const keys = getMuDeliveredJobKeys(userId);
    expect(keys.has("source:nope")).toBe(false);
    // But it IS in the buffer to be written to dm_log.
    expect(_dmLogBufferSize()).toBe(1);
  });

  it("flushDmLogSync drains synchronously on shutdown", () => {
    const { db, userId } = makeDb();

    for (let i = 0; i < 5; i++) recordJobDelivery(userId, `source:job-${i}`, "sent");
    expect(_dmLogBufferSize()).toBe(5);

    const drained = flushDmLogSync();
    expect(drained).toBe(5);
    expect(_dmLogBufferSize()).toBe(0);

    const dmCount = db.prepare("SELECT COUNT(*) AS cnt FROM dm_log").get().cnt;
    expect(dmCount).toBe(5);
  });

  it("restores buffer order when a large-batch flush fails and recovers on retry", () => {
    // Use a high size threshold so size-triggered flush doesn't fire on
    // the way in — we want the buffer to hold all 25 entries simultaneously.
    process.env.DM_LOG_FLUSH_MAX_SIZE = "100";
    const { db, userId } = makeDb();

    for (let i = 0; i < 25; i++) recordJobDelivery(userId, `source:job-${i}`, "sent");
    expect(_dmLogBufferSize()).toBe(25);

    // Force the transaction to fail via FK violation: delete the user so
    // user_seen_jobs INSERT throws inside the tx. Atomic rollback, buffer
    // gets unshifted back via _doFlush's catch.
    db.prepare("DELETE FROM user_profiles WHERE id = ?").run(userId);

    expect(() => flushDmLog()).toThrow();
    expect(_dmLogBufferSize()).toBe(25);

    // Restore the user and retry — the buffer should still be in original order.
    db.prepare(
      `INSERT INTO user_profiles
        (id, discord_id, discord_username, first_name, email, created_at, updated_at)
       VALUES (?, 'd1', 'u1', 'Alice', 'a@example.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run(userId);

    const flushed = flushDmLog();
    expect(flushed).toBe(25);
    expect(_dmLogBufferSize()).toBe(0);

    const rows = db.prepare("SELECT job_key FROM dm_log ORDER BY id").all();
    expect(rows.map((r) => r.job_key)).toEqual(
      Array.from({ length: 25 }, (_, i) => `source:job-${i}`)
    );
  });

  it("tracks multiple users independently", () => {
    const { db } = makeDb();
    db.prepare(
      `INSERT INTO user_profiles
        (discord_id, discord_username, first_name, email, created_at, updated_at)
       VALUES ('d2', 'u2', 'Bob', 'b@example.com', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    ).run();

    recordJobDelivery(1, "shared:job", "sent");
    recordJobDelivery(2, "shared:job", "sent");

    expect(getMuDeliveredJobKeys(1).has("shared:job")).toBe(true);
    expect(getMuDeliveredJobKeys(2).has("shared:job")).toBe(true);

    flushDmLog();
    const rows = db.prepare("SELECT user_id, COUNT(*) as cnt FROM dm_log GROUP BY user_id ORDER BY user_id").all();
    expect(rows).toEqual([{ user_id: 1, cnt: 1 }, { user_id: 2, cnt: 1 }]);
  });
});
