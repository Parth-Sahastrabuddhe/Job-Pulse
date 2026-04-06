import path from "node:path";
import Database from "better-sqlite3";

let db = null;

export function getDb() {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "../data/jobs.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// --- User Profiles ---

export function createUserProfile({ discordId, discordUsername, firstName, email, passwordHash }) {
  const d = getDb();
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
  getDb().prepare("UPDATE user_profiles SET password_hash = ?, updated_at = ? WHERE discord_id = ?")
    .run(passwordHash, new Date().toISOString(), discordId);
}

export function updateUserProfile(discordId, fields) {
  const d = getDb();
  const allowed = [
    "first_name", "email", "email_verified", "role_categories", "seniority_levels",
    "company_selections", "country", "requires_sponsorship", "notification_mode",
    "quiet_hours_start", "quiet_hours_end", "quiet_hours_tz", "is_active"
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

export function getUserApplications(discordId, { status, query, limit = 50, offset = 0 } = {}) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return { applications: [], total: 0 };
  const isAdmin = discordId === "1038422401874145372";
  let where = isAdmin
    ? "WHERE usj.user_id = ? AND usj.status NOT IN ('notified', 'skipped')"
    : "WHERE usj.user_id = ? AND usj.status != 'notified'";
  const params = [user.id];
  if (status) { where += " AND usj.status = ?"; params.push(status); }
  if (query) { where += " AND (sj.title LIKE ? OR sj.source_label LIKE ?)"; params.push(`%${query}%`, `%${query}%`); }
  const total = d.prepare(`SELECT COUNT(*) as cnt FROM user_seen_jobs usj JOIN seen_jobs sj ON usj.job_key = sj.key ${where}`).get(...params).cnt;
  const applications = d.prepare(`SELECT usj.*, sj.title, sj.source_label, sj.source_key, sj.location, sj.url, sj.posted_at
    FROM user_seen_jobs usj JOIN seen_jobs sj ON usj.job_key = sj.key ${where}
    ORDER BY usj.notified_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { applications, total };
}

export function updateApplicationStatus(discordId, jobKey, status) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return;
  const now = new Date().toISOString();
  const appliedClause = status === "applied" ? ", applied_at = ?" : "";
  const params = status === "applied" ? [status, now, now, user.id, jobKey] : [status, now, user.id, jobKey];
  d.prepare(`UPDATE user_seen_jobs SET status = ?, updated_at = ?${appliedClause} WHERE user_id = ? AND job_key = ?`).run(...params);
}

// --- OTP ---

export function createOtp(email, code) {
  const d = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  d.prepare("INSERT INTO otp_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)").run(email, code, expiresAt, now.toISOString());
}

export function verifyOtp(email, code) {
  const d = getDb();
  const row = d.prepare(`SELECT rowid FROM otp_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1`).get(email, code, new Date().toISOString());
  if (!row) return false;
  d.prepare("UPDATE otp_codes SET used = 1 WHERE rowid = ?").run(row.rowid);
  return true;
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

// --- Company Suggestions ---

export function createCompanySuggestion(discordId, companyName, careersUrl, reason) {
  const d = getDb();
  const user = getUserProfile(discordId);
  if (!user) return null;
  const result = d.prepare(`INSERT INTO company_suggestions (user_id, company_name, careers_url, reason, submitted_at) VALUES (?, ?, ?, ?, ?)`).run(user.id, companyName, careersUrl || "", reason || "", new Date().toISOString());
  return result.lastInsertRowid;
}
