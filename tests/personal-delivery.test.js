import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  PERSONAL_DELIVERY_CLAIM_MESSAGE_ID,
  claimPersonalDelivery,
  closeDb,
  getDb,
  getFunnelStats,
  getUnnotifiedJobs,
  initDb,
  listPersonalDeliveryClaims,
  recordExternalDelivery,
  releasePersonalDeliveryClaim,
  upsertJobs,
} from "../src/state.js";
import { sendDiscordNotification } from "../src/notifiers/discord.js";
import { sendTelegramNotification } from "../src/notifiers/telegram.js";

const tempDirs = [];

function newDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-personal-delivery-"));
  tempDirs.push(dir);
  const dbFile = path.join(dir, "jobs.db");
  return { dbFile, db: initDb(dbFile) };
}

function job(key, title = "Software Engineer") {
  return {
    key,
    sourceKey: "example",
    sourceLabel: "Example",
    id: key,
    title,
    location: "Remote",
    url: `https://example.com/jobs/${key}`,
  };
}

function response(status, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("personal delivery claims", () => {
  it("atomically excludes a claimed job and releases a known failure", () => {
    newDb();
    const candidate = job("job-1");

    const token = claimPersonalDelivery(candidate.key, "channel");
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(claimPersonalDelivery(candidate.key, "channel")).toBeNull();
    expect(getUnnotifiedJobs([candidate])).toEqual([]);
    const claim = getDb().prepare(`
      SELECT message_id, delivery_claim_token, delivery_claimed_at
        FROM job_posts WHERE job_key = ?
    `).get(candidate.key);
    expect(claim.message_id).toBe(PERSONAL_DELIVERY_CLAIM_MESSAGE_ID);
    expect(claim.delivery_claim_token).toBe(token);
    expect(Number.isFinite(Date.parse(claim.delivery_claimed_at))).toBe(true);
    expect(getFunnelStats().notified).toBe(0);
    expect(getFunnelStats().uncertain).toBe(1);

    expect(releasePersonalDeliveryClaim(candidate.key, "wrong-token")).toBe(false);
    expect(getUnnotifiedJobs([candidate])).toEqual([]);
    expect(releasePersonalDeliveryClaim(candidate.key, token)).toBe(true);
    expect(getUnnotifiedJobs([candidate])).toEqual([candidate]);
  });

  it("persists an uncertain pre-send marker across process restarts", () => {
    const { dbFile } = newDb();
    const candidate = job("job-2");
    const token = claimPersonalDelivery(candidate.key);
    expect(token).toBeTruthy();
    closeDb();

    initDb(dbFile);
    expect(getUnnotifiedJobs([candidate])).toEqual([]);
    expect(releasePersonalDeliveryClaim(candidate.key, token)).toBe(true);
  });

  it("finalizes a webhook claim without creating a duplicate row", () => {
    const { db } = newDb();
    const candidate = job("job-3");
    const token = claimPersonalDelivery(candidate.key);
    expect(token).toBeTruthy();

    expect(recordExternalDelivery(candidate.key, "webhook", "wrong-token")).toBe(false);
    expect(recordExternalDelivery(candidate.key, "webhook", token)).toBe(true);

    expect(db.prepare(`
      SELECT message_id, channel_id, status, delivery_claim_token, delivery_claimed_at
        FROM job_posts WHERE job_key = ?
    `).get(candidate.key)).toEqual({
      message_id: "",
      channel_id: "webhook",
      status: "pending",
      delivery_claim_token: null,
      delivery_claimed_at: null,
    });
    expect(getUnnotifiedJobs([candidate])).toEqual([]);
  });

  it("moves a pre-send claim when a legacy job key is canonicalized", () => {
    const { db } = newDb();
    db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES ('legacy-key', 'source', 'Source', 'id-1', 'Old title', '2026-01-01', '2026-01-01')
    `).run();
    const token = claimPersonalDelivery("legacy-key");
    expect(token).toBeTruthy();

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "id-1",
      title: "Current title",
    }], "2026-01-02");

    expect(db.prepare("SELECT job_key, message_id, delivery_claim_token FROM job_posts").all()).toEqual([{
      job_key: "canonical-key",
      message_id: PERSONAL_DELIVERY_CLAIM_MESSAGE_ID,
      delivery_claim_token: token,
    }]);
    expect(releasePersonalDeliveryClaim("legacy-key", "wrong-token")).toBe(false);
    expect(recordExternalDelivery("legacy-key", "webhook", token)).toBe(true);
  });

  it("does not reverse an existing alias when a stale job object is upserted", () => {
    const { db } = newDb();
    db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES ('legacy-key', 'source', 'Source', 'id-1', 'Old title', '2026-01-01', '2026-01-01')
    `).run();

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "id-1",
      title: "Current title",
    }], "2026-01-02");
    const token = claimPersonalDelivery("legacy-key");

    upsertJobs([{
      key: "legacy-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "id-1",
      title: "Stale worker title",
    }], "2026-01-03");

    expect(db.prepare("SELECT key FROM seen_jobs ORDER BY key").all()).toEqual([{ key: "canonical-key" }]);
    expect(db.prepare("SELECT old_key, canonical_key FROM job_key_aliases").all()).toEqual([{
      old_key: "legacy-key",
      canonical_key: "canonical-key",
    }]);
    expect(db.prepare("SELECT job_key, delivery_claim_token FROM job_posts").all()).toEqual([{
      job_key: "canonical-key",
      delivery_claim_token: token,
    }]);
    expect(getUnnotifiedJobs([job("legacy-key")])).toEqual([]);
  });

  it("preserves both owners when canonicalization encounters two delivery rows", () => {
    const { db } = newDb();
    const insertSeen = db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES (?, 'source', 'Source', 'id-1', ?, '2026-01-01', '2026-01-01')
    `);
    insertSeen.run("legacy-key", "Old title");
    insertSeen.run("canonical-key", "Current title");
    const legacyToken = claimPersonalDelivery("legacy-key");
    const canonicalToken = claimPersonalDelivery("canonical-key");

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "id-1",
      title: "Current title",
    }], "2026-01-02");

    expect(db.prepare("SELECT job_key, delivery_claim_token FROM job_posts ORDER BY job_key").all()).toEqual([
      { job_key: "canonical-key", delivery_claim_token: canonicalToken },
      { job_key: "legacy-key", delivery_claim_token: legacyToken },
    ]);
    expect(db.prepare("SELECT * FROM job_key_aliases").all()).toEqual([]);
    expect(releasePersonalDeliveryClaim("canonical-key", legacyToken)).toBe(false);
    expect(releasePersonalDeliveryClaim("legacy-key", legacyToken)).toBe(true);
    expect(db.prepare("SELECT delivery_claim_token FROM job_posts WHERE job_key = 'canonical-key'").get())
      .toEqual({ delivery_claim_token: canonicalToken });
  });

  it("lists unresolved claims with owner reconciliation metadata", () => {
    const { db } = newDb();
    const candidate = job("old-claim");
    upsertJobs([candidate], "2026-01-01");
    const token = claimPersonalDelivery(candidate.key, "channel");
    db.prepare("UPDATE job_posts SET delivery_claimed_at = '2026-01-01T00:00:00.000Z'").run();

    expect(listPersonalDeliveryClaims({ olderThanMinutes: 60 })).toEqual([{
      jobKey: candidate.key,
      channelId: "channel",
      claimToken: token,
      claimedAt: "2026-01-01T00:00:00.000Z",
      sourceLabel: candidate.sourceLabel,
      title: candidate.title,
    }]);
  });

  it("backfills ownership metadata for an older unresolved sentinel", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-personal-delivery-legacy-"));
    tempDirs.push(dir);
    const dbFile = path.join(dir, "jobs.db");
    const legacy = new Database(dbFile);
    legacy.exec(`
      CREATE TABLE job_posts (
        job_key TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        thread_id TEXT,
        channel_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending'
      );
      INSERT INTO job_posts (job_key, message_id, channel_id, status)
      VALUES ('legacy-claim', '${PERSONAL_DELIVERY_CLAIM_MESSAGE_ID}', 'channel', 'delivery_claimed');
    `);
    legacy.close();

    const db = initDb(dbFile);
    const row = db.prepare(`
      SELECT delivery_claim_token, delivery_claimed_at
        FROM job_posts WHERE job_key = 'legacy-claim'
    `).get();
    expect(row.delivery_claim_token).toMatch(/^[0-9a-f]{32}$/);
    expect(Number.isFinite(Date.parse(row.delivery_claimed_at))).toBe(true);
    expect(releasePersonalDeliveryClaim("legacy-claim", row.delivery_claim_token)).toBe(true);
  });
});

describe("chunk delivery outcomes", () => {
  const longTitle = "Engineer ".repeat(170);

  it("persists a successful Discord chunk and preserves an uncertain remainder", async () => {
    const jobs = [job("first", longTitle), job("second", longTitle)];
    let calls = 0;
    const persisted = [];
    const result = await sendDiscordNotification("https://discord.com/api/webhooks/test", jobs, {
      maxRetries: 0,
      fetchFn: async () => response(++calls === 1 ? 204 : 500, "failed"),
      onChunkDelivered: async (chunkJobs) => persisted.push(...chunkJobs.map((item) => item.key)),
    });

    expect(persisted).toEqual(["first"]);
    expect(result.deliveredJobs.map((item) => item.key)).toEqual(["first"]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs.map((item) => item.key)).toEqual(["second"]);
  });

  it("marks an accepted Telegram chunk uncertain when its ledger commit fails", async () => {
    const candidate = job("telegram");
    const result = await sendTelegramNotification("token", "chat", [candidate], {
      maxRetries: 0,
      fetchFn: async () => response(200),
      onChunkDelivered: async () => {
        throw new Error("database locked");
      },
    });

    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs).toEqual([candidate]);
  });
});
