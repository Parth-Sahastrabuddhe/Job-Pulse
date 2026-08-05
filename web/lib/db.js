import Database from "better-sqlite3";
import {
  hardenSqliteFilePermissions,
  preparePrivateDbFile,
  resolveDbFile,
} from "../../src/db-path.js";

let db = null;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 2000;

function isSqliteBusy(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code.startsWith("SQLITE_BUSY") || /database is locked|SQLITE_BUSY/i.test(message);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withBusyRetry(operation, { retries = 3, baseDelayMs = 100 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (!isSqliteBusy(error) || attempt >= retries) throw error;
      sleepSync(baseDelayMs * (2 ** attempt));
    }
  }
}

function sqliteBusyTimeoutMs() {
  const parsed = Number.parseInt(String(process.env.SQLITE_BUSY_TIMEOUT_MS ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
}

export function getDb() {
  if (db) return db;
  const dbPath = resolveDbFile();
  preparePrivateDbFile(dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${sqliteBusyTimeoutMs()}`);
  db.pragma("wal_autocheckpoint = 500");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_rate_limits (
      scope TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      window_started_at INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL,
      PRIMARY KEY (scope, key_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_web_rate_limits_window
      ON web_rate_limits(window_started_at);

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_email
      ON password_reset_codes(email, created_at);

    CREATE TABLE IF NOT EXISTS public_support_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      admin_response TEXT DEFAULT '',
      submitted_at TEXT NOT NULL,
      resolved_at TEXT
    );
  `);
  const publicSupportColumns = db.pragma("table_info(public_support_requests)").map((column) => column.name);
  if (publicSupportColumns.length > 0 && !publicSupportColumns.includes("email")) {
    db.exec("ALTER TABLE public_support_requests ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  }
  const userColumns = db.pragma("table_info(user_profiles)").map((column) => column.name);
  if (userColumns.length > 0 && !userColumns.includes("session_version")) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }
  const errorColumns = db.pragma("table_info(error_log)").map((column) => column.name);
  if (errorColumns.length > 0) {
    const migrations = [
      ["severity", "TEXT DEFAULT 'error'"], ["category", "TEXT DEFAULT 'unclassified'"],
      ["error_code", "TEXT"], ["stack", "TEXT"], ["context_json", "TEXT"], ["process_name", "TEXT"],
    ];
    for (const [column, definition] of migrations) {
      if (!errorColumns.includes(column)) db.exec(`ALTER TABLE error_log ADD COLUMN ${column} ${definition}`);
    }
  }
  hardenSqliteFilePermissions(dbPath);
  return db;
}

// Fixed-window limiter persisted in the shared SQLite database. Keys are
// caller-provided hashes, so email addresses and IPs are never stored here.
export function consumeRateLimit({ scope, keyHash, limit, windowMs, now = Date.now() }) {
  if (!scope || !keyHash || !Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1000) {
    throw new Error("Invalid rate-limit configuration");
  }
  const d = getDb();
  return withBusyRetry(() => d.transaction(() => {
    const row = d.prepare(
      "SELECT window_started_at, attempt_count FROM web_rate_limits WHERE scope = ? AND key_hash = ?"
    ).get(scope, keyHash);

    if (!row || now < row.window_started_at || now - row.window_started_at >= windowMs) {
      d.prepare(`
        INSERT INTO web_rate_limits (scope, key_hash, window_started_at, attempt_count)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(scope, key_hash) DO UPDATE SET
          window_started_at = excluded.window_started_at,
          attempt_count = 1
      `).run(scope, keyHash, now);
      // Opportunistic cleanup keeps the table bounded without a scheduler.
      d.prepare("DELETE FROM web_rate_limits WHERE window_started_at < ?")
        .run(now - 24 * 60 * 60 * 1000);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - row.window_started_at)) / 1000));
    if (row.attempt_count >= limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    d.prepare(
      "UPDATE web_rate_limits SET attempt_count = attempt_count + 1 WHERE scope = ? AND key_hash = ?"
    ).run(scope, keyHash);
    return { allowed: true, remaining: limit - row.attempt_count - 1, retryAfterSeconds };
  })());
}

export function resetRateLimit(scope, keyHash) {
  const d = getDb();
  withBusyRetry(() => d.prepare("DELETE FROM web_rate_limits WHERE scope = ? AND key_hash = ?").run(scope, keyHash));
}

// --- User Profiles ---

export function createUserProfile({ discordId, discordUsername, firstName, email, passwordHash }) {
  const d = getDb();
  const existing = getUserProfile(discordId);
  if (existing) throw new Error("ALREADY_REGISTERED");

  const existingEmail = getUserProfileByEmail(email);
  if (existingEmail) throw new Error("EMAIL_TAKEN");

  const now = new Date().toISOString();
  const result = d.prepare(`
    INSERT INTO user_profiles (discord_id, discord_username, first_name, email, email_verified, password_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(discordId, discordUsername, firstName, email, passwordHash || null, now, now);
  return result.lastInsertRowid;
}

export function getUserProfile(discordId) {
  return getDb().prepare("SELECT * FROM user_profiles WHERE discord_id = ?").get(discordId);
}

export function getUserProfileByEmail(email) {
  return getDb().prepare("SELECT * FROM user_profiles WHERE email = ?").get(email);
}

export function setPasswordHash(discordId, passwordHash) {
  const d = getDb();
  return withBusyRetry(() => d.transaction(() => {
    const result = d.prepare(`
      UPDATE user_profiles
         SET password_hash = ?,
             session_version = COALESCE(session_version, 0) + 1,
             updated_at = ?
       WHERE discord_id = ?
    `).run(passwordHash, new Date().toISOString(), discordId);
    d.prepare(`
      UPDATE password_reset_codes
         SET used = 1
       WHERE email = (SELECT email FROM user_profiles WHERE discord_id = ?)
         AND used = 0
    `).run(discordId);
    return result.changes === 1;
  })());
}

export function setNotificationChannelId(discordId, channelId) {
  getDb().prepare("UPDATE user_profiles SET notification_channel_id = ?, updated_at = ? WHERE discord_id = ?")
    .run(channelId, new Date().toISOString(), discordId);
}

export function updateUserProfile(discordId, fields) {
  const d = getDb();
  const allowed = [
    "first_name", "email", "email_verified", "role_categories", "seniority_levels",
    "company_selections", "country", "requires_sponsorship", "notification_mode",
    "quiet_hours_start", "quiet_hours_end", "quiet_hours_tz", "is_active",
    "education_level",
    "resume_text", "experience_years", "llm_provider", "llm_model", "llm_base_url"
  ];
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (allowed.includes(key)) { updates.push(`${key} = ?`); values.push(value); }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(discordId);
  d.prepare(`UPDATE user_profiles SET ${updates.join(", ")} WHERE discord_id = ?`).run(...values);
}

// --- User Applications ---

const APPLICATION_SORTS = {
  date_desc: "COALESCE(usj.applied_at, usj.notified_at) DESC, usj.job_key ASC",
  date_asc: "COALESCE(usj.applied_at, usj.notified_at) ASC, usj.job_key ASC",
  company_asc: "LOWER(COALESCE(sj.source_label, sj.source_key, '')) ASC, COALESCE(usj.applied_at, usj.notified_at) DESC",
  company_desc: "LOWER(COALESCE(sj.source_label, sj.source_key, '')) DESC, COALESCE(usj.applied_at, usj.notified_at) DESC",
  status_asc: `CASE usj.status
    WHEN 'applied' THEN 1 WHEN 'interviewing' THEN 2 WHEN 'offer' THEN 3
    WHEN 'rejected' THEN 4 WHEN 'skipped' THEN 5 ELSE 6 END ASC,
    COALESCE(usj.applied_at, usj.notified_at) DESC`,
};

export function getUserApplications(discordId, { status, query, sort = "date_desc", limit = 50, offset = 0 } = {}) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return { applications: [], total: 0, stats: { tracked: 0, active: 0 } };
  const isAdmin = discordId === process.env.ADMIN_DISCORD_ID;
  let where = isAdmin
    ? "WHERE usj.user_id = ? AND usj.status NOT IN ('notified', 'skipped', 'saved')"
    : "WHERE usj.user_id = ? AND usj.status NOT IN ('notified', 'saved')";
  const params = [user.id];
  const accountStats = d.prepare(`
    SELECT
      COUNT(*) AS tracked,
      COALESCE(SUM(CASE WHEN usj.status IN ('interviewing', 'offer') THEN 1 ELSE 0 END), 0) AS active
    FROM user_seen_jobs usj
    JOIN seen_jobs sj ON usj.job_key = sj.key
    ${where}
  `).get(user.id);
  if (status) { where += " AND usj.status = ?"; params.push(status); }
  if (query) {
    where += " AND (sj.title LIKE ? ESCAPE '\\' OR sj.source_label LIKE ? ESCAPE '\\' OR sj.source_key LIKE ? ESCAPE '\\' OR sj.location LIKE ? ESCAPE '\\')";
    const escapedQuery = String(query).replace(/[\\%_]/g, "\\$&");
    const like = `%${escapedQuery}%`;
    params.push(like, like, like, like);
  }
  const orderBy = APPLICATION_SORTS[sort] || APPLICATION_SORTS.date_desc;
  const total = d.prepare(`SELECT COUNT(*) as cnt FROM user_seen_jobs usj JOIN seen_jobs sj ON usj.job_key = sj.key ${where}`).get(...params).cnt;
  const applications = d.prepare(`SELECT usj.*, sj.title, sj.source_label, sj.source_key, sj.location, sj.url, sj.posted_at
    FROM user_seen_jobs usj JOIN seen_jobs sj ON usj.job_key = sj.key ${where}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return {
    applications,
    total,
    stats: {
      tracked: Number(accountStats.tracked || 0),
      active: Number(accountStats.active || 0),
    },
  };
}

export function isFeatureEnabled(key) {
  try {
    const row = getDb().prepare("SELECT enabled FROM feature_flags WHERE key = ?").get(key);
    return row?.enabled === 1;
  } catch {
    return false;
  }
}

export function updateApplicationStatus(discordId, jobKey, status) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return false;
  const now = new Date().toISOString();
  const appliedClause = status === "applied" ? ", applied_at = ?" : "";
  const params = status === "applied" ? [status, now, now, user.id, jobKey] : [status, now, user.id, jobKey];
  const result = d.prepare(`UPDATE user_seen_jobs SET status = ?, updated_at = ?${appliedClause} WHERE user_id = ? AND job_key = ?`).run(...params);
  return result.changes === 1;
}

export function getApplicationsByMonth(discordId, monthStr) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return {};

  // Parse "2026-04" into date range
  const [year, month] = monthStr.split("-").map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

  const rows = d.prepare(`
    SELECT usj.job_key, usj.applied_at, sj.title, sj.source_label, sj.url
    FROM user_seen_jobs usj
    JOIN seen_jobs sj ON usj.job_key = sj.key
    WHERE usj.user_id = ?
      AND usj.status IN ('applied', 'interviewing', 'offer', 'rejected')
      AND usj.applied_at IS NOT NULL
      AND usj.applied_at >= ? AND usj.applied_at < ?
    ORDER BY usj.applied_at ASC
  `).all(user.id, startDate, endDate);

  // Group by date in user's timezone (YYYY-MM-DD)
  const tz = user.quiet_hours_tz || "America/New_York";
  const days = {};
  for (const row of rows) {
    const d2 = new Date(row.applied_at);
    // Sheet imports store date-only values at UTC midnight. Applying a western
    // user timezone would shift those applications to the previous day.
    const rowTz = row.job_key.startsWith("sheet:") ? "UTC" : tz;
    const dateKey = d2.toLocaleDateString("en-CA", { timeZone: rowTz }); // en-CA gives YYYY-MM-DD
    if (!days[dateKey]) days[dateKey] = [];
    days[dateKey].push({
      title: row.title,
      source_label: row.source_label,
      url: row.url,
      job_key: row.job_key,
    });
  }
  return days;
}

