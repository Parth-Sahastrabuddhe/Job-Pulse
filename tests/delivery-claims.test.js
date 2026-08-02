import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb, upsertJobs } from "../src/state.js";
import {
  beginJobDeliverySend,
  beginQueuedJobDeliverySend,
  claimJobDelivery,
  claimQueuedJobDelivery,
  finishJobDeliveryClaim,
  finishJobDeliverySend,
  finishQueuedJobDeliveryClaim,
  finishQueuedJobDeliverySend,
  findJobKeyByHash,
  flushDmLogSync,
  getMuDeliveredJobKeys,
  recordJobDelivery,
  recoverExpiredDeliveryClaims,
  releaseJobDeliveryClaim,
  releaseQueuedJobDeliveryClaim,
} from "../src/multi-user-state.js";
import { jobButtonHash } from "../src/job-key-hash.js";

const tempDirs = [];

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-claims-"));
  tempDirs.push(dir);
  const db = initDb(path.join(dir, "jobs.db"));
  db.prepare(`
    INSERT INTO user_profiles
      (id, discord_id, discord_username, first_name, email, created_at, updated_at)
    VALUES (1, 'd1', 'user', 'User', 'u@example.com', '2026-01-01', '2026-01-01')
  `).run();
  return db;
}

afterEach(() => {
  try { flushDmLogSync(); } catch {}
  closeDb();
  delete process.env.DELIVERY_CLAIM_LEASE_MS;
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("durable delivery claims", () => {
  it("allows only one active instance to claim a user/job pair", () => {
    const db = makeDb();
    const token = claimJobDelivery(1, "source:one");
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(claimJobDelivery(1, "source:one")).toBeNull();

    // Compatibility ledger writes cannot steal a live owner generation.
    expect(recordJobDelivery(1, "source:one", "sent")).toBe(false);
    expect(db.prepare("SELECT status, claim_token FROM delivery_claims WHERE user_id = 1 AND job_key = ?").get("source:one"))
      .toEqual({ status: "claimed", claim_token: token });
    expect(beginJobDeliverySend(1, "source:one", token)).toBe(true);
    expect(finishJobDeliverySend(1, "source:one", token, "sent")).toBe(true);
    expect(claimJobDelivery(1, "source:one")).toBeNull();
    expect(getMuDeliveredJobKeys(1).has("source:one")).toBe(true);
  });

  it("releases known failures for retry while retaining terminal claims", () => {
    makeDb();
    const firstToken = claimJobDelivery(1, "source:retry");
    expect(releaseJobDeliveryClaim(1, "source:retry", firstToken)).toBe(true);
    const retryToken = claimJobDelivery(1, "source:retry");
    expect(retryToken).not.toBe(firstToken);
    expect(beginJobDeliverySend(1, "source:retry", retryToken)).toBe(true);
    expect(finishJobDeliverySend(1, "source:retry", retryToken, "dm_closed")).toBe(true);
    expect(claimJobDelivery(1, "source:retry")).toBeNull();
  });

  it("releases only the owning token after an explicit known send failure", () => {
    makeDb();
    const directToken = claimJobDelivery(1, "source:known-direct");
    expect(beginJobDeliverySend(1, "source:known-direct", directToken)).toBe(true);
    expect(finishJobDeliverySend(1, "source:known-direct", directToken, "failed")).toBe(true);
    expect(claimJobDelivery(1, "source:known-direct")).toMatch(/^[a-f0-9]{32}$/);

    const queueOwner = claimJobDelivery(1, "source:known-digest");
    expect(finishJobDeliveryClaim(1, "source:known-digest", queueOwner, "queued")).toBe(true);
    flushDmLogSync();
    const digestToken = claimQueuedJobDelivery(1, "source:known-digest");
    const claims = [{ jobKey: "source:known-digest", claimToken: digestToken }];
    expect(beginQueuedJobDeliverySend(1, claims)).toBe(true);
    expect(finishQueuedJobDeliverySend(1, claims, "queued")).toBe(true);
    expect(claimQueuedJobDelivery(1, "source:known-digest")).toMatch(/^[a-f0-9]{32}$/);
  });

  it("serializes queued digest and quiet-hours sends", () => {
    makeDb();
    const directToken = claimJobDelivery(1, "source:queued");
    expect(finishJobDeliveryClaim(1, "source:queued", directToken, "queued")).toBe(true);
    flushDmLogSync();

    const firstToken = claimQueuedJobDelivery(1, "source:queued");
    expect(firstToken).toMatch(/^[a-f0-9]{32}$/);
    expect(claimQueuedJobDelivery(1, "source:queued")).toBeNull();
    expect(releaseQueuedJobDeliveryClaim(1, "source:queued", firstToken)).toBe(true);
    const retryToken = claimQueuedJobDelivery(1, "source:queued");
    const claims = [{ jobKey: "source:queued", claimToken: retryToken }];
    expect(beginQueuedJobDeliverySend(1, claims)).toBe(true);
    expect(finishQueuedJobDeliverySend(1, claims, "sent")).toBe(true);
    expect(claimQueuedJobDelivery(1, "source:queued")).toBeNull();
  });

  it("atomically closes the queued ledger on a known pre-send terminal outcome", () => {
    const db = makeDb();
    const directToken = claimJobDelivery(1, "source:pre-send-terminal");
    expect(finishJobDeliveryClaim(1, "source:pre-send-terminal", directToken, "queued")).toBe(true);
    flushDmLogSync();
    const digestToken = claimQueuedJobDelivery(1, "source:pre-send-terminal");

    expect(finishQueuedJobDeliveryClaim(
      1,
      "source:pre-send-terminal",
      digestToken,
      "dm_closed"
    )).toBe(true);
    expect(db.prepare(`
      SELECT dc.status AS claim_status, dl.status AS ledger_status
        FROM delivery_claims dc
        JOIN dm_log dl ON dl.user_id = dc.user_id AND dl.job_key = dc.job_key
       WHERE dc.user_id = 1 AND dc.job_key = 'source:pre-send-terminal'
    `).get()).toEqual({ claim_status: "dm_closed", ledger_status: "dm_closed" });
    expect(claimQueuedJobDelivery(1, "source:pre-send-terminal")).toBeNull();
  });

  it("recovers pre-send leases but never retries an expired sending phase", () => {
    const db = makeDb();
    const expiredDirectToken = claimJobDelivery(1, "source:expired-direct");
    const queuedDirectToken = claimJobDelivery(1, "source:expired-queue");
    expect(finishJobDeliveryClaim(1, "source:expired-queue", queuedDirectToken, "queued")).toBe(true);
    flushDmLogSync();
    const expiredQueueToken = claimQueuedJobDelivery(1, "source:expired-queue");

    const sendingToken = claimJobDelivery(1, "source:ambiguous-direct");
    expect(beginJobDeliverySend(1, "source:ambiguous-direct", sendingToken)).toBe(true);
    const digestDirectToken = claimJobDelivery(1, "source:ambiguous-digest");
    expect(finishJobDeliveryClaim(1, "source:ambiguous-digest", digestDirectToken, "queued")).toBe(true);
    flushDmLogSync();
    const digestToken = claimQueuedJobDelivery(1, "source:ambiguous-digest");
    const digestClaims = [{ jobKey: "source:ambiguous-digest", claimToken: digestToken }];
    expect(beginQueuedJobDeliverySend(1, digestClaims)).toBe(true);

    db.prepare("UPDATE delivery_claims SET lease_until = '2000-01-01' WHERE status IN ('claimed', 'digest_claimed', 'sending', 'digest_sending')").run();
    expect(recoverExpiredDeliveryClaims()).toEqual({ direct: 1, queued: 1 });
    expect(expiredDirectToken).toBeTruthy();
    expect(expiredQueueToken).toBeTruthy();
    expect(claimJobDelivery(1, "source:expired-direct")).toMatch(/^[a-f0-9]{32}$/);
    expect(claimQueuedJobDelivery(1, "source:expired-queue")).toMatch(/^[a-f0-9]{32}$/);

    expect(claimJobDelivery(1, "source:ambiguous-direct")).toBeNull();
    expect(claimQueuedJobDelivery(1, "source:ambiguous-digest")).toBeNull();
    const delivered = getMuDeliveredJobKeys(1);
    expect(delivered.has("source:ambiguous-direct")).toBe(true);
    expect(delivered.has("source:ambiguous-digest")).toBe(true);
    expect(db.prepare("SELECT job_key, status FROM delivery_claims WHERE status = 'uncertain' ORDER BY job_key").all())
      .toEqual([
        { job_key: "source:ambiguous-digest", status: "uncertain" },
        { job_key: "source:ambiguous-direct", status: "uncertain" },
      ]);

    // An owner can later reconcile a confirmed Discord message with the same
    // token without leaving a phantom uncertain ledger row behind.
    expect(finishJobDeliverySend(1, "source:ambiguous-direct", sendingToken, "sent")).toBe(true);
    expect(finishQueuedJobDeliverySend(1, digestClaims, "sent")).toBe(true);
    expect(db.prepare(`
      SELECT job_key, status FROM dm_log
       WHERE job_key IN ('source:ambiguous-direct', 'source:ambiguous-digest')
       ORDER BY job_key
    `).all()).toEqual([
      { job_key: "source:ambiguous-digest", status: "sent" },
      { job_key: "source:ambiguous-direct", status: "sent" },
    ]);
  });

  it("prevents a stale worker generation from mutating a replacement owner", () => {
    const db = makeDb();

    const directA = claimJobDelivery(1, "source:direct-race");
    db.prepare("UPDATE delivery_claims SET lease_until = '2000-01-01' WHERE job_key = ?")
      .run("source:direct-race");
    const directB = claimJobDelivery(1, "source:direct-race");
    expect(directB).not.toBe(directA);
    expect(beginJobDeliverySend(1, "source:direct-race", directB)).toBe(true);
    expect(beginJobDeliverySend(1, "source:direct-race", directA)).toBe(false);
    expect(releaseJobDeliveryClaim(1, "source:direct-race", directA)).toBe(false);
    expect(finishJobDeliverySend(1, "source:direct-race", directA, "failed")).toBe(false);
    expect(db.prepare("SELECT status, claim_token FROM delivery_claims WHERE job_key = ?").get("source:direct-race"))
      .toEqual({ status: "sending", claim_token: directB });
    expect(finishJobDeliverySend(1, "source:direct-race", directB, "sent")).toBe(true);

    const queueDirect = claimJobDelivery(1, "source:digest-race");
    expect(finishJobDeliveryClaim(1, "source:digest-race", queueDirect, "queued")).toBe(true);
    flushDmLogSync();
    const digestA = claimQueuedJobDelivery(1, "source:digest-race");
    db.prepare("UPDATE delivery_claims SET lease_until = '2000-01-01' WHERE job_key = ?")
      .run("source:digest-race");
    const digestB = claimQueuedJobDelivery(1, "source:digest-race");
    const claimA = [{ jobKey: "source:digest-race", claimToken: digestA }];
    const claimB = [{ jobKey: "source:digest-race", claimToken: digestB }];
    expect(beginQueuedJobDeliverySend(1, claimB)).toBe(true);
    expect(beginQueuedJobDeliverySend(1, claimA)).toBe(false);
    expect(releaseQueuedJobDeliveryClaim(1, "source:digest-race", digestA)).toBe(false);
    expect(finishQueuedJobDeliverySend(1, claimA, "queued")).toBe(false);
    expect(db.prepare("SELECT status, claim_token FROM delivery_claims WHERE job_key = ?").get("source:digest-race"))
      .toEqual({ status: "digest_sending", claim_token: digestB });
    expect(finishQueuedJobDeliverySend(1, claimB, "sent")).toBe(true);
  });

  it("resolves an in-flight legacy key after the collector remaps it", () => {
    const db = makeDb();
    db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES ('legacy-key', 'source', 'Source', 'job-1', 'Engineer', '2026-01-01', '2026-01-01')
    `).run();
    const claimToken = claimJobDelivery(1, "legacy-key");

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Engineer II",
    }], "2026-01-02");

    // Simulates a worker that loaded legacy-key before the remap transaction:
    // its token still owns the canonical row after the alias is committed.
    expect(beginJobDeliverySend(1, "legacy-key", claimToken)).toBe(true);
    expect(finishJobDeliverySend(1, "legacy-key", claimToken, "sent")).toBe(true);
    flushDmLogSync();

    expect(db.prepare("SELECT status FROM delivery_claims WHERE user_id = 1 AND job_key = 'canonical-key'").get().status)
      .toBe("sent");
    expect(db.prepare("SELECT 1 FROM delivery_claims WHERE job_key = 'legacy-key'").get()).toBeUndefined();
    expect(db.prepare("SELECT DISTINCT job_key FROM dm_log").all()).toEqual([{ job_key: "canonical-key" }]);
  });

  it("canonicalizes a delivery buffered before the collector remaps its key", () => {
    const db = makeDb();
    db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES ('legacy-key', 'source', 'Source', 'job-1', 'Engineer', '2026-01-01', '2026-01-01')
    `).run();
    const claimToken = claimJobDelivery(1, "legacy-key");
    // Capture the old key in the write-behind buffer first.
    expect(finishJobDeliveryClaim(1, "legacy-key", claimToken, "queued")).toBe(true);

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Engineer II",
    }], "2026-01-02");
    flushDmLogSync();

    expect(db.prepare("SELECT DISTINCT job_key FROM dm_log").all()).toEqual([{ job_key: "canonical-key" }]);
    expect(db.prepare("SELECT DISTINCT job_key FROM user_seen_jobs").all()).toEqual([{ job_key: "canonical-key" }]);
    expect(db.prepare("SELECT job_key, status FROM delivery_claims").all()).toEqual([
      { job_key: "canonical-key", status: "queued" },
    ]);
    expect(claimQueuedJobDelivery(1, "canonical-key")).toMatch(/^[a-f0-9]{32}$/);
  });

  it("resolves button hashes embedded before a legacy key was remapped", () => {
    const db = makeDb();
    db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES ('legacy-key', 'source', 'Source', 'job-1', 'Engineer', '2026-01-01', '2026-01-01')
    `).run();
    db.prepare(`
      INSERT INTO user_seen_jobs (user_id, job_key, status, notified_at)
      VALUES (1, 'legacy-key', 'notified', '2026-01-01')
    `).run();
    const legacyButtonHash = jobButtonHash("legacy-key");

    upsertJobs([{
      key: "canonical-key",
      sourceKey: "source",
      sourceLabel: "Source",
      id: "job-1",
      title: "Engineer II",
    }], "2026-01-02");

    expect(findJobKeyByHash(legacyButtonHash, 1)).toBe("canonical-key");
    expect(db.prepare("SELECT job_key FROM user_seen_jobs WHERE user_id = 1").all()).toEqual([
      { job_key: "canonical-key" },
    ]);
  });
});
