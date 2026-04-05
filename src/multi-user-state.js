/**
 * multi-user-state.js
 * CRUD operations for multi-user tables.
 * Uses the shared better-sqlite3 handle from state.js (synchronous API, no async/await).
 */

import { getDb } from "./state.js";

// ---------------------------------------------------------------------------
// User Profiles
// ---------------------------------------------------------------------------

const UPDATABLE_PROFILE_FIELDS = new Set([
  "first_name",
  "email",
  "email_verified",
  "role_categories",
  "seniority_levels",
  "company_selections",
  "country",
  "requires_sponsorship",
  "notification_mode",
  "quiet_hours_start",
  "quiet_hours_end",
  "quiet_hours_tz",
  "is_active",
  "role",
]);

/**
 * Create a new user profile.
 * @returns {number} lastInsertRowid
 */
export function createUserProfile({ discordId, discordUsername, firstName, email }) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO user_profiles
         (discord_id, discord_username, first_name, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(discordId, discordUsername, firstName, email, now, now);
  return result.lastInsertRowid;
}

/**
 * Get a user profile by Discord ID.
 * @returns {object|undefined}
 */
export function getUserProfile(discordId) {
  return getDb()
    .prepare("SELECT * FROM user_profiles WHERE discord_id = ?")
    .get(discordId);
}

/**
 * Get a user profile by internal integer ID.
 * @returns {object|undefined}
 */
export function getUserProfileById(userId) {
  return getDb()
    .prepare("SELECT * FROM user_profiles WHERE id = ?")
    .get(userId);
}

/**
 * Get all active users (is_active = 1).
 * @returns {object[]}
 */
export function getActiveUsers() {
  return getDb()
    .prepare("SELECT * FROM user_profiles WHERE is_active = 1")
    .all();
}

/**
 * Update allowed fields on a user profile.
 * @param {string} discordId
 * @param {object} fields - key/value pairs to update (only UPDATABLE_PROFILE_FIELDS honoured)
 */
export function updateUserProfile(discordId, fields) {
  const entries = Object.entries(fields).filter(([k]) => UPDATABLE_PROFILE_FIELDS.has(k));
  if (entries.length === 0) return;

  const setClauses = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  values.push(new Date().toISOString()); // updated_at
  values.push(discordId);

  getDb()
    .prepare(`UPDATE user_profiles SET ${setClauses}, updated_at = ? WHERE discord_id = ?`)
    .run(...values);
}

/**
 * Delete a user profile and all related rows (cascading manual delete).
 */
export function deleteUserProfile(discordId) {
  const db = getDb();
  const user = db.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(discordId);
  if (!user) return;

  const del = db.transaction(() => {
    db.prepare("DELETE FROM user_seen_jobs WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM dm_log WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM user_profiles WHERE id = ?").run(user.id);
  });
  del();
}

// ---------------------------------------------------------------------------
// User Seen Jobs
// ---------------------------------------------------------------------------

/**
 * Mark a job as notified for a user (idempotent).
 */