// --- OTP ---

export function createOtp(email, code) {
  const d = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  withBusyRetry(() => d.transaction(() => {
    // Invalidate any prior unused codes for this email so a resend doesn't
    // leave extra guessable codes live in the 5-minute window.
    d.prepare("UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
    d.prepare("INSERT INTO otp_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(email, code, expiresAt, now.toISOString());
  })());
}

export function invalidateOtp(email, code) {
  const d = getDb();
  withBusyRetry(() => d.prepare("UPDATE otp_codes SET used = 1 WHERE email = ? AND code = ? AND used = 0")
    .run(email, code));
}

export function verifyOtp(email, code) {
  const d = getDb();
  return withBusyRetry(() => d.transaction(() => {
    const row = d.prepare(`SELECT rowid FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`).get(email, code, new Date().toISOString());
    if (!row) return false;
    const result = d.prepare("UPDATE otp_codes SET used = 1 WHERE rowid = ? AND used = 0").run(row.rowid);
    return result.changes === 1;
  })());
}

// --- Password reset codes ---

export function createPasswordResetCode(email, codeHash, { now = Date.now(), ttlMs = 10 * 60 * 1000 } = {}) {
  const d = getDb();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  withBusyRetry(() => d.transaction(() => {
    d.prepare("UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
    d.prepare(`
      INSERT INTO password_reset_codes (email, code_hash, expires_at, used, created_at)
      VALUES (?, ?, ?, 0, ?)
    `).run(email, codeHash, expiresAt, createdAt);
    d.prepare("DELETE FROM password_reset_codes WHERE expires_at < ?")
      .run(new Date(now - 24 * 60 * 60 * 1000).toISOString());
  })());
}

export function invalidatePasswordResetCode(email, codeHash) {
  const d = getDb();
  withBusyRetry(() => d.prepare(`
    UPDATE password_reset_codes SET used = 1
     WHERE email = ? AND code_hash = ? AND used = 0
  `).run(email, codeHash));
}

export function consumePasswordResetCode(email, codeHash, { now = Date.now() } = {}) {
  const d = getDb();
  return withBusyRetry(() => d.transaction(() => {
    const row = d.prepare(`
      UPDATE password_reset_codes
         SET used = 1
       WHERE id = (
         SELECT id FROM password_reset_codes
          WHERE email = ? AND code_hash = ? AND used = 0 AND expires_at > ?
          ORDER BY created_at DESC
          LIMIT 1
       )
         AND used = 0
      RETURNING id
    `).get(email, codeHash, new Date(now).toISOString());
    if (!row) return false;
    d.prepare("UPDATE password_reset_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
    return true;
  })());
}

// --- Support Tickets ---

export function createSupportTicket(discordId, category, description) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return null;
  const result = d.prepare(`INSERT INTO support_tickets (user_id, category, description, submitted_at) VALUES (?, ?, ?, ?)`).run(user.id, category, description, new Date().toISOString());
  return result.lastInsertRowid;
}

export function getUserTickets(discordId) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return [];
  return d.prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY submitted_at DESC").all(user.id);
}

// Tickets from signed-out visitors (login problems, general questions). Stored
// separately because support_tickets.user_id is NOT NULL; surfaced in the same
// admin queue by getAllTickets.
export function createPublicSupportRequest(email, category, description) {
  const d = getDb();
  const result = d.prepare(
    "INSERT INTO public_support_requests (email, category, description, submitted_at) VALUES (?, ?, ?, ?)"
  ).run(email, category, description, new Date().toISOString());
  return result.lastInsertRowid;
}

// --- Company Suggestions ---

export function createCompanySuggestion(discordId, companyName, careersUrl, reason) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return null;
  const result = d.prepare(`INSERT INTO company_suggestions (user_id, company_name, careers_url, reason, submitted_at) VALUES (?, ?, ?, ?, ?)`).run(user.id, companyName, careersUrl || "", reason || "", new Date().toISOString());
  return result.lastInsertRowid;
}

// --- Fit Check: LLM key + feature flags ---

export function setLlmKeyEnc(discordId, encOrNull) {
  getDb().prepare("UPDATE user_profiles SET llm_key_enc = ?, updated_at = ? WHERE discord_id = ?")
    .run(encOrNull, new Date().toISOString(), discordId);
}

export function listFeatureFlags() {
  return getDb().prepare("SELECT key, enabled, updated_at FROM feature_flags ORDER BY key").all();
}

// Updates only; flags are registered by the bot's initDb seed, never created here.
export function setFeatureFlag(key, enabled) {
  const result = getDb().prepare("UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?")
    .run(enabled ? 1 : 0, new Date().toISOString(), key);
  return result.changes > 0;
}
