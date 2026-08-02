import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb, pruneState } from "../src/state.js";
import {
  createOtp,
  createUserProfile,
  deleteUserProfile,
  verifyOtp,
} from "../src/multi-user-state.js";

const tempDirs = [];

function newPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-hardening-"));
  tempDirs.push(root);
  return { root, dbFile: path.join(root, "private-data", "jobs.db") };
}

afterEach(() => {
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("state hardening migrations", () => {
  it("does not create removed address or automatic-company queue tables", () => {
    const { dbFile } = newPath();
    const db = initDb(dbFile);
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    expect(names.has("user_addresses")).toBe(false);
    expect(names.has("company_queue")).toBe(false);
  });

  it("leaves legacy removed-feature tables inert instead of dropping user data", () => {
    const { dbFile } = newPath();
    let db = initDb(dbFile);
    db.exec("CREATE TABLE user_addresses (id INTEGER PRIMARY KEY, value TEXT); CREATE TABLE company_queue (id INTEGER PRIMARY KEY, value TEXT);");
    db.prepare("INSERT INTO user_addresses VALUES (1, 'keep')").run();
    db.prepare("INSERT INTO company_queue VALUES (1, 'keep')").run();
    closeDb();

    db = initDb(dbFile);
    expect(db.prepare("SELECT value FROM user_addresses WHERE id = 1").get().value).toBe("keep");
    expect(db.prepare("SELECT value FROM company_queue WHERE id = 1").get().value).toBe("keep");
  });

  it("creates the database and directory with owner-only permissions", () => {
    const { root, dbFile } = newPath();
    initDb(dbFile);
    expect(fs.statSync(path.dirname(dbFile)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(dbFile).mode & 0o777).toBe(0o600);
    expect(fs.statSync(root).isDirectory()).toBe(true);
  });

  it("never changes permissions on a pre-existing DB parent directory", () => {
    const { root } = newPath();
    fs.chmodSync(root, 0o755);
    const dbFile = path.join(root, "jobs.db");

    initDb(dbFile);

    expect(fs.statSync(root).mode & 0o777).toBe(0o755);
    expect(fs.statSync(dbFile).mode & 0o777).toBe(0o600);
  });

  it("refuses a SQLite path that is a symbolic link", () => {
    const { root, dbFile } = newPath();
    fs.mkdirSync(path.dirname(dbFile));
    const victim = path.join(root, "owner-file.txt");
    fs.writeFileSync(victim, "keep me", { mode: 0o644 });
    fs.symlinkSync(victim, dbFile);

    expect(() => initDb(dbFile)).toThrow();
    expect(fs.readFileSync(victim, "utf8")).toBe("keep me");
    expect(fs.statSync(victim).mode & 0o777).toBe(0o644);
  });

  it("prunes old terminal claims but preserves queued work and active leases", () => {
    const { dbFile } = newPath();
    const db = initDb(dbFile);
    db.prepare(`
      INSERT INTO user_profiles
        (id, discord_id, discord_username, first_name, email, created_at, updated_at)
      VALUES (1, 'claims', 'claims', 'Claims', 'claims@example.com', '2020-01-01', '2020-01-01')
    `).run();
    const insertJob = db.prepare(`
      INSERT INTO seen_jobs
        (key, source_key, source_label, id, title, first_seen_at, last_seen_at)
      VALUES (?, 'source', 'Source', ?, 'Engineer', '2020-01-01', '2020-01-01')
    `);
    const insertClaim = db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claimed_at, lease_until, updated_at)
      VALUES (1, ?, ?, '2020-01-01', ?, '2020-01-01')
    `);
    for (const [key, status] of [["sent", "sent"], ["failed", "failed"], ["queued", "queued"], ["active", "claimed"]]) {
      insertJob.run(key, key);
      insertClaim.run(key, status, status === "claimed" ? "2999-01-01" : null);
    }
    db.prepare("INSERT INTO dm_log (user_id, job_key, status, sent_at) VALUES (1, 'queued', 'queued', '2020-01-01')").run();

    pruneState(30);

    expect(db.prepare("SELECT job_key, status FROM delivery_claims ORDER BY job_key").all()).toEqual([
      { job_key: "active", status: "claimed" },
      { job_key: "queued", status: "queued" },
    ]);
    expect(db.prepare("SELECT key FROM seen_jobs ORDER BY key").all()).toEqual([
      { key: "active" },
      { key: "queued" },
    ]);
    expect(db.prepare("SELECT status FROM dm_log WHERE job_key = 'queued'").get().status).toBe("queued");
  });
});

describe("OTP and account deletion", () => {
  it("atomically invalidates older OTPs and consumes the replacement once", () => {
    const { dbFile } = newPath();
    initDb(dbFile);
    createOtp("user@example.com", "111111");
    createOtp("user@example.com", "222222");

    expect(verifyOtp("user@example.com", "111111")).toBe(false);
    expect(verifyOtp("user@example.com", "222222")).toBe(true);
    expect(verifyOtp("user@example.com", "222222")).toBe(false);
  });

  it("deletes every private child row, including legacy address rows", () => {
    const { dbFile } = newPath();
    const db = initDb(dbFile);
    const userId = Number(createUserProfile({
      discordId: "delete-me",
      discordUsername: "delete-me",
      firstName: "Delete",
      email: "delete@example.com",
    }));
    db.exec(`CREATE TABLE user_addresses (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      value TEXT,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    )`);
    db.prepare("INSERT INTO user_addresses (user_id, value) VALUES (?, 'legacy')").run(userId);
    db.prepare("INSERT INTO support_tickets (user_id, category, description, submitted_at) VALUES (?, 'x', 'x', '2026-01-01')").run(userId);
    db.prepare("INSERT INTO company_suggestions (user_id, company_name, submitted_at) VALUES (?, 'x', '2026-01-01')").run(userId);
    db.prepare("INSERT INTO user_seen_jobs (user_id, job_key, notified_at) VALUES (?, 'job', '2026-01-01')").run(userId);
    db.prepare("INSERT INTO dm_log (user_id, job_key, sent_at) VALUES (?, 'job', '2026-01-01')").run(userId);
    db.prepare("INSERT INTO delivery_claims (user_id, job_key, status, claimed_at, updated_at) VALUES (?, 'job', 'sent', '2026-01-01', '2026-01-01')").run(userId);
    createOtp("delete@example.com", "123456");

    expect(() => deleteUserProfile("delete-me")).not.toThrow();
    for (const table of ["user_profiles", "support_tickets", "company_suggestions", "user_seen_jobs", "dm_log", "delivery_claims", "user_addresses", "otp_codes"]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(0);
    }
  });
});
