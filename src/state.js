import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hardenSqliteFilePermissions, preparePrivateDbFile } from "./db-path.js";
import { finalizeJob } from "./sources/shared.js";

let db = null;
let _hasSeenJobsCached = false;

const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 2000;

function sqliteBusyTimeoutMs() {
  const parsed = Number.parseInt(String(process.env.SQLITE_BUSY_TIMEOUT_MS ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
}

function envPositiveInt(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isSqliteBusy(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  return code.startsWith("SQLITE_BUSY") || /database is locked|SQLITE_BUSY/i.test(msg);
}

export function withBusyRetry(fn, { retries = 2, baseDelayMs = 200 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isSqliteBusy(err) || attempt >= retries) throw err;
      const jitter = Math.floor(Math.random() * 100);
      sleepSync(baseDelayMs * Math.pow(2, attempt) + jitter);
    }
  }
}

// --- In-memory seen_jobs cache ---
// Eliminates 1-3 SELECTs per job inside the upsertJobs chunk transaction.
// Cross-process safety: the TTL reload makes writes from another collector
// process visible without turning every job comparison into a database read.

// Tracks only the fields used for dedup + existingJobNeedsUpsert comparison.
// Excluded by design: fit_score, fit_scores_json, legitimacy_tier,
// legitimacy_signals_json (written by updateJobFitScore / updateJobLegitimacy,
// never read from cache — callers query the DB directly).
const SEEN_JOBS_CACHE_FIELDS =
  "key, source_key, source_label, id, title, location, url, posted_text, posted_at, posted_precision, country_code, " +
  "seniority_level, role_categories, archetype, first_seen_at, last_seen_at";

let _seenJobsCache = null;
let _seenJobsUrlIndex = null;
let _seenJobsSourceIdIndex = null;
let _seenJobsCacheLoadedAt = 0;

function seenJobsCacheTtlMs() {
  return envPositiveInt("SEEN_JOBS_CACHE_TTL_MINUTES", 30) * 60 * 1000;
}

function sourceIdCacheKey(sourceKey, id) {
  return `${sourceKey}\u0000${id}`;
}

function loadSeenJobsCache() {
  _seenJobsCache = new Map();
  _seenJobsUrlIndex = new Map();
  _seenJobsSourceIdIndex = new Map();
  const rows = db.prepare(`SELECT ${SEEN_JOBS_CACHE_FIELDS} FROM seen_jobs`).all();
  for (const row of rows) {
    _seenJobsCache.set(row.key, row);
    if (row.url) _seenJobsUrlIndex.set(row.url, row.key);
    if (row.source_key && String(row.id || "").trim()) {
      _seenJobsSourceIdIndex.set(sourceIdCacheKey(row.source_key, String(row.id)), row.key);
    }
  }
  _seenJobsCacheLoadedAt = Date.now();
}

function ensureSeenJobsCache() {
  const ttl = seenJobsCacheTtlMs();
  if (_seenJobsCache && (Date.now() - _seenJobsCacheLoadedAt) < ttl) return;
  loadSeenJobsCache();
}

// Read helpers do NOT call ensureSeenJobsCache; callers must call it once at
// entry. This prevents a TTL-driven reload from firing mid-transaction (e.g.
// inside processChunk), which would issue a SELECT * holding a read lock and
// contend with other writers. Both call sites (getNewJobs, upsertJobs) ensure
// the cache is loaded once before any helper invocation.
function cacheGet(key) {
  return _seenJobsCache ? _seenJobsCache.get(key) : undefined;
}

function cacheGetByUrl(url) {
  return _seenJobsUrlIndex ? _seenJobsUrlIndex.get(url) : undefined;
}

function cacheGetBySourceId(sourceKey, id) {
  if (!String(sourceKey || "").trim() || !String(id || "").trim()) return undefined;
  return _seenJobsSourceIdIndex
    ? _seenJobsSourceIdIndex.get(sourceIdCacheKey(sourceKey, String(id)))
    : undefined;
}

function cacheSetFromValues(values) {
  if (!_seenJobsCache) return;
  const previous = _seenJobsCache.get(values.key);
  if (previous) {
    if (previous.url && previous.url !== values.url) _seenJobsUrlIndex.delete(previous.url);
    if (previous.source_key !== values.sourceKey || String(previous.id) !== String(values.id)) {
      _seenJobsSourceIdIndex.delete(sourceIdCacheKey(previous.source_key, String(previous.id)));
    }
  }
  const row = {
    key: values.key,
    source_key: values.sourceKey,
    source_label: values.sourceLabel,
    id: String(values.id || ""),
    title: values.title,
    location: values.location,
    url: values.url,
    posted_text: values.postedText,
    posted_at: values.postedAt,
    posted_precision: values.postedPrecision,
    country_code: values.countryCode,
    seniority_level: values.seniorityLevel,
    role_categories: values.roleCategories,
    archetype: values.archetype,
    first_seen_at: values.firstSeenAt,
    last_seen_at: values.lastSeenAt,
  };
  _seenJobsCache.set(values.key, row);
  if (values.url) _seenJobsUrlIndex.set(values.url, values.key);
  if (values.sourceKey && String(values.id || "").trim()) {
    _seenJobsSourceIdIndex.set(sourceIdCacheKey(values.sourceKey, String(values.id)), values.key);
  }
}

function cacheTouchEntry(key, lastSeenAt) {
  if (!_seenJobsCache) return;
  const entry = _seenJobsCache.get(key);
  if (entry) entry.last_seen_at = lastSeenAt;
}

function cacheDelete(key) {
  if (!_seenJobsCache) return;
  const entry = _seenJobsCache.get(key);
  if (!entry) return;
  if (entry.url) _seenJobsUrlIndex.delete(entry.url);
  if (entry.source_key && String(entry.id || "").trim()) {
    _seenJobsSourceIdIndex.delete(sourceIdCacheKey(entry.source_key, String(entry.id)));
  }
  _seenJobsCache.delete(key);
}

export function _invalidateSeenJobsCache() {
  _seenJobsCache = null;
  _seenJobsUrlIndex = null;
  _seenJobsSourceIdIndex = null;
  _seenJobsCacheLoadedAt = 0;
  // Reset the "have we ever seen jobs?" flag too — pruneState can empty the
  // table, and a stale-true flag would skip the DB count check in hasSeenJobs.
  _hasSeenJobsCached = false;
}

export function initDb(dbFile) {
  _invalidateSeenJobsCache();
  if (!dbFile || dbFile === ":memory:") {
    db = new Database(dbFile || ":memory:");
    db.pragma(`busy_timeout = ${sqliteBusyTimeoutMs()}`);
    db.pragma("foreign_keys = ON");
    return initializeSchema();
  }
  preparePrivateDbFile(dbFile);
  db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${sqliteBusyTimeoutMs()}`);
  db.pragma("wal_autocheckpoint = 500");
  db.pragma("foreign_keys = ON");

  return initializeSchema();
}

function initializeSchema() {

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
    CREATE INDEX IF NOT EXISTS idx_seen_last_seen ON seen_jobs(last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_seen_posted_last_seen ON seen_jobs(posted_at, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_seen_url ON seen_jobs(url) WHERE url != '';

    CREATE TABLE IF NOT EXISTS job_posts (
      job_key TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      thread_id TEXT,
      channel_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      delivery_claim_token TEXT,
      delivery_claimed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_job_posts_message_id ON job_posts(message_id);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
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
  if (!seenJobsCols.includes("legitimacy_tier")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN legitimacy_tier TEXT DEFAULT NULL");
  }
  if (!seenJobsCols.includes("legitimacy_signals_json")) {
    db.exec("ALTER TABLE seen_jobs ADD COLUMN legitimacy_signals_json TEXT DEFAULT NULL");
  }

  const jobPostCols = db.pragma("table_info(job_posts)").map((c) => c.name);
  if (!jobPostCols.includes("delivery_claim_token")) {
    db.exec("ALTER TABLE job_posts ADD COLUMN delivery_claim_token TEXT DEFAULT NULL");
  }
  if (!jobPostCols.includes("delivery_claimed_at")) {
    db.exec("ALTER TABLE job_posts ADD COLUMN delivery_claimed_at TEXT DEFAULT NULL");
  }
  // Make any sentinel created by an interrupted pre-release process
  // reconcilable under the ownership-token contract. The timestamp is the
  // migration time when the original claim time was unavailable.
  db.prepare(`
    UPDATE job_posts
       SET delivery_claim_token = lower(hex(randomblob(16)))
     WHERE status = 'delivery_claimed'
       AND (delivery_claim_token IS NULL OR delivery_claim_token = '')
  `).run();
  db.prepare(`
    UPDATE job_posts
       SET delivery_claimed_at = ?
     WHERE status = 'delivery_claimed'
       AND delivery_claimed_at IS NULL
  `).run(new Date().toISOString());
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_job_posts_delivery_claims
      ON job_posts(status, delivery_claimed_at)
     WHERE status = 'delivery_claimed'
  `);

  // Add password_hash column to user_profiles (idempotent)
  const userCols = db.pragma("table_info(user_profiles)").map((c) => c.name);
  if (userCols.length > 0 && !userCols.includes("password_hash")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN password_hash TEXT DEFAULT NULL");
  }

  // Add education_level column to user_profiles (idempotent)
  if (userCols.length > 0 && !userCols.includes("education_level")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN education_level TEXT DEFAULT ''");
  }

  // Add notification_channel_id column to user_profiles (idempotent)
  if (userCols.length > 0 && !userCols.includes("notification_channel_id")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN notification_channel_id TEXT DEFAULT NULL");
  }
  if (userCols.length > 0 && !userCols.includes("session_version")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
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

  // --- Multi-user fit check migrations (idempotent) ---
  if (userCols.length > 0 && !userCols.includes("resume_text")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN resume_text TEXT DEFAULT NULL");
  }
  if (userCols.length > 0 && !userCols.includes("experience_years")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN experience_years REAL DEFAULT NULL");
  }
  if (userCols.length > 0 && !userCols.includes("llm_provider")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN llm_provider TEXT DEFAULT 'gemini'");
  }
  if (userCols.length > 0 && !userCols.includes("llm_key_enc")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN llm_key_enc TEXT DEFAULT NULL");
  }
  if (userCols.length > 0 && !userCols.includes("llm_base_url")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN llm_base_url TEXT DEFAULT NULL");
  }
  if (userCols.length > 0 && !userCols.includes("llm_model")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN llm_model TEXT DEFAULT NULL");
  }
  if (usjCols.length > 0 && !usjCols.includes("fit_score")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN fit_score INTEGER DEFAULT NULL");
  }
  if (usjCols.length > 0 && !usjCols.includes("fit_verdict")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN fit_verdict TEXT DEFAULT NULL");
  }
  if (usjCols.length > 0 && !usjCols.includes("fit_scores_json")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN fit_scores_json TEXT DEFAULT NULL");
  }
  if (usjCols.length > 0 && !usjCols.includes("fit_assessment")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN fit_assessment TEXT DEFAULT NULL");
  }
  if (usjCols.length > 0 && !usjCols.includes("fit_checked_at")) {
    db.exec("ALTER TABLE user_seen_jobs ADD COLUMN fit_checked_at TEXT DEFAULT NULL");
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
      session_version INTEGER NOT NULL DEFAULT 0,
      education_level TEXT DEFAULT '',
      notification_channel_id TEXT DEFAULT NULL,
      resume_text TEXT DEFAULT NULL,
      experience_years REAL DEFAULT NULL,
      llm_provider TEXT DEFAULT 'gemini',
      llm_key_enc TEXT DEFAULT NULL,
      llm_base_url TEXT DEFAULT NULL,
      llm_model TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_seen_jobs (
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      status TEXT DEFAULT 'notified',
      notified_at TEXT NOT NULL,
      applied_at TEXT,
      saved_at TEXT,
      save_reminder_sent BOOLEAN DEFAULT 0,
      fit_score INTEGER DEFAULT NULL,
      fit_verdict TEXT DEFAULT NULL,
      fit_scores_json TEXT DEFAULT NULL,
      fit_assessment TEXT DEFAULT NULL,
      fit_checked_at TEXT DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS delivery_claims (
      user_id INTEGER NOT NULL,
      job_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'claimed',
      claim_token TEXT,
      claimed_at TEXT NOT NULL,
      lease_until TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, job_key),
      FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE
    );

    -- Durable aliases make the stable-key rollout safe for in-flight workers
    -- and old Discord buttons that still carry a legacy mutable job key.
    CREATE TABLE IF NOT EXISTS job_key_aliases (
      old_key TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL,
      migrated_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_user_seen_jobs_user_status_job ON user_seen_jobs(user_id, status, job_key);
    CREATE INDEX IF NOT EXISTS idx_user_seen_jobs_saved_reminder ON user_seen_jobs(status, saved_at, save_reminder_sent, user_id, job_key);
    CREATE INDEX IF NOT EXISTS idx_dm_log_user ON dm_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_dm_log_user_status_job ON dm_log(user_id, status, job_key);
    CREATE INDEX IF NOT EXISTS idx_dm_log_user_status_sent ON dm_log(user_id, status, sent_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_log_user_status_id ON dm_log(user_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_delivery_claims_status_lease ON delivery_claims(status, lease_until);
    CREATE INDEX IF NOT EXISTS idx_delivery_claims_user_status_job ON delivery_claims(user_id, status, job_key);
    CREATE INDEX IF NOT EXISTS idx_job_key_aliases_canonical ON job_key_aliases(canonical_key);
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
    CREATE INDEX IF NOT EXISTS idx_password_reset_email ON password_reset_codes(email, created_at);

    -- Indexes for the pruneState() scans (range deletes + the seen_jobs orphan
    -- check) and getRepostCount(). The existing dm_log/user_seen_jobs indexes are
    -- all (user_id, ...)-prefixed and can't serve these column-only lookups.
    CREATE INDEX IF NOT EXISTS idx_dm_log_sent_at ON dm_log(sent_at);
    CREATE INDEX IF NOT EXISTS idx_dm_log_job_key ON dm_log(job_key);
    CREATE INDEX IF NOT EXISTS idx_user_seen_jobs_notified_at ON user_seen_jobs(notified_at);
    CREATE INDEX IF NOT EXISTS idx_user_seen_jobs_job_key ON user_seen_jobs(job_key);
    CREATE INDEX IF NOT EXISTS idx_seen_source_label ON seen_jobs(source_label, first_seen_at);
    CREATE INDEX IF NOT EXISTS idx_error_log_occurred_at ON error_log(occurred_at DESC);

    CREATE TABLE IF NOT EXISTS company_research (
      company_key TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      research_json TEXT NOT NULL,
      researched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feature_flags (
      key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);

  const deliveryClaimCols = db.pragma("table_info(delivery_claims)").map((c) => c.name);
  if (!deliveryClaimCols.includes("claim_token")) {
    db.exec("ALTER TABLE delivery_claims ADD COLUMN claim_token TEXT DEFAULT NULL");
  }

  // Keep operational errors useful enough to diagnose from the admin UI.
  // Additive migrations preserve the existing production error history.
  const errorLogCols = db.pragma("table_info(error_log)").map((c) => c.name);
  const errorLogMigrations = [
    ["severity", "TEXT DEFAULT 'error'"],
    ["category", "TEXT DEFAULT 'unclassified'"],
    ["error_code", "TEXT"],
    ["stack", "TEXT"],
    ["context_json", "TEXT"],
    ["process_name", "TEXT"],
  ];
  for (const [column, definition] of errorLogMigrations) {
    if (!errorLogCols.includes(column)) db.exec(`ALTER TABLE error_log ADD COLUMN ${column} ${definition}`);
  }
  // Old pre-send leases need an owner generation before token-checked workers
  // can safely recover or complete them. Terminal rows do not need a token.
  db.prepare(`
    UPDATE delivery_claims
       SET claim_token = lower(hex(randomblob(16)))
     WHERE status IN ('claimed', 'digest_claimed', 'sending', 'digest_sending')
       AND (claim_token IS NULL OR claim_token = '')
  `).run();

  // Registered feature flags. INSERT OR IGNORE so a flipped flag survives restarts.
  db.prepare("INSERT OR IGNORE INTO feature_flags (key, enabled, updated_at) VALUES (?, 0, ?)")
    .run("mu_fit_check", new Date().toISOString());

  // Provenance label for the LCA-derived sponsor stats (e.g. "2025").
  const h1bCols = db.pragma("table_info(h1b_sponsors)").map((c) => c.name);
  if (!h1bCols.includes("lca_fy")) {
    db.exec("ALTER TABLE h1b_sponsors ADD COLUMN lca_fy TEXT DEFAULT ''");
  }

  hardenSqliteFilePermissions(db.name);

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
  _invalidateSeenJobsCache();
}

export function getDb() {
  return db;
}

/** Resolve a legacy job key to its durable canonical key (chains are bounded). */
export function resolveJobKey(jobKey) {
  let current = String(jobKey || "");
  if (!current || !db) return current;
  const lookup = db.prepare("SELECT canonical_key FROM job_key_aliases WHERE old_key = ?");
  const visited = new Set();
  for (let depth = 0; depth < 32 && !visited.has(current); depth++) {
    visited.add(current);
    const row = lookup.get(current);
    if (!row?.canonical_key || row.canonical_key === current) break;
    current = row.canonical_key;
  }
  return current;
}

function recordJobKeyAlias(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const canonical = resolveJobKey(newKey);
  if (!canonical || canonical === oldKey) return;
  const now = new Date().toISOString();
  // Flatten existing chains before recording the new edge. This keeps every
  // runtime lookup to one row after repeated historical migrations.
  db.prepare("UPDATE job_key_aliases SET canonical_key = ?, migrated_at = ? WHERE canonical_key = ?")
    .run(canonical, now, oldKey);
  db.prepare(`
    INSERT INTO job_key_aliases (old_key, canonical_key, migrated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(old_key) DO UPDATE SET
      canonical_key = excluded.canonical_key,
      migrated_at = excluded.migrated_at
  `).run(oldKey, canonical, now);
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
  // If the cache was loaded before migrate ran (unlikely on normal startup
  // but possible if a re-init/reload happens), drop it so the next read sees
  // the freshly inserted rows.
  _invalidateSeenJobsCache();

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

// Dedup via in-memory cache — O(1) per job, no DB read locks
export function getNewJobs(jobs) {
  ensureSeenJobsCache();
  return jobs.filter((job) => {
    if (cacheGet(job.key)) return false;
    if (cacheGetBySourceId(job.sourceKey, String(job.id))) return false;
    if (job.url) {
      const altKey = cacheGetByUrl(job.url);
      if (altKey && altKey !== job.key) return false;
    }
    return true;
  });
}

// Per-process dedup: check job_posts (personal bot's notification ledger)
// instead of seen_jobs, so two processes sharing the DB don't race.
const _stmtByKeyPost = () => db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?");

// A durable, at-most-once pre-send marker for the personal notification path.
// If the process dies after the external service accepts a message but before
// the real message id is stored, leaving this row in place is safer than
// automatically sending the same job again. Known send failures explicitly
// release the marker so a later cycle can retry.
export const PERSONAL_DELIVERY_CLAIM_MESSAGE_ID = "__jobpulse_delivery_claim__";

export function getUnnotifiedJobs(jobs) {
  const byKey = _stmtByKeyPost();
  return jobs.filter((job) => !byKey.get(resolveJobKey(job.key)));
}

export function claimPersonalDelivery(jobKey, channelId = "") {
  const claimToken = randomUUID();
  const claimedAt = new Date().toISOString();
  const inserted = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return 0;
    return db.prepare(`
      INSERT OR IGNORE INTO job_posts
        (job_key, message_id, thread_id, channel_id, status,
         delivery_claim_token, delivery_claimed_at)
      VALUES (?, ?, NULL, ?, 'delivery_claimed', ?, ?)
    `).run(
      canonicalKey,
      PERSONAL_DELIVERY_CLAIM_MESSAGE_ID,
      channelId || "",
      claimToken,
      claimedAt,
    ).changes;
  }).immediate();
  return inserted === 1 ? claimToken : null;
}

export function releasePersonalDeliveryClaim(jobKey, claimToken) {
  if (!claimToken) return false;
  return db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return false;
    return db.prepare(`
      DELETE FROM job_posts
       WHERE job_key = ?
         AND message_id = ?
         AND status = 'delivery_claimed'
         AND delivery_claim_token = ?
    `).run(canonicalKey, PERSONAL_DELIVERY_CLAIM_MESSAGE_ID, claimToken).changes === 1;
  }).immediate();
}

// Lookup helpers are now in-memory cache reads; only the touch UPDATE remains.
const _stmtTouchLastSeen = () => db.prepare("UPDATE seen_jobs SET last_seen_at = ? WHERE key = ?");

function seenJobTouchIntervalMs() {
  return envPositiveInt("SEEN_JOB_TOUCH_INTERVAL_MINUTES", 360) * 60 * 1000;
}

function upsertChunkSize() {
  return envPositiveInt("SQLITE_UPSERT_CHUNK_SIZE", 50);
}

function upsertChunkDelayMs() {
  return envPositiveInt("SQLITE_UPSERT_CHUNK_DELAY_MS", 25);
}

function shouldTouchLastSeen(lastSeenAt, seenAt, intervalMs) {
  if (intervalMs <= 0) return true;
  const seenMs = Date.parse(seenAt);
  const lastSeenMs = Date.parse(lastSeenAt || "");
  return !Number.isFinite(seenMs) ||
    !Number.isFinite(lastSeenMs) ||
    (seenMs - lastSeenMs) >= intervalMs;
}

function jobDbValues(job, seenAt, firstSeenAt = seenAt) {
  return {
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
    firstSeenAt,
    lastSeenAt: seenAt,
  };
}

function existingJobNeedsUpsert(existing, values) {
  if (!existing) return true;
  return (
    (values.sourceLabel !== "" && existing.source_label !== values.sourceLabel) ||
    (values.title !== "" && existing.title !== values.title) ||
    (values.location !== "" && existing.location !== values.location) ||
    (values.url !== "" && existing.url !== values.url) ||
    (values.postedText !== "" && existing.posted_text !== values.postedText) ||
    (values.postedAt !== "" && existing.posted_at !== values.postedAt) ||
    (values.postedPrecision !== "" && existing.posted_precision !== values.postedPrecision) ||
    (values.countryCode !== "" && existing.country_code !== values.countryCode) ||
    (values.seniorityLevel !== "" && existing.seniority_level !== values.seniorityLevel) ||
    (values.roleCategories !== "[]" && existing.role_categories !== values.roleCategories) ||
    (values.archetype != null && existing.archetype !== values.archetype)
  );
}

function userJobStatusRankSql(expr) {
  return `CASE COALESCE(${expr}, '')
    WHEN 'offer' THEN 60
    WHEN 'rejected' THEN 55
    WHEN 'interviewing' THEN 50
    WHEN 'applied' THEN 40
    WHEN 'saved' THEN 30
    WHEN 'skipped' THEN 20
    WHEN 'notified' THEN 10
    ELSE 0
  END`;
}

function deliveryClaimStatusRankSql(expr) {
  return `CASE COALESCE(${expr}, '')
    WHEN 'sent' THEN 100
    WHEN 'uncertain' THEN 90
    WHEN 'sending' THEN 80
    WHEN 'digest_sending' THEN 80
    WHEN 'dm_closed' THEN 70
    WHEN 'dead_link' THEN 70
    WHEN 'queued' THEN 40
    WHEN 'digest_claimed' THEN 30
    WHEN 'claimed' THEN 20
    WHEN 'failed' THEN 10
    ELSE 0
  END`;
}

function earliestIsoSql(column, excludedColumn) {
  return `CASE
    WHEN ${column} IS NULL THEN ${excludedColumn}
    WHEN ${excludedColumn} IS NULL THEN ${column}
    WHEN ${excludedColumn} < ${column} THEN ${excludedColumn}
    ELSE ${column}
  END`;
}

function latestIsoSql(column, excludedColumn) {
  return `CASE
    WHEN ${column} IS NULL THEN ${excludedColumn}
    WHEN ${excludedColumn} IS NULL THEN ${column}
    WHEN ${excludedColumn} > ${column} THEN ${excludedColumn}
    ELSE ${column}
  END`;
}

function remapJobReferences(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return true;

  const oldPost = db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?").get(oldKey);
  const newPost = db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?").get(newKey);
  // Never discard an in-flight claim or a confirmed interactive message. A
  // future cycle can reconcile after the claim is manually resolved; choosing
  // either row here creates a late-finalize/late-release race for its owner.
  if (oldPost && newPost) return false;

  db.prepare(`
    INSERT INTO user_seen_jobs
      (user_id, job_key, status, notified_at, applied_at, saved_at,
       save_reminder_sent, fit_score, fit_verdict, fit_scores_json,
       fit_assessment, fit_checked_at, updated_at)
    SELECT user_id, ?, status, notified_at, applied_at, saved_at,
           save_reminder_sent, fit_score, fit_verdict, fit_scores_json,
           fit_assessment, fit_checked_at, updated_at
    FROM user_seen_jobs
    WHERE job_key = ?
    ON CONFLICT(user_id, job_key) DO UPDATE SET
      status = CASE
        WHEN ${userJobStatusRankSql("excluded.status")} > ${userJobStatusRankSql("user_seen_jobs.status")}
        THEN excluded.status
        ELSE user_seen_jobs.status
      END,
      notified_at = ${earliestIsoSql("user_seen_jobs.notified_at", "excluded.notified_at")},
      applied_at = ${earliestIsoSql("user_seen_jobs.applied_at", "excluded.applied_at")},
      saved_at = ${earliestIsoSql("user_seen_jobs.saved_at", "excluded.saved_at")},
      save_reminder_sent = CASE
        WHEN COALESCE(user_seen_jobs.save_reminder_sent, 0) = 1 OR COALESCE(excluded.save_reminder_sent, 0) = 1 THEN 1
        ELSE 0
      END,
      fit_score = COALESCE(user_seen_jobs.fit_score, excluded.fit_score),
      fit_verdict = COALESCE(user_seen_jobs.fit_verdict, excluded.fit_verdict),
      fit_scores_json = COALESCE(user_seen_jobs.fit_scores_json, excluded.fit_scores_json),
      fit_assessment = COALESCE(user_seen_jobs.fit_assessment, excluded.fit_assessment),
      fit_checked_at = ${latestIsoSql("user_seen_jobs.fit_checked_at", "excluded.fit_checked_at")},
      updated_at = ${latestIsoSql("user_seen_jobs.updated_at", "excluded.updated_at")}
  `).run(newKey, oldKey);
  db.prepare("DELETE FROM user_seen_jobs WHERE job_key = ?").run(oldKey);

  db.prepare("UPDATE dm_log SET job_key = ? WHERE job_key = ?").run(newKey, oldKey);

  const dualActiveUsers = db.prepare(`
    SELECT old.user_id
      FROM delivery_claims old
      JOIN delivery_claims current
        ON current.user_id = old.user_id AND current.job_key = ?
     WHERE old.job_key = ?
       AND old.status IN ('sending', 'digest_sending')
       AND current.status IN ('sending', 'digest_sending')
  `).all(newKey, oldKey).map((row) => row.user_id);

  db.prepare(`
    INSERT INTO delivery_claims
      (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
    SELECT user_id, ?, status, claim_token, claimed_at, lease_until, updated_at
      FROM delivery_claims
     WHERE job_key = ?
    ON CONFLICT(user_id, job_key) DO UPDATE SET
      status = CASE
        WHEN ${deliveryClaimStatusRankSql("excluded.status")} > ${deliveryClaimStatusRankSql("delivery_claims.status")}
          THEN excluded.status
        ELSE delivery_claims.status
      END,
      claim_token = CASE
        WHEN ${deliveryClaimStatusRankSql("excluded.status")} > ${deliveryClaimStatusRankSql("delivery_claims.status")}
          THEN excluded.claim_token
        ELSE delivery_claims.claim_token
      END,
      claimed_at = CASE
        WHEN ${deliveryClaimStatusRankSql("excluded.status")} > ${deliveryClaimStatusRankSql("delivery_claims.status")}
          THEN excluded.claimed_at
        ELSE delivery_claims.claimed_at
      END,
      lease_until = CASE
        WHEN ${deliveryClaimStatusRankSql("excluded.status")} > ${deliveryClaimStatusRankSql("delivery_claims.status")}
          THEN excluded.lease_until
        ELSE delivery_claims.lease_until
      END,
      updated_at = CASE
        WHEN ${deliveryClaimStatusRankSql("excluded.status")} > ${deliveryClaimStatusRankSql("delivery_claims.status")}
          THEN excluded.updated_at
        ELSE delivery_claims.updated_at
      END
  `).run(newKey, oldKey);
  db.prepare("DELETE FROM delivery_claims WHERE job_key = ?").run(oldKey);
  if (dualActiveUsers.length > 0) {
    const placeholders = dualActiveUsers.map(() => "?").join(",");
    db.prepare(`
      UPDATE delivery_claims
         SET status = 'uncertain', claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE job_key = ? AND user_id IN (${placeholders})
    `).run(new Date().toISOString(), newKey, ...dualActiveUsers);
  }

  db.prepare("UPDATE job_posts SET job_key = ? WHERE job_key = ?").run(newKey, oldKey);
  db.prepare("DELETE FROM job_posts WHERE job_key = ?").run(oldKey);
  return true;
}

function remapSeenJobToCanonical(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return true;
  if (!remapJobReferences(oldKey, newKey)) return false;
  recordJobKeyAlias(oldKey, newKey);

  const canonicalExists = db.prepare("SELECT 1 FROM seen_jobs WHERE key = ?").get(newKey);
  if (!canonicalExists) {
    db.prepare("UPDATE seen_jobs SET key = ? WHERE key = ?").run(newKey, oldKey);
    return true;
  }

  // Preserve expensive enrichment produced before the stable canonical key was
  // introduced. Incoming scraper metadata must not erase fit or legitimacy data.
  db.prepare(`
    UPDATE seen_jobs
       SET fit_score = COALESCE(fit_score, (SELECT fit_score FROM seen_jobs WHERE key = ?)),
           fit_scores_json = COALESCE(fit_scores_json, (SELECT fit_scores_json FROM seen_jobs WHERE key = ?)),
           legitimacy_tier = COALESCE(legitimacy_tier, (SELECT legitimacy_tier FROM seen_jobs WHERE key = ?)),
           legitimacy_signals_json = COALESCE(legitimacy_signals_json, (SELECT legitimacy_signals_json FROM seen_jobs WHERE key = ?)),
           first_seen_at = MIN(first_seen_at, (SELECT first_seen_at FROM seen_jobs WHERE key = ?)),
           last_seen_at = MAX(last_seen_at, (SELECT last_seen_at FROM seen_jobs WHERE key = ?))
     WHERE key = ?
  `).run(oldKey, oldKey, oldKey, oldKey, oldKey, oldKey, newKey);
  db.prepare("DELETE FROM seen_jobs WHERE key = ?").run(oldKey);
  return true;
}

/**
 * One-time maintenance for databases created before stable source/ID keys.
 *
 * This deliberately uses the same reference merge, conflict policy, and alias
 * recording as live collector upserts. URL-only rows are left untouched: a
 * shared URL is weaker than two distinct non-empty ATS identities and is not a
 * safe basis for an offline destructive merge.
 */
export function canonicalizeStoredStableJobKeys() {
  const groups = db.prepare(`
    SELECT source_key, id
      FROM seen_jobs
     WHERE TRIM(source_key) != '' AND TRIM(id) != ''
     GROUP BY source_key, id
     ORDER BY source_key, id
  `).all();
  const stats = {
    groups: groups.length,
    alreadyCanonical: 0,
    remapped: 0,
    skipped: 0,
  };

  for (const group of groups) {
    const result = withBusyRetry(() => db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM seen_jobs
         WHERE source_key = ? AND id = ?
         ORDER BY last_seen_at DESC, first_seen_at ASC, key ASC
      `).all(group.source_key, group.id);
      if (rows.length === 0) return { remapped: 0, skipped: 0, alreadyCanonical: 0 };

      const representative = rows[0];
      const canonicalKey = finalizeJob({
        sourceKey: group.source_key,
        sourceLabel: representative.source_label,
        id: group.id,
        title: representative.title,
        location: representative.location,
        url: representative.url,
      }).key;
      const canonicalRow = rows.find((row) => row.key === canonicalKey);
      const ordered = canonicalRow
        ? [canonicalRow, ...rows.filter((row) => row !== canonicalRow)]
        : rows;
      let remapped = 0;
      let skipped = 0;

      for (const row of ordered) {
        if (row.key === canonicalKey) continue;
        if (remapSeenJobToCanonical(row.key, canonicalKey)) {
          remapped++;
        } else {
          skipped++;
        }
      }
      return {
        remapped,
        skipped,
        alreadyCanonical: remapped === 0 && skipped === 0 &&
          rows.length === 1 && rows[0].key === canonicalKey ? 1 : 0,
      };
    }).immediate());
    stats.remapped += result.remapped;
    stats.skipped += result.skipped;
    stats.alreadyCanonical += result.alreadyCanonical;
  }

  _invalidateSeenJobsCache();
  stats.remainingDuplicateSourceIds = db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT 1 FROM seen_jobs
       WHERE TRIM(source_key) != '' AND TRIM(id) != ''
       GROUP BY source_key, id
      HAVING COUNT(*) > 1
    )
  `).get().count;
  return stats;
}

export function upsertJobs(jobs, seenAt) {
  _hasSeenJobsCached = true;
  ensureSeenJobsCache();
  const touchLastSeen = _stmtTouchLastSeen();
  const touchIntervalMs = seenJobTouchIntervalMs();

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
      source_label = CASE WHEN excluded.source_label != '' THEN excluded.source_label ELSE seen_jobs.source_label END,
      title = CASE WHEN excluded.title != '' THEN excluded.title ELSE seen_jobs.title END,
      location = CASE WHEN excluded.location != '' THEN excluded.location ELSE seen_jobs.location END,
      url = CASE WHEN excluded.url != '' THEN excluded.url ELSE seen_jobs.url END,
      posted_text = CASE WHEN excluded.posted_text != '' THEN excluded.posted_text ELSE seen_jobs.posted_text END,
      posted_at = CASE WHEN excluded.posted_at != '' THEN excluded.posted_at ELSE seen_jobs.posted_at END,
      posted_precision = CASE WHEN excluded.posted_precision != '' THEN excluded.posted_precision ELSE seen_jobs.posted_precision END,
      country_code = CASE WHEN excluded.country_code != '' THEN excluded.country_code ELSE seen_jobs.country_code END,
      seniority_level = CASE WHEN excluded.seniority_level != '' THEN excluded.seniority_level ELSE seen_jobs.seniority_level END,
      role_categories = CASE WHEN excluded.role_categories != '[]' THEN excluded.role_categories ELSE seen_jobs.role_categories END,
      archetype = COALESCE(excluded.archetype, seen_jobs.archetype)
  `);

  const chunkSize = upsertChunkSize();
  const chunkDelayMs = upsertChunkDelayMs();
  const stats = { upserted: 0, touched: 0, skipped: 0, remapped: 0 };

  function touchIfDue(key, lastSeenAt) {
    if (shouldTouchLastSeen(lastSeenAt, seenAt, touchIntervalMs)) {
      touchLastSeen.run(seenAt, key);
      cacheTouchEntry(key, seenAt);
      stats.touched++;
    } else {
      stats.skipped++;
    }
  }

  const processChunk = db.transaction((chunk) => {
    for (const incomingJob of chunk) {
      // A worker can hold a job object created before another process remaps a
      // legacy mutable key. Never let that stale object reverse the durable
      // old -> canonical alias or recreate split seen/delivery rows.
      const canonicalIncomingKey = resolveJobKey(incomingJob.key);
      const job = canonicalIncomingKey !== incomingJob.key
        ? { ...incomingJob, key: canonicalIncomingKey }
        : incomingJob;
      let existingFirstSeen = null;
      let legacyAltKeys = [];
      const sourceKey = String(job.sourceKey || "").trim();
      const sourceId = String(job.id || "").trim();
      // Both lookups run. They are deliberately NOT alternatives.
      //
      // The (source_key, id) lookup only finds a prior row when the collector
      // still derives the SAME id for that posting. The moment a collector
      // changes which upstream field it uses as the id — a legitimate fix when
      // the old field turns out to be unstable — every posting re-keys, the
      // source/id probe matches nothing, and with the URL probe behind an
      // `else if` it never ran. The old rows stayed orphaned, the jobs looked
      // brand new, and the freshness window's worth of them was re-delivered.
      // That happened on 2026-08-04 when the Workday id moved from
      // bulletFields[0] to the externalPath requisition slug: ~790 postings
      // re-keyed and re-alerted. The canonical URL does not change across an
      // id-shape change, so consulting it as well absorbs the migration
      // silently and records the alias. Order matters only for first_seen_at,
      // which takes the earliest of whatever is found.
      const seenAltKeys = new Set();
      const collectAltKeys = (rows) => {
        for (const row of rows) {
          if (row.key !== job.key && !seenAltKeys.has(row.key)) {
            seenAltKeys.add(row.key);
            legacyAltKeys.push(row.key);
          }
        }
      };

      if (sourceKey && sourceId) {
        // The cache index intentionally stores one key per source/id, but a
        // legacy database can contain several mutable hashes for that same ATS
        // posting. Always reconcile the complete DB set; otherwise whichever
        // row happened to populate the cache index last could hide the rest.
        collectAltKeys(db.prepare(`
          SELECT key FROM seen_jobs
           WHERE source_key = ? AND id = ? AND key != ?
           ORDER BY first_seen_at ASC
        `).all(sourceKey, sourceId, job.key));
      }
      if (job.url) {
        collectAltKeys(db.prepare(`
          SELECT key FROM seen_jobs WHERE url = ? AND key != ?
          ORDER BY first_seen_at ASC
        `).all(job.url, job.key));
      }

      for (const legacyAltKey of legacyAltKeys) {
        const altEntry = cacheGet(legacyAltKey) || db.prepare(
          `SELECT ${SEEN_JOBS_CACHE_FIELDS} FROM seen_jobs WHERE key = ?`
        ).get(legacyAltKey);
        if (altEntry) {
          if (!existingFirstSeen || altEntry.first_seen_at < existingFirstSeen) {
            existingFirstSeen = altEntry.first_seen_at;
          }
          if (!remapSeenJobToCanonical(legacyAltKey, job.key)) {
            touchIfDue(legacyAltKey, altEntry.last_seen_at);
            continue;
          }
          cacheDelete(legacyAltKey);
          stats.remapped++;
        }
      }

      const sameEntry = cacheGet(job.key);
      if (!existingFirstSeen && sameEntry) existingFirstSeen = sameEntry.first_seen_at;

      const values = jobDbValues(job, seenAt, existingFirstSeen || seenAt);
      if (sameEntry && !existingJobNeedsUpsert(sameEntry, values)) {
        touchIfDue(job.key, sameEntry.last_seen_at);
        continue;
      }

      upsert.run(values);
      cacheSetFromValues(values);
      stats.upserted++;
    }
  });

  for (let i = 0; i < jobs.length; i += chunkSize) {
    const slice = jobs.slice(i, i + chunkSize);
    withBusyRetry(() => processChunk.immediate(slice));
    if (i + chunkSize < jobs.length) sleepSync(chunkDelayMs);
  }

  withBusyRetry(() =>
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lastRunAt', ?)").run(seenAt)
  );
  return stats;
}

export function pruneState(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // Queued rows are undelivered work, not historical logs. Retaining them (and
  // their source job) is required for daily/digest and quiet-hours delivery.
  db.prepare("DELETE FROM dm_log WHERE sent_at < ? AND status != 'queued'").run(cutoff);
  db.prepare(`
    DELETE FROM user_seen_jobs
    WHERE notified_at < ?
      AND status IN ('notified', 'skipped')
  `).run(cutoff);
  db.prepare(`
    DELETE FROM job_posts
    WHERE status IN ('pending', 'skipped')
      AND job_key IN (SELECT key FROM seen_jobs WHERE last_seen_at < ?)
  `).run(cutoff);

  const seenJobsDeleted = db.prepare(`
    DELETE FROM seen_jobs
    WHERE last_seen_at < ?
      AND NOT EXISTS (SELECT 1 FROM user_seen_jobs usj WHERE usj.job_key = seen_jobs.key)
      AND NOT EXISTS (SELECT 1 FROM job_posts jp WHERE jp.job_key = seen_jobs.key)
      AND NOT EXISTS (SELECT 1 FROM dm_log dl WHERE dl.job_key = seen_jobs.key)
      AND NOT EXISTS (
        SELECT 1 FROM delivery_claims dc
         WHERE dc.job_key = seen_jobs.key
           AND dc.status IN ('queued', 'claimed', 'sending', 'digest_claimed', 'digest_sending', 'uncertain')
      )
  `).run(cutoff).changes;

  // Claims are a concurrency/durability mechanism, not an eternal audit log.
  // Preserve queued and active leases; retire old terminal/failed claims, plus
  // terminal orphans whose source job has already been removed.
  db.prepare(`
    DELETE FROM delivery_claims
     WHERE status IN ('sent', 'dead_link', 'dm_closed', 'failed')
       AND (
         updated_at < ?
         OR NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = delivery_claims.job_key)
       )
  `).run(cutoff);
  // Clear cache only when pruneState actually deleted seen_jobs rows.
  if (seenJobsDeleted > 0) _invalidateSeenJobsCache();

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
export function upsertJobPost(jobKey, messageId, threadId, channelId, claimToken = null) {
  return db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return false;
    if (claimToken) {
      const finalized = db.prepare(`
        UPDATE job_posts
           SET message_id = ?, thread_id = ?, channel_id = ?, status = 'pending',
               delivery_claim_token = NULL, delivery_claimed_at = NULL
         WHERE job_key = ?
           AND message_id = ?
           AND status = 'delivery_claimed'
           AND delivery_claim_token = ?
      `).run(
        messageId,
        threadId,
        channelId,
        canonicalKey,
        PERSONAL_DELIVERY_CLAIM_MESSAGE_ID,
        claimToken,
      ).changes;
      return finalized === 1;
    }

    // Compatibility for manual/direct callers: insert a new confirmed row but
    // never overwrite an existing message or another worker's claim.
    return db.prepare(`
      INSERT OR IGNORE INTO job_posts
        (job_key, message_id, thread_id, channel_id, status,
         delivery_claim_token, delivery_claimed_at)
      VALUES (?, ?, ?, ?, 'pending', NULL, NULL)
    `).run(canonicalKey, messageId, threadId, channelId).changes === 1;
  }).immediate();
}

// Ledger-only record for jobs delivered via a non-bot path (webhook fallback).
// message_id/channel_id are NOT NULL, so calling upsertJobPost with nulls
// always threw SQLITE_CONSTRAINT and the fallback re-notified the same jobs
// every cycle. Empty-string sentinels satisfy the constraints without risking a
// false message-id match (real Discord snowflakes are never ''), and OR IGNORE
// guarantees an existing bot-posted row is never clobbered.
export function recordExternalDelivery(jobKey, channelId, claimToken = null) {
  const destination = channelId || "";
  return db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return false;
    if (claimToken) {
      return db.prepare(`
        UPDATE job_posts
           SET message_id = '', thread_id = NULL, channel_id = ?, status = 'pending',
               delivery_claim_token = NULL, delivery_claimed_at = NULL
         WHERE job_key = ?
           AND message_id = ?
           AND status = 'delivery_claimed'
           AND delivery_claim_token = ?
      `).run(
        destination,
        canonicalKey,
        PERSONAL_DELIVERY_CLAIM_MESSAGE_ID,
        claimToken,
      ).changes === 1;
    }

    return db.prepare(`
      INSERT OR IGNORE INTO job_posts
        (job_key, message_id, thread_id, channel_id, status,
         delivery_claim_token, delivery_claimed_at)
      VALUES (?, '', NULL, ?, 'pending', NULL, NULL)
    `).run(canonicalKey, destination).changes === 1;
  }).immediate();
}

export function getJobPost(jobKey) {
  return db.prepare("SELECT * FROM job_posts WHERE job_key = ?").get(resolveJobKey(jobKey));
}

export function updateJobPostStatus(jobKey, status) {
  db.prepare("UPDATE job_posts SET status = ? WHERE job_key = ?").run(status, resolveJobKey(jobKey));
}

/** Owner-only view of personal deliveries whose remote result is unresolved. */
export function listPersonalDeliveryClaims({ olderThanMinutes = null } = {}) {
  const parsedMinutes = Number(olderThanMinutes);
  const hasCutoff = Number.isFinite(parsedMinutes) && parsedMinutes >= 0;
  const cutoff = hasCutoff
    ? new Date(Date.now() - parsedMinutes * 60 * 1000).toISOString()
    : null;
  const whereCutoff = hasCutoff ? "AND jp.delivery_claimed_at <= ?" : "";
  const rows = db.prepare(`
    SELECT jp.job_key AS jobKey,
           jp.channel_id AS channelId,
           jp.delivery_claim_token AS claimToken,
           jp.delivery_claimed_at AS claimedAt,
           sj.source_label AS sourceLabel,
           sj.title AS title
      FROM job_posts jp
      LEFT JOIN seen_jobs sj ON sj.key = jp.job_key
     WHERE jp.status = 'delivery_claimed'
       AND jp.message_id = ?
       ${whereCutoff}
     ORDER BY jp.delivery_claimed_at ASC, jp.job_key ASC
  `).all(...(hasCutoff
    ? [PERSONAL_DELIVERY_CLAIM_MESSAGE_ID, cutoff]
    : [PERSONAL_DELIVERY_CLAIM_MESSAGE_ID]));
  return rows;
}

export function expireSavedJobPosts() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    "UPDATE job_posts SET status = 'skipped' WHERE status = 'saved' AND job_key IN (SELECT key FROM seen_jobs WHERE last_seen_at <= ?)"
  ).run(cutoff).changes;
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
    if (row.status !== "delivery_claimed") notified += row.cnt;
  }

  return {
    discovered,
    notified,
    pending: byStatus.pending || 0,
    fitchecked: byStatus.fitchecked || 0,
    saved: byStatus.saved || 0,
    applied: byStatus.applied || 0,
    skipped: byStatus.skipped || 0,
    uncertain: byStatus.delivery_claimed || 0,
  };
}

// --- Fit score CRUD ---
export function updateJobFitScore(jobKey, score, scoresJson) {
  db.prepare("UPDATE seen_jobs SET fit_score = ?, fit_scores_json = ? WHERE key = ?")
    .run(score, scoresJson, resolveJobKey(jobKey));
}

export function getJobFitScore(jobKey) {
  return db.prepare("SELECT fit_score, fit_scores_json FROM seen_jobs WHERE key = ?")
    .get(resolveJobKey(jobKey));
}

// --- Legitimacy CRUD ---
export function getRepostCount(sourceLabel, titleCore, excludeKey, lookbackDays = 90) {
  try {
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    // Exclude jobs first seen within the last day — prevents same-batch multi-location
    // postings (e.g. same title in San Diego AND Cupertino) from flagging each other.
    const batchCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM seen_jobs
      WHERE source_label = ?
        AND title LIKE '%' || ? || '%'
        AND first_seen_at >= ?
        AND first_seen_at < ?
        AND key != ?
    `).get(sourceLabel, titleCore, cutoff, batchCutoff, resolveJobKey(excludeKey));
    return row?.cnt ?? 0;
  } catch (err) {
    console.warn(`[legitimacy] getRepostCount failed: ${err.message}`);
    return 0;
  }
}

export function updateJobLegitimacy(jobKey, tier, signalsJson) {
  try {
    db.prepare("UPDATE seen_jobs SET legitimacy_tier = ?, legitimacy_signals_json = ? WHERE key = ?")
      .run(tier, signalsJson, resolveJobKey(jobKey));
  } catch (err) {
    console.warn(`[legitimacy] updateJobLegitimacy failed: ${err.message}`);
  }
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
