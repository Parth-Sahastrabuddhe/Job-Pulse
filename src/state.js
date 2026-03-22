import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { sameLogicalJob } from "./sources/shared.js";

let db = null;

export function initDb(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_jobs (
      key TEXT PRIMARY KEY,
      source_key TEXT NOT NULL,
      source_label TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT DEFAULT '',
      url TEXT DEFAULT '',
      posted_text TEXT DEFAULT '',
      posted_at TEXT DEFAULT '',
      posted_precision TEXT DEFAULT '',
      country_code TEXT DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_seen_source ON seen_jobs(source_key, id);

    CREATE TABLE IF NOT EXISTS job_posts (
      job_key TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      thread_id TEXT,
      channel_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS company_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      notes TEXT DEFAULT ''
    );
  `);

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function getDb() {
  return db;
}

export function migrateFromJson(jsonFile) {
  if (!fs.existsSync(jsonFile)) return false;

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    return false;
  }

  if (!raw?.seenJobs || typeof raw.seenJobs !== "object") return false;

  const count = Object.keys(raw.seenJobs).length;
  if (count === 0) return false;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO seen_jobs
      (key, source_key, source_label, id, title, location, url,
       posted_text, posted_at, posted_precision, country_code,
       first_seen_at, last_seen_at)
    VALUES
      (@key, @sourceKey, @sourceLabel, @id, @title, @location, @url,
       @postedText, @postedAt, @postedPrecision, @countryCode,
       @firstSeenAt, @lastSeenAt)
  `);

  const migrate = db.transaction(() => {
    for (const [key, job] of Object.entries(raw.seenJobs)) {
      insert.run({
        key,
        sourceKey: job.sourceKey || "",
        sourceLabel: job.sourceLabel || "",
        id: String(job.id || ""),
        title: job.title || "",
        location: job.location || "",
        url: job.url || "",
        postedText: job.postedText || "",
        postedAt: job.postedAt || "",
        postedPrecision: job.postedPrecision || "",
        countryCode: job.countryCode || "",
        firstSeenAt: job.firstSeenAt || new Date().toISOString(),
        lastSeenAt: job.lastSeenAt || new Date().toISOString()
      });
    }

    if (raw.lastRunAt) {
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastRunAt', ?)").run(raw.lastRunAt);
    }
  });

  migrate();

  const migratedPath = `${jsonFile}.migrated`;
  fs.renameSync(jsonFile, migratedPath);
  console.log(`[state] Migrated ${count} jobs from state.json → SQLite. Old file renamed to ${migratedPath}`);
  return true;
}

export function hasSeenJobs() {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM seen_jobs").get();
  return row.cnt > 0;
}

export function getNewJobs(jobs) {
  const allSeen = db.prepare("SELECT * FROM seen_jobs").all();
  const seenMap = new Map(allSeen.map((r) => [r.key, r]));

  return jobs.filter((job) => {
    if (seenMap.has(job.key)) return false;
    for (const seen of allSeen) {
      if (sameLogicalJob(rowToJob(seen), job)) return false;
    }
    return true;
  });
}

export function upsertJobs(jobs, seenAt) {
  const allSeen = db.prepare("SELECT * FROM seen_jobs").all();

  const upsert = db.prepare(`
    INSERT INTO seen_jobs
      (key, source_key, source_label, id, title, location, url,
       posted_text, posted_at, posted_precision, country_code,
       first_seen_at, last_seen_at)
    VALUES
      (@key, @sourceKey, @sourceLabel, @id, @title, @location, @url,
       @postedText, @postedAt, @postedPrecision, @countryCode,
       @firstSeenAt, @lastSeenAt)
    ON CONFLICT(key) DO UPDATE SET
      last_seen_at = @lastSeenAt
  `);

  const deleteStmt = db.prepare("DELETE FROM seen_jobs WHERE key = ?");

  const run = db.transaction(() => {
    for (const job of jobs) {
      // Check if this job exists under a different key (sameLogicalJob match)
      let existingFirstSeen = null;
      for (const seen of allSeen) {
        if (seen.key !== job.key && sameLogicalJob(rowToJob(seen), job)) {
          existingFirstSeen = seen.first_seen_at;
          deleteStmt.run(seen.key);
          break;
        }
      }

      // Check if already exists under same key
      if (!existingFirstSeen) {
        const existing = allSeen.find((s) => s.key === job.key);
        if (existing) existingFirstSeen = existing.first_seen_at;
      }

      upsert.run({
        key: job.key,
        sourceKey: job.sourceKey || "",
        sourceLabel: job.sourceLabel || "",
        id: String(job.id || ""),
        title: job.title || "",
        location: job.location || "",
        url: job.url || "",
        postedText: job.postedText || "",
        postedAt: job.postedAt || "",
        postedPrecision: job.postedPrecision || "",
        countryCode: job.countryCode || "",
        firstSeenAt: existingFirstSeen || seenAt,
        lastSeenAt: seenAt
      });
    }

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastRunAt', ?)").run(seenAt);
  });

  run();
}

export function pruneState(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM seen_jobs WHERE last_seen_at < ?").run(cutoff);
}

// job_posts CRUD
export function upsertJobPost(jobKey, messageId, threadId, channelId) {
  db.prepare(`
    INSERT OR REPLACE INTO job_posts (job_key, message_id, thread_id, channel_id, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(jobKey, messageId, threadId, channelId);
}

export function getJobPost(jobKey) {
  return db.prepare("SELECT * FROM job_posts WHERE job_key = ?").get(jobKey);
}

export function updateJobPostStatus(jobKey, status) {
  db.prepare("UPDATE job_posts SET status = ? WHERE job_key = ?").run(status, jobKey);
}

// company_queue CRUD
export function addToCompanyQueue(companyName) {
  db.prepare(`
    INSERT INTO company_queue (company_name, requested_at)
    VALUES (?, ?)
  `).run(companyName, new Date().toISOString());
}

export function getPendingCompanies() {
  return db.prepare("SELECT * FROM company_queue WHERE status = 'pending' ORDER BY requested_at").all();
}

export function updateCompanyQueueStatus(id, status, notes) {
  db.prepare("UPDATE company_queue SET status = ?, notes = ? WHERE id = ?").run(status, notes || "", id);
}

function rowToJob(row) {
  return {
    key: row.key,
    sourceKey: row.source_key,
    sourceLabel: row.source_label,
    id: row.id,
    title: row.title,
    location: row.location,
    url: row.url,
    postedText: row.posted_text,
    postedAt: row.posted_at,
    postedPrecision: row.posted_precision,
    countryCode: row.country_code
  };
}
