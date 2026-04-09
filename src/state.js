import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db = null;
let _hasSeenJobsCached = false;

export function initDb(dbFile) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
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
    CREATE INDEX IF NOT EXISTS idx_seen_first_seen ON seen_jobs(first_seen_at);

    CREATE TABLE IF NOT EXISTS job_posts (
      job_key TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      thread_id TEXT,
      channel_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending'
    );

    CREATE INDEX IF NOT EXISTS idx_job_posts_message_id ON job_posts(message_id);

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

  // --- Multi-user schema migrations ---
  const seenJobsCols = db.pragma("table_info(seen_jobs)").map((c) => c.name);
  if (!seenJobsCols.includes("seniority_level")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN seniority_level TEXT DEFAULT 'mid'");
  }
  if (!seenJobsCols.includes("role_categories")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN role_categories TEXT DEFAULT '[]'");
  }
  if (!seenJobsCols.includes("archetype")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN archetype TEXT DEFAULT NULL");
  }
  if (!seenJobsCols.includes("fit_score")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN fit_score INTEGER DEFAULT NULL");
  }
  if (!seenJobsCols.includes("fit_scores_json")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN fit_scores_json TEXT DEFAULT NULL");
  }

  // Add password_hash column to user_profiles (idempotent)
  const userCols = db.pragma("table_info(user_profiles)").map((c) => c.name);
  if (userCols.length > 0 && !userCols.includes("password_hash")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN password_hash TEXT DEFAULT NULL");
  }

  // Add applied_at column to user_seen_jobs (idempotent)
  const usjCols = db.pragma("table_info(user_seen_jobs)").map((c) => c.name);
  if (usjCols.length > 0 && !usjCols.includes("applied_at")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN applied_at TEXT DEFAULT NULL");
  }

  // Add saved_at column to user_seen_jobs (idempotent)
  if (usjCols.length > 0 && !usjCols.includes("saved_at")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN saved_at TEXT DEFAULT NULL");
  }

  // Add save_reminder_sent column to user_seen_jobs (idempotent)
  if (usjCols.length > 0 && !usjCols.includes("save_reminder_sent")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN save_reminder_sent BOOLEAN DEFAULT 0");
  }

  // --- Multi-user tables ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      discord_username TEXT NOT NULL,
      first_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      email_verified BOOLEAN DEFAULT 0,
      role_categories TEXT NOT NULL DEFAULT '["software_engineer"]',
      seniority_levels TEXT NOT NULL DEFAULT '["entry","mid"]',
      company_selections TEXT DEFAULT '["all"]',
      country TEXT DEFAULT 'US',
      requires_sponsorship BOOLEAN DEFAULT 0,
      notification_mode TEXT DEFAULT 'realtime',
      quiet_hours_start TEXT DEFAULT NULL,
      quiet_hours_end TEXT DEFAULT NULL,
      quiet_hours_tz TEXT DEFAULT 'America/New_York',
      is_active BOOLEAN DEFAULT 1,
      role TEXT DEFAULT 'user',
      password_hash TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_seen_jobs (
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      status TEXT DEFAULT 'notified',
      notified_at TEXT NOT NULL,
      applied_at TEXT,
      updated_at TEXT,
      PRIMARY KEY (user_id, job_key),
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS h1b_sponsors (
      company_key TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      sponsors_h1b BOOLEAN DEFAULT 1,
      lca_count INTEGER DEFAULT 0,
      avg_salary INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used BOOLEAN DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dm_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      status TEXT DEFAULT 'sent',
      sent_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_key TEXT,
      error_message TEXT,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company_name TEXT NOT NULL,
      careers_url TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      admin_response TEXT DEFAULT '',
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      admin_response TEXT DEFAULT '',
      submitted_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES user_profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_seen_jobs_user ON user_seen_jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_dm_log_user ON dm_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

    CREATE TABLE IF NOT EXISTS company_research (
      company_key TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      research_json TEXT NOT NULL,
      researched_at TEXT NOT NULL
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
       seniority_level, role_categories,
       first_seen_at, last_seen_at)
    VALUES
      (@key, @sourceKey, @sourceLabel, @id, @title, @location, @url,
       @postedText, @postedAt, @postedPrecision, @countryCode,
       @seniorityLevel, @roleCategories,
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
        seniorityLevel: "mid",
        roleCategories: "[]",
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
  if (_hasSeenJobsCached) return true;
  const row = db.prepare("SELECT COUNT(*) as cnt FROM seen_jobs").get();
  if (row.cnt > 0) {
    _hasSeenJobsCached = true;
    return true;
  }
  return false;
}

// SQL-indexed dedup — O(1) per job instead of O(n)
const _stmtByKey = () => db.prepare("SELECT 1 FROM seen_jobs WHERE key = ?");
const _stmtBySourceId = () => db.prepare("SELECT 1 FROM seen_jobs WHERE source_key = ? AND id = ?");

export function getNewJobs(jobs) {
  const byKey = _stmtByKey();
  const bySourceId = _stmtBySourceId();

  return jobs.filter((job) => {
    // Primary check: exact key match (indexed)
    if (byKey.get(job.key)) return false;
    // Fallback: same source + same ID but different key hash
    if (bySourceId.get(job.sourceKey, String(job.id))) return false;
    return true;
  });
}

// Per-process dedup: check job_posts (personal bot's notification ledger)
// instead of seen_jobs, so two processes sharing the DB don't race.
const _stmtByKeyPost = () => db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?");

export function getUnnotifiedJobs(jobs) {
  const byKey = _stmtByKeyPost();
  return jobs.filter((job) => !byKey.get(job.key));
}

// SQL-indexed upsert — no full table scan
const _stmtGetFirstSeen = () => db.prepare("SELECT first_seen_at FROM seen_jobs WHERE key = ?");
const _stmtGetBySourceId = () => db.prepare("SELECT key, first_seen_at FROM seen_jobs WHERE source_key = ? AND id = ? AND key != ?");

export function upsertJobs(jobs, seenAt) {
  _hasSeenJobsCached = true;
  const getFirstSeen = _stmtGetFirstSeen();
  const getBySourceId = _stmtGetBySourceId();
  const deleteStmt = db.prepare("DELETE FROM seen_jobs WHERE key = ?");

  const upsert = db.prepare(`
    INSERT INTO seen_jobs
      (key, source_key, source_label, id, title, location, url,
       posted_text, posted_at, posted_precision, country_code,
       seniority_level, role_categories, archetype,
       first_seen_at, last_seen_at)
    VALUES
      (@key, @sourceKey, @sourceLabel, @id, @title, @location, @url,
       @postedText, @postedAt, @postedPrecision, @countryCode,
       @seniorityLevel, @roleCategories, @archetype,
       @firstSeenAt, @lastSeenAt)
    ON CONFLICT(key) DO UPDATE SET
      last_seen_at = @lastSeenAt,
      archetype = COALESCE(seen_jobs.archetype, excluded.archetype)
  `);

  const run = db.transaction(() => {
    for (const job of jobs) {
      let existingFirstSeen = null;

      // Check if same source+id exists under a different key (re-keyed job)
      const altRow = getBySourceId.get(job.sourceKey, String(job.id), job.key);
      if (altRow) {
        existingFirstSeen = altRow.first_seen_at;
        deleteStmt.run(altRow.key);
      }

      // Check if exists under same key
      if (!existingFirstSeen) {
        const sameRow = getFirstSeen.get(job.key);
        if (sameRow) existingFirstSeen = sameRow.first_seen_at;
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
        seniorityLevel: job.seniorityLevel || "mid",
        roleCategories: JSON.stringify(job.roleCategories || []),
        archetype: job.archetype || null,
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

  // Prune old cached job data directories
  const jobsDir = path.join(path.dirname(db.name), "jobs");
  if (fs.existsSync(jobsDir)) {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    try {
      for (const entry of fs.readdirSync(jobsDir)) {
        const dirPath = path.join(jobsDir, entry);
        try {
          const stat = fs.statSync(dirPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoffMs) {
            fs.rmSync(dirPath, { recursive: true, force: true });
          }
        } catch {}
      }
    } catch {}
  }
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

export function expireSavedJobPosts() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    "UPDATE job_posts SET status = 'skipped' WHERE status = 'saved' AND job_key IN (SELECT key FROM seen_jobs WHERE last_seen_at <= ?)"
  ).run(cutoff).changes;
}

// Bridge personal bot actions → web dashboard (user_seen_jobs) for admin user
const ADMIN_DISCORD_ID = "1038422401874145372";

export function bridgeToTracker(jobKey, status) {
  try {
    const user = db.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(ADMIN_DISCORD_ID);
    if (!user) return;
    const now = new Date().toISOString();
    const appliedAt = status === "applied" ? now : null;
    const savedAt = status === "saved" ? now : null;
    db.prepare(`
      INSERT INTO user_seen_jobs (user_id, job_key, status, notified_at, applied_at, saved_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, job_key) DO UPDATE SET status = excluded.status,
        applied_at = COALESCE(user_seen_jobs.applied_at, excluded.applied_at),
        saved_at = CASE WHEN excluded.status = 'saved' THEN excluded.saved_at ELSE user_seen_jobs.saved_at END,
        save_reminder_sent = CASE WHEN excluded.status = 'saved' THEN 0 ELSE user_seen_jobs.save_reminder_sent END,
        updated_at = excluded.updated_at
    `).run(user.id, jobKey, status, now, appliedAt, savedAt, now);
  } catch {}
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

// Cleanup expired OTP codes
export function cleanupExpiredOtps() {
  if (!db) return;
  db.prepare("DELETE FROM otp_codes WHERE expires_at < ?").run(new Date().toISOString());
}

// --- Funnel analytics ---
export function getFunnelStats(periodDays = null) {
  const cutoff = periodDays
    ? new Date(Date.now() - periodDays * 86400000).toISOString()
    : null;

  const discovered = cutoff
    ? db.prepare("SELECT COUNT(*) as cnt FROM seen_jobs WHERE first_seen_at >= ?").get(cutoff).cnt
    : db.prepare("SELECT COUNT(*) as cnt FROM seen_jobs").get().cnt;

  const statusRows = cutoff
    ? db.prepare(`
        SELECT jp.status, COUNT(*) as cnt FROM job_posts jp
        JOIN seen_jobs sj ON sj.key = jp.job_key
        WHERE sj.first_seen_at >= ?
        GROUP BY jp.status
      `).all(cutoff)
    : db.prepare("SELECT status, COUNT(*) as cnt FROM job_posts GROUP BY status").all();

  const byStatus = {};
  let notified = 0;
  for (const row of statusRows) {
    byStatus[row.status] = row.cnt;
    notified += row.cnt;
  }

  return {
    discovered,
    notified,
    pending: byStatus.pending || 0,
    fitchecked: byStatus.fitchecked || 0,
    saved: byStatus.saved || 0,
    applied: byStatus.applied || 0,
    skipped: byStatus.skipped || 0,
  };
}

// --- Fit score CRUD ---
export function updateJobFitScore(jobKey, score, scoresJson) {
  db.prepare("UPDATE seen_jobs SET fit_score = ?, fit_scores_json = ? WHERE key = ?")
    .run(score, scoresJson, jobKey);
}

export function getJobFitScore(jobKey) {
  return db.prepare("SELECT fit_score, fit_scores_json FROM seen_jobs WHERE key = ?").get(jobKey);
}

// --- Company research cache ---
export function getCachedResearch(companyKey) {
  const row = db.prepare("SELECT * FROM company_research WHERE company_key = ?").get(companyKey);
  if (!row) return null;
  const age = Date.now() - new Date(row.researched_at).getTime();
  if (age > 7 * 86400000) return null;
  return JSON.parse(row.research_json);
}

export function cacheResearch(companyKey, companyName, researchData) {
  db.prepare(`
    INSERT OR REPLACE INTO company_research (company_key, company_name, research_json, researched_at)
    VALUES (?, ?, ?, ?)
  `).run(companyKey, companyName, JSON.stringify(researchData), new Date().toISOString());
}