export function markJobNotified(userId, jobKey) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO user_seen_jobs (user_id, job_key, status, notified_at)
       VALUES (?, ?, 'notified', ?)`
    )
    .run(userId, jobKey, now);
}

/**
 * Update the status of a user–job row.
 */
export function updateJobStatus(userId, jobKey, status) {
  const now = new Date().toISOString();
  const appliedClause = status === "applied" ? ", applied_at = ?" : "";
  const params = status === "applied"
    ? [status, now, now, userId, jobKey]
    : [status, now, userId, jobKey];
  getDb()
    .prepare(
      `UPDATE user_seen_jobs SET status = ?, updated_at = ?${appliedClause}
       WHERE user_id = ? AND job_key = ?`
    )
    .run(...params);
}

/**
 * Get all job keys a user has seen, as a Set.
 * @returns {Set<string>}
 */
export function getUserSeenJobKeys(userId) {
  const rows = getDb()
    .prepare("SELECT job_key FROM user_seen_jobs WHERE user_id = ?")
    .all(userId);
  return new Set(rows.map((r) => r.job_key));
}

/**
 * Get a user's application history joined with full job details.
 * @param {number} userId
 * @param {{ status?: string, limit?: number, offset?: number }} opts
 * @returns {object[]}
 */
export function getUserApplications(userId, { status, limit = 50, offset = 0 } = {}) {
  let sql = `
    SELECT usj.job_key, usj.status, usj.notified_at, usj.updated_at,
           sj.title, sj.location, sj.url, sj.source_label, sj.posted_at,
           sj.country_code, sj.seniority_level, sj.role_categories
    FROM user_seen_jobs usj
    LEFT JOIN seen_jobs sj ON sj.key = usj.job_key
    WHERE usj.user_id = ?
  `;
  const params = [userId];

  if (status) {
    sql += " AND usj.status = ?";
    params.push(status);
  }

  sql += " ORDER BY usj.notified_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return getDb().prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// H1B Sponsors
// ---------------------------------------------------------------------------

/**
 * Check whether a company key is a known H1B sponsor.
 * @returns {boolean}
 */
export function isH1bSponsor(companyKey) {
  const row = getDb()
    .prepare("SELECT sponsors_h1b FROM h1b_sponsors WHERE company_key = ?")
    .get(companyKey);
  return row ? Boolean(row.sponsors_h1b) : false;
}

/**
 * Insert or update an H1B sponsor record.
 */
export function upsertH1bSponsor({ companyKey, companyName, sponsorsH1b, lcaCount, avgSalary }) {
  getDb()
    .prepare(
      `INSERT INTO h1b_sponsors (company_key, company_name, sponsors_h1b, lca_count, avg_salary)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(company_key) DO UPDATE SET
         company_name  = excluded.company_name,
         sponsors_h1b  = excluded.sponsors_h1b,
         lca_count     = excluded.lca_count,
         avg_salary    = excluded.avg_salary`
    )
    .run(companyKey, companyName, sponsorsH1b ? 1 : 0, lcaCount ?? 0, avgSalary ?? 0);
}

// ---------------------------------------------------------------------------
// OTP Codes
// ---------------------------------------------------------------------------

/**
 * Create a new OTP code for the given email.
 */
export function createOtp(email, code, expiresInMinutes = 5) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMinutes * 60 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO otp_codes (email, code, expires_at, used, created_at)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(email, code, expiresAt, now.toISOString());
}

/**
 * Verify an OTP code: must be valid, unexpired, and unused.
 * Marks it as used on success.
 * @returns {boolean}
 */
export function verifyOtp(email, code) {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT rowid FROM otp_codes
       WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(email, code, now);

  if (!row) return false;

  db.prepare("UPDATE otp_codes SET used = 1 WHERE rowid = ?").run(row.rowid);
  return true;
}

// ---------------------------------------------------------------------------
// DM Log
// ---------------------------------------------------------------------------

/**
 * Log a DM delivery event.
 */
export function logDm(userId, jobKey, status = "sent") {
  getDb()
    .prepare(
      `INSERT INTO dm_log (user_id, job_key, status, sent_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, jobKey, status, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Error Log
// ---------------------------------------------------------------------------

/**
 * Log an error from a source.
 */
export function logError(sourceKey, errorMessage) {
  getDb()
    .prepare(
      `INSERT INTO error_log (source_key, error_message, occurred_at)
       VALUES (?, ?, ?)`
    )
    .run(sourceKey, errorMessage, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Support Tickets
// ---------------------------------------------------------------------------

/**
 * Create a new support ticket.
 * @returns {number} lastInsertRowid
 */
export function createSupportTicket(userId, category, description) {
  const result = getDb()
    .prepare(
      `INSERT INTO support_tickets (user_id, category, description, submitted_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, category, description, new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * Get all support tickets for a user, newest first.
 * @returns {object[]}
 */
export function getUserTickets(userId) {
  return getDb()
    .prepare(
      "SELECT * FROM support_tickets WHERE user_id = ? ORDER BY submitted_at DESC"
    )
    .all(userId);
}

/**
 * Update a support ticket's status and/or admin response.
 * Sets resolved_at if status is 'resolved' or 'closed'.
 */
export function updateTicket(ticketId, { status, adminResponse } = {}) {
  const db = getDb();
  const parts = [];
  const values = [];

  if (status !== undefined) {
    parts.push("status = ?");
    values.push(status);

    if (status === "resolved" || status === "closed") {
      parts.push("resolved_at = ?");
      values.push(new Date().toISOString());
    }
  }

  if (adminResponse !== undefined) {
    parts.push("admin_response = ?");
    values.push(adminResponse);
  }

  if (parts.length === 0) return;

  values.push(ticketId);
  db.prepare(`UPDATE support_tickets SET ${parts.join(", ")} WHERE id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// Company Suggestions
// ---------------------------------------------------------------------------

/**
 * Create a company suggestion.
 * @returns {number} lastInsertRowid
 */
export function createCompanySuggestion(userId, companyName, careersUrl, reason) {
  const result = getDb()
    .prepare(
      `INSERT INTO company_suggestions (user_id, company_name, careers_url, reason, submitted_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, companyName, careersUrl ?? "", reason ?? "", new Date().toISOString());
  return result.lastInsertRowid;
}

/**
 * Get all pending company suggestions, joined with the submitting user's Discord username.
 * Ordered by submitted_at ASC (oldest first).
 * @returns {object[]}
 */
export function getPendingSuggestions() {
  return getDb()
    .prepare(
      `SELECT cs.*, up.discord_username
       FROM company_suggestions cs
       JOIN user_profiles up ON up.id = cs.user_id
       WHERE cs.status = 'pending'
       ORDER BY cs.submitted_at ASC`
    )
    .all();
}

/**
 * Update a company suggestion's status and optional admin response.
 * Sets reviewed_at on update.
 */
export function updateSuggestion(suggestionId, { status, adminResponse } = {}) {
  const db = getDb();
  const parts = ["reviewed_at = ?"];
  const values = [new Date().toISOString()];

  if (status !== undefined) {
    parts.push("status = ?");
    values.push(status);
  }

  if (adminResponse !== undefined) {
    parts.push("admin_response = ?");
    values.push(adminResponse);
  }

  values.push(suggestionId);
  db.prepare(`UPDATE company_suggestions SET ${parts.join(", ")} WHERE id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search a user's seen jobs with optional filters.
 * @param {number} userId
 * @param {{ query?: string, company?: string, status?: string, days?: number, limit?: number, offset?: number }} opts
 * @returns {{ results: object[], total: number }}
 */
export function searchUserJobs(userId, { query, company, status, days = 30, limit = 50, offset = 0 } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const baseWhere = ["usj.user_id = ?", "usj.notified_at >= ?"];
  const params = [userId, cutoff];

  if (status) {
    baseWhere.push("usj.status = ?");
    params.push(status);
  }
  if (company) {
    baseWhere.push("sj.source_label LIKE ?");
    params.push(`%${company}%`);
  }
  if (query) {
    baseWhere.push("sj.title LIKE ?");
    params.push(`%${query}%`);
  }

  const whereClause = baseWhere.join(" AND ");

  const baseSql = `
    FROM user_seen_jobs usj
    LEFT JOIN seen_jobs sj ON sj.key = usj.job_key
    WHERE ${whereClause}
  `;

  const total = db
    .prepare(`SELECT COUNT(*) AS cnt ${baseSql}`)
    .get(...params).cnt;

  const results = db
    .prepare(
      `SELECT usj.job_key, usj.status, usj.notified_at, usj.updated_at,
              sj.title, sj.location, sj.url, sj.source_label, sj.posted_at,
              sj.country_code, sj.seniority_level, sj.role_categories
       ${baseSql}
       ORDER BY usj.notified_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  return { results, total };
}
