/**
 * multi-user-state.js
 * CRUD operations for multi-user tables.
 * Uses the shared better-sqlite3 handle from state.js (synchronous API, no async/await).
 */

import { getDb, resolveJobKey, withBusyRetry } from "./state.js";
import { jobButtonHash } from "./job-key-hash.js";

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
  "education_level",
]);

/**
 * Create a new user profile.
 * Returns existing profile id if already registered.
 * @returns {number} profile id
 */
export function createUserProfile({ discordId, discordUsername, firstName, email }) {
  const existing = getUserProfile(discordId);
  if (existing) return existing.id;

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
  const user = db.prepare("SELECT id, email FROM user_profiles WHERE discord_id = ?").get(discordId);
  if (!user) return;

  const del = db.transaction(() => {
    // Explicit cleanup keeps account deletion compatible with older databases
    // whose foreign keys were created without ON DELETE CASCADE.
    db.prepare("DELETE FROM support_tickets WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM company_suggestions WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM user_seen_jobs WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM dm_log WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM delivery_claims WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM otp_codes WHERE email = ?").run(user.email);
    // Address storage was removed from new installations. Clean up a user's
    // legacy rows only when an old production database still has the table.
    const legacyAddressTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_addresses'"
    ).get();
    if (legacyAddressTable) {
      db.prepare("DELETE FROM user_addresses WHERE user_id = ?").run(user.id);
    }
    db.prepare("DELETE FROM user_profiles WHERE id = ?").run(user.id);
  });
  del();
  _dropBufferedEntriesForUser(user.id);
}

// ---------------------------------------------------------------------------
// User Seen Jobs
// ---------------------------------------------------------------------------

/**
 * Mark a job as notified for a user (idempotent).
 */
export function markJobNotified(userId, jobKey) {
  jobKey = resolveJobKey(jobKey);
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
  jobKey = resolveJobKey(jobKey);
  const now = new Date().toISOString();
  let extraSql = "";
  const params = [status, now];

  if (status === "applied") {
    extraSql = ", applied_at = ?";
    params.push(now);
  } else if (status === "saved") {
    extraSql = ", saved_at = ?, save_reminder_sent = 0";
    params.push(now);
  }

  params.push(userId, jobKey);

  getDb()
    .prepare(
      `UPDATE user_seen_jobs SET status = ?, updated_at = ?${extraSql}
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
 * Get job keys the multi-user bot has already processed for a user.
 * Uses the durable delivery-claim state, dm_log ledger, and user actions.
 * @returns {Set<string>}
 */
export function getMuDeliveredJobKeys(userId) {
  const db = getDb();
  // Jobs the mu bot delivered (or filtered)
  const dmRows = db
    .prepare("SELECT DISTINCT job_key FROM dm_log WHERE user_id = ? AND status IN ('sent','queued','dead_link','dm_closed','uncertain')")
    .all(userId);
  const claimRows = db
    .prepare(`SELECT job_key FROM delivery_claims
              WHERE user_id = ?
                AND (status IN ('sent','queued','dead_link','dm_closed','uncertain',
                                'sending','digest_claimed','digest_sending')
                     OR (status = 'claimed' AND lease_until > ?))`)
    .all(userId, new Date().toISOString());
  // Jobs the user acted on (should not re-notify regardless of source)
  const actionRows = db
    .prepare("SELECT job_key FROM user_seen_jobs WHERE user_id = ? AND status IN ('applied','saved','skipped')")
    .all(userId);
  const keys = new Set(dmRows.map((r) => resolveJobKey(r.job_key)));
  for (const r of claimRows) keys.add(resolveJobKey(r.job_key));
  for (const r of actionRows) keys.add(resolveJobKey(r.job_key));
  // Merge unflushed buffered deliveries — same poll cycle might enqueue and
  // re-check before the buffer hits disk.
  const buffered = _bufferedKeysByUser.get(userId);
  if (buffered) for (const k of buffered) keys.add(resolveJobKey(k));
  return keys;
}

// Hashes in already-delivered Discord messages cannot be rewritten when a
// mutable legacy key is promoted to its stable source/ID key. Resolve both
// live keys and alias old_keys, and canonicalize cached hits so another key
// migration cannot leave a stale process-local result behind.
const _buttonHashToKeyCache = new Map();

function liveCanonicalJobKey(candidate) {
  const canonical = resolveJobKey(candidate);
  if (!canonical) return null;
  return getDb().prepare("SELECT 1 FROM seen_jobs WHERE key = ?").get(canonical)
    ? canonical
    : null;
}

/** Resolve a MU Discord button hash, including hashes made before re-keying. */
export function findJobKeyByHash(hash, userId) {
  const wanted = String(hash || "");
  if (!/^[a-f0-9]{16}$/i.test(wanted)) return null;

  const cached = _buttonHashToKeyCache.get(wanted);
  if (cached) {
    const canonical = liveCanonicalJobKey(cached);
    if (canonical) {
      _buttonHashToKeyCache.set(wanted, canonical);
      markJobNotified(userId, canonical);
      return canonical;
    }
    _buttonHashToKeyCache.delete(wanted);
  }

  const db = getDb();
  const candidates = [
    ...db.prepare("SELECT job_key AS candidate FROM user_seen_jobs WHERE user_id = ?").all(userId),
    ...db.prepare("SELECT key AS candidate FROM seen_jobs").all(),
    ...db.prepare("SELECT old_key AS candidate FROM job_key_aliases").all(),
  ];

  for (const row of candidates) {
    if (jobButtonHash(row.candidate) !== wanted) continue;
    const canonical = liveCanonicalJobKey(row.candidate);
    if (!canonical) continue;
    _buttonHashToKeyCache.set(wanted, canonical);
    // Alias/seen_jobs fallbacks also repair a delivery row that was lost before
    // its buffered ledger write. INSERT OR IGNORE preserves user actions.
    markJobNotified(userId, canonical);
    return canonical;
  }
  return null;
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

/**
 * Get a user's saved jobs, ordered by expiry (soonest first).
 * @param {number} userId
 * @param {{ limit?: number, offset?: number }} opts
 * @returns {{ results: object[], total: number }}
 */
export function getSavedJobs(userId, { limit = 5, offset = 0 } = {}) {
  const db = getDb();
  const baseSql = `
    FROM user_seen_jobs usj
    LEFT JOIN seen_jobs sj ON sj.key = usj.job_key
    WHERE usj.user_id = ? AND usj.status = 'saved'
  `;
  const total = db
    .prepare(`SELECT COUNT(*) AS cnt ${baseSql}`)
    .get(userId).cnt;

  const results = db
    .prepare(
      `SELECT usj.job_key, usj.saved_at, usj.status,
              sj.title, sj.location, sj.url, sj.source_label
       ${baseSql}
       ORDER BY usj.saved_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset);

  return { results, total };
}

/**
 * Get saved jobs that need a reminder (saved 6+ days ago, reminder not yet sent).
 * Returns rows with user_id so we know who to DM.
 * @returns {object[]}
 */
export function getExpiringReminders() {
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return getDb()
    .prepare(
      `SELECT usj.user_id, usj.job_key, usj.saved_at,
              sj.title, sj.source_label, sj.location,
              up.discord_id
       FROM user_seen_jobs usj
       LEFT JOIN seen_jobs sj ON sj.key = usj.job_key
       LEFT JOIN user_profiles up ON up.id = usj.user_id
       WHERE usj.status = 'saved'
         AND usj.saved_at <= ?
         AND usj.saved_at > ?
         AND usj.save_reminder_sent = 0`
    )
    .all(sixDaysAgo, sevenDaysAgo);
}

/**
 * Mark reminder as sent for a batch of (user_id, job_key) pairs.
 * @param {Array<{user_id: number, job_key: string}>} pairs
 */
export function markRemindersSent(pairs) {
  const db = getDb();
  const stmt = db.prepare(
    "UPDATE user_seen_jobs SET save_reminder_sent = 1 WHERE user_id = ? AND job_key = ?"
  );
  const tx = db.transaction(() => {
    for (const { user_id, job_key } of pairs) {
      stmt.run(user_id, resolveJobKey(job_key));
    }
  });
  tx();
}

/**
 * Expire saved jobs older than 7 days — set status to 'skipped'.
 * @returns {number} number of rows updated
 */
export function expireSavedJobs() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  return getDb()
    .prepare(
      `UPDATE user_seen_jobs SET status = 'skipped', updated_at = ?
       WHERE status = 'saved' AND saved_at <= ?`
    )
    .run(now, cutoff).changes;
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
export function upsertH1bSponsor({ companyKey, companyName, sponsorsH1b, lcaCount, avgSalary, lcaFy }) {
  getDb()
    .prepare(
      `INSERT INTO h1b_sponsors (company_key, company_name, sponsors_h1b, lca_count, avg_salary, lca_fy)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(company_key) DO UPDATE SET
         company_name  = excluded.company_name,
         sponsors_h1b  = excluded.sponsors_h1b,
         lca_count     = excluded.lca_count,
         avg_salary    = excluded.avg_salary,
         lca_fy        = excluded.lca_fy`
    )
    .run(companyKey, companyName, sponsorsH1b ? 1 : 0, lcaCount ?? 0, avgSalary ?? 0, lcaFy ?? "");
}

/**
 * LCA history stats for a company, for the H-1B line in job embeds.
 * Returns null when there is no real data (lca_count 0 keeps the line off).
 */
export function getH1bSponsorStats(companyKey) {
  if (!companyKey) return null;
  const row = getDb()
    .prepare("SELECT lca_count, avg_salary, lca_fy FROM h1b_sponsors WHERE company_key = ? AND lca_count > 0")
    .get(companyKey);
  return row ?? null;
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
  const db = getDb();
  const replaceOtp = db.transaction(() => {
    db.prepare("UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
    db.prepare(
      `INSERT INTO otp_codes (email, code, expires_at, used, created_at)
       VALUES (?, ?, ?, 0, ?)`
    )
    .run(email, code, expiresAt, now.toISOString());
  });
  replaceOtp();
}

/**
 * Verify an OTP code: must be valid, unexpired, and unused.
 * Marks it as used on success.
 * @returns {boolean}
 */
export function verifyOtp(email, code) {
  const db = getDb();
  const now = new Date().toISOString();
  const consume = db.transaction(() => {
    const row = db.prepare(
      `UPDATE otp_codes
          SET used = 1
        WHERE rowid = (
          SELECT rowid FROM otp_codes
           WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
           ORDER BY created_at DESC
           LIMIT 1
        )
          AND used = 0
      RETURNING rowid`
    ).get(email, code, now);
    if (!row) return false;
    // A successful verification consumes every outstanding code for the email,
    // including rows written by older versions that allowed overlap.
    db.prepare("UPDATE otp_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
    return true;
  });
  return consume();
}

// ---------------------------------------------------------------------------
// DM Log
// ---------------------------------------------------------------------------

function deliveryClaimLeaseMs() {
  const parsed = Number.parseInt(process.env.DELIVERY_CLAIM_LEASE_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000;
}

function deliveryLeaseUntil(now = new Date()) {
  return new Date(now.getTime() + deliveryClaimLeaseMs()).toISOString();
}

function canonicalDeliveryClaims(claims) {
  const canonical = new Map();
  for (const claim of claims || []) {
    const jobKey = resolveJobKey(claim?.jobKey);
    const claimToken = String(claim?.claimToken || "");
    if (!jobKey || !claimToken) continue;
    const existing = canonical.get(jobKey);
    if (existing && existing.claimToken !== claimToken) return [];
    canonical.set(jobKey, { jobKey, claimToken });
  }
  return [...canonical.values()];
}

/**
 * Atomically reserve a user/job pair before contacting Discord. The primary
 * key prevents two bot instances from sending the same notification.
 */
export function claimJobDelivery(userId, jobKey) {
  const db = getDb();
  const claim = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return false;
    const now = new Date();
    const nowIso = now.toISOString();
    const row = db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
      VALUES (?, ?, 'claimed', lower(hex(randomblob(16))), ?, ?, ?)
      ON CONFLICT(user_id, job_key) DO UPDATE SET
        status = 'claimed',
        claim_token = excluded.claim_token,
        claimed_at = excluded.claimed_at,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
      WHERE delivery_claims.status = 'failed'
         OR (delivery_claims.status = 'claimed' AND delivery_claims.lease_until <= ?)
      RETURNING claim_token
    `).get(userId, canonicalKey, nowIso, deliveryLeaseUntil(now), nowIso, nowIso);
    return row?.claim_token || null;
  });
  return withBusyRetry(() => claim.immediate());
}

/** Release a direct-send reservation after a known retryable failure. */
export function releaseJobDeliveryClaim(userId, jobKey, claimToken) {
  if (!claimToken) return false;
  const db = getDb();
  const release = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE delivery_claims
         SET status = 'failed', claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE user_id = ? AND job_key = ? AND claim_token = ?
         AND status IN ('claimed', 'sending')
    `).run(now, userId, canonicalKey, claimToken).changes === 1;
  });
  return withBusyRetry(() => release.immediate());
}

/** Durable phase boundary immediately before the external direct send. */
export function beginJobDeliverySend(userId, jobKey, claimToken) {
  if (!claimToken) return false;
  const db = getDb();
  const begin = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const now = new Date();
    return db.prepare(`
      UPDATE delivery_claims
         SET status = 'sending', lease_until = ?, updated_at = ?
       WHERE user_id = ? AND job_key = ? AND status = 'claimed'
         AND claim_token = ?
    `).run(deliveryLeaseUntil(now), now.toISOString(), userId, canonicalKey, claimToken).changes === 1;
  });
  return withBusyRetry(() => begin.immediate());
}

/** Finish work that never crossed the external-send boundary. */
export function finishJobDeliveryClaim(userId, jobKey, claimToken, status) {
  const allowed = new Set(["queued", "failed", "dm_closed", "dead_link"]);
  if (!allowed.has(status)) throw new Error(`Invalid pre-send delivery status: ${status}`);
  if (!claimToken) return false;
  const db = getDb();
  const finish = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const timestamp = new Date().toISOString();
    const changed = db.prepare(`
      UPDATE delivery_claims
         SET status = ?, claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE user_id = ? AND job_key = ? AND claim_token = ? AND status = 'claimed'
    `).run(status, timestamp, userId, canonicalKey, claimToken).changes === 1;
    return { changed, canonicalKey, timestamp };
  });
  const result = withBusyRetry(() => finish.immediate());
  if (result.changed) _bufferDeliveryLog(userId, result.canonicalKey, status, result.timestamp);
  return result.changed;
}

/** Finish a direct send from the durable sending phase and buffer its ledger row. */
export function finishJobDeliverySend(userId, jobKey, claimToken, status) {
  const allowed = new Set(["sent", "failed", "dm_closed", "dead_link", "uncertain"]);
  if (!allowed.has(status)) throw new Error(`Invalid direct delivery status: ${status}`);
  if (!claimToken) return false;
  const db = getDb();
  const finish = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const timestamp = new Date().toISOString();
    const wasUncertain = status === "sent" && Boolean(db.prepare(`
      SELECT 1 FROM delivery_claims
       WHERE user_id = ? AND job_key = ? AND claim_token = ? AND status = 'uncertain'
    `).get(userId, canonicalKey, claimToken));
    const changed = db.prepare(`
      UPDATE delivery_claims
         SET status = ?,
             claim_token = CASE WHEN ? = 'uncertain' THEN claim_token ELSE NULL END,
             lease_until = NULL, updated_at = ?
       WHERE user_id = ? AND job_key = ?
         AND claim_token = ?
         AND (status = 'sending' OR (? = 'sent' AND status = 'uncertain'))
    `).run(status, status, timestamp, userId, canonicalKey, claimToken, status).changes === 1;
    let reconciledLedger = false;
    if (changed && wasUncertain) {
      reconciledLedger = db.prepare(`
        UPDATE dm_log SET status = 'sent', sent_at = ?
         WHERE user_id = ? AND job_key = ? AND status = 'uncertain'
      `).run(timestamp, userId, canonicalKey).changes > 0;
      if (reconciledLedger) {
        db.prepare(`
          INSERT OR IGNORE INTO user_seen_jobs (user_id, job_key, status, notified_at)
          VALUES (?, ?, 'notified', ?)
        `).run(userId, canonicalKey, timestamp);
      }
    }
    return { changed, canonicalKey, timestamp, reconciledLedger };
  });
  const result = withBusyRetry(() => finish.immediate());
  if (result.changed && !result.reconciledLedger) {
    _bufferDeliveryLog(userId, result.canonicalKey, status, result.timestamp);
  }
  return result.changed;
}

/** Reserve one durable queued item before a digest/quiet-hours flush send. */
export function claimQueuedJobDelivery(userId, jobKey) {
  const db = getDb();
  const claim = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    if (!canonicalKey) return false;
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseUntil = deliveryLeaseUntil(now);
    const updated = db.prepare(`
      UPDATE delivery_claims
         SET status = 'digest_claimed', claim_token = lower(hex(randomblob(16))),
             claimed_at = ?, lease_until = ?, updated_at = ?
       WHERE user_id = ? AND job_key = ?
         AND (status = 'queued' OR (status = 'digest_claimed' AND lease_until <= ?))
      RETURNING claim_token
    `).get(nowIso, leaseUntil, nowIso, userId, canonicalKey, nowIso);
    if (updated) return updated.claim_token;

    // Compatibility for queued rows produced before delivery_claims existed.
    const row = db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
      SELECT ?, ?, 'digest_claimed', lower(hex(randomblob(16))), ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM dm_log WHERE user_id = ? AND job_key = ? AND status = 'queued'
       )
      ON CONFLICT(user_id, job_key) DO NOTHING
      RETURNING claim_token
    `).get(userId, canonicalKey, nowIso, leaseUntil, nowIso, userId, canonicalKey);
    return row?.claim_token || null;
  });
  return withBusyRetry(() => claim.immediate());
}

export function releaseQueuedJobDeliveryClaim(userId, jobKey, claimToken) {
  if (!claimToken) return false;
  const db = getDb();
  const release = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const now = new Date().toISOString();
    return db.prepare(`
      UPDATE delivery_claims
         SET status = 'queued', claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE user_id = ? AND job_key = ?
         AND claim_token = ?
         AND status IN ('digest_claimed', 'digest_sending')
    `).run(now, userId, canonicalKey, claimToken).changes === 1;
  });
  return withBusyRetry(() => release.immediate());
}

/** Atomically move every selected digest item across the pre-send boundary. */
export function beginQueuedJobDeliverySend(userId, claims) {
  const db = getDb();
  const begin = db.transaction(() => {
    const canonicalClaims = canonicalDeliveryClaims(claims);
    if (canonicalClaims.length === 0 || canonicalClaims.length !== claims.length) return false;
    const placeholders = canonicalClaims.map(() => "?").join(",");
    const canonicalKeys = canonicalClaims.map((claim) => claim.jobKey);
    const rows = db.prepare(`
      SELECT job_key, status, claim_token FROM delivery_claims
       WHERE user_id = ? AND job_key IN (${placeholders})
    `).all(userId, ...canonicalKeys);
    const wantedTokens = new Map(canonicalClaims.map((claim) => [claim.jobKey, claim.claimToken]));
    if (rows.length !== canonicalKeys.length || rows.some((row) =>
      row.status !== "digest_claimed" || row.claim_token !== wantedTokens.get(row.job_key)
    )) {
      return false;
    }
    const now = new Date();
    return db.prepare(`
      UPDATE delivery_claims
         SET status = 'digest_sending', lease_until = ?, updated_at = ?
       WHERE user_id = ? AND status = 'digest_claimed'
         AND job_key IN (${placeholders})
    `).run(deliveryLeaseUntil(now), now.toISOString(), userId, ...canonicalKeys).changes === canonicalKeys.length;
  });
  return withBusyRetry(() => begin.immediate());
}

/** Atomically finish all jobs represented by one digest summary send. */
export function finishQueuedJobDeliverySend(userId, claims, status) {
  const allowed = new Set(["sent", "queued", "dm_closed", "dead_link", "uncertain"]);
  if (!allowed.has(status)) throw new Error(`Invalid digest delivery status: ${status}`);
  const db = getDb();
  const finish = db.transaction(() => {
    const canonicalClaims = canonicalDeliveryClaims(claims);
    if (canonicalClaims.length === 0 || canonicalClaims.length !== claims.length) return false;
    const placeholders = canonicalClaims.map(() => "?").join(",");
    const canonicalKeys = canonicalClaims.map((claim) => claim.jobKey);
    const rows = db.prepare(`
      SELECT job_key, status, claim_token FROM delivery_claims
       WHERE user_id = ? AND job_key IN (${placeholders})
    `).all(userId, ...canonicalKeys);
    const wantedTokens = new Map(canonicalClaims.map((claim) => [claim.jobKey, claim.claimToken]));
    const canFinish = rows.length === canonicalKeys.length && rows.every((row) =>
      row.claim_token === wantedTokens.get(row.job_key) &&
      (row.status === "digest_sending" || (status === "sent" && row.status === "uncertain"))
    );
    if (!canFinish) return false;

    const timestamp = new Date().toISOString();
    const changed = db.prepare(`
      UPDATE delivery_claims
         SET status = ?,
             claim_token = CASE WHEN ? = 'uncertain' THEN claim_token ELSE NULL END,
             lease_until = NULL, updated_at = ?
       WHERE user_id = ?
         AND (status = 'digest_sending' OR (? = 'sent' AND status = 'uncertain'))
         AND job_key IN (${placeholders})
    `).run(status, status, timestamp, userId, status, ...canonicalKeys).changes;
    if (changed !== canonicalKeys.length) throw new Error("Digest delivery state changed concurrently");

    if (status !== "queued") {
      db.prepare(`
        UPDATE dm_log SET status = ?, sent_at = ?
         WHERE user_id = ?
           AND (status = 'queued' OR (? = 'sent' AND status = 'uncertain'))
           AND job_key IN (${placeholders})
      `).run(status, timestamp, userId, status, ...canonicalKeys);
    }
    if (status === "sent") {
      const insertSeen = db.prepare(`
        INSERT OR IGNORE INTO user_seen_jobs (user_id, job_key, status, notified_at)
        VALUES (?, ?, 'notified', ?)
      `);
      for (const canonicalKey of canonicalKeys) {
        insertSeen.run(userId, canonicalKey, timestamp);
      }
    }
    return true;
  });
  return withBusyRetry(() => finish.immediate());
}

export function finishQueuedJobDeliveryClaim(userId, jobKey, claimToken, status) {
  const allowed = new Set(["dm_closed", "dead_link"]);
  if (!allowed.has(status)) throw new Error(`Invalid pre-send queued delivery status: ${status}`);
  if (!claimToken) return false;
  const db = getDb();
  const finish = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const now = new Date().toISOString();
    const changed = db.prepare(`
      UPDATE delivery_claims
         SET status = ?, claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE user_id = ? AND job_key = ?
         AND claim_token = ?
         AND status = 'digest_claimed'
    `).run(status, now, userId, canonicalKey, claimToken).changes === 1;
    if (changed) {
      db.prepare(`
        UPDATE dm_log SET status = ?, sent_at = ?
         WHERE user_id = ? AND job_key = ? AND status = 'queued'
      `).run(status, now, userId, canonicalKey);
    }
    return changed;
  });
  return withBusyRetry(() => finish.immediate());
}

/** Recover leases left behind by a crashed process without touching terminals. */
export function recoverExpiredDeliveryClaims() {
  const db = getDb();
  const now = new Date().toISOString();
  return withBusyRetry(() => db.transaction(() => {
    const direct = db.prepare(`
      UPDATE delivery_claims
         SET status = 'failed', claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE status = 'claimed' AND lease_until <= ?
    `).run(now, now).changes;
    const queued = db.prepare(`
      UPDATE delivery_claims
         SET status = 'queued', claim_token = NULL, lease_until = NULL, updated_at = ?
       WHERE status = 'digest_claimed' AND lease_until <= ?
    `).run(now, now).changes;
    // Crossing the sending boundary means Discord may already have accepted the
    // message. Expiration can classify it as uncertain, but must never make it
    // retryable again.
    db.prepare(`
      UPDATE delivery_claims
         SET status = 'uncertain', lease_until = NULL, updated_at = ?
       WHERE status IN ('sending', 'digest_sending')
         AND (lease_until IS NULL OR lease_until <= ?)
    `).run(now, now);

    // Reconcile terminal claim state into the older ledger. This closes the
    // crash window where Discord accepted a send (or a queue claim committed)
    // but the buffered dm_log write had not reached disk yet.
    db.prepare(`
      UPDATE dm_log
         SET status = (
               SELECT dc.status FROM delivery_claims dc
                WHERE dc.user_id = dm_log.user_id AND dc.job_key = dm_log.job_key
             ),
             sent_at = (
               SELECT dc.updated_at FROM delivery_claims dc
                WHERE dc.user_id = dm_log.user_id AND dc.job_key = dm_log.job_key
             )
       WHERE status = 'queued'
         AND EXISTS (
           SELECT 1 FROM delivery_claims dc
            WHERE dc.user_id = dm_log.user_id AND dc.job_key = dm_log.job_key
              AND dc.status IN ('sent', 'dead_link', 'dm_closed', 'uncertain')
         )
    `).run();
    db.prepare(`
      INSERT INTO dm_log (user_id, job_key, status, sent_at)
      SELECT dc.user_id, dc.job_key, dc.status, dc.updated_at
        FROM delivery_claims dc
       WHERE dc.status IN ('sent', 'queued', 'dead_link', 'dm_closed', 'uncertain')
         AND NOT EXISTS (
           SELECT 1 FROM dm_log dl
            WHERE dl.user_id = dc.user_id AND dl.job_key = dc.job_key
              AND dl.status IN ('sent', 'queued', 'dead_link', 'dm_closed', 'uncertain')
         )
    `).run();
    db.prepare(`
      INSERT OR IGNORE INTO user_seen_jobs (user_id, job_key, status, notified_at)
      SELECT user_id, job_key, 'notified', updated_at
        FROM delivery_claims
       WHERE status IN ('sent', 'queued')
    `).run();
    return { direct, queued };
  })());
}

function _setDeliveryClaimStatus(userId, jobKey, status, timestamp) {
  const terminal = new Set(["sent", "queued", "dead_link", "dm_closed", "uncertain"]);
  if (!terminal.has(status) && status !== "failed") {
    return { jobKey: resolveJobKey(jobKey), accepted: false };
  }
  const db = getDb();
  const setStatus = db.transaction(() => {
    const canonicalKey = resolveJobKey(jobKey);
    const row = db.prepare(`
      INSERT INTO delivery_claims
        (user_id, job_key, status, claim_token, claimed_at, lease_until, updated_at)
      VALUES (?, ?, ?, NULL, ?, NULL, ?)
      ON CONFLICT(user_id, job_key) DO UPDATE SET
        status = CASE
          WHEN delivery_claims.status IN ('claimed', 'digest_claimed', 'uncertain', 'sending', 'digest_sending')
            THEN delivery_claims.status
          WHEN delivery_claims.status = 'sent' THEN delivery_claims.status
          WHEN excluded.status = 'sent' THEN excluded.status
          WHEN excluded.status = 'uncertain' THEN excluded.status
          WHEN delivery_claims.status IN ('dead_link', 'dm_closed') THEN delivery_claims.status
          WHEN excluded.status IN ('dead_link', 'dm_closed') THEN excluded.status
          WHEN delivery_claims.status = 'queued' AND excluded.status IN ('claimed', 'failed')
            THEN delivery_claims.status
          ELSE excluded.status
        END,
        claim_token = CASE
          WHEN delivery_claims.status IN ('claimed', 'digest_claimed', 'uncertain', 'sending', 'digest_sending')
            THEN delivery_claims.claim_token
          WHEN excluded.status = 'sent' THEN NULL
          WHEN excluded.status = 'uncertain' THEN delivery_claims.claim_token
          ELSE NULL
        END,
        lease_until = CASE
          WHEN delivery_claims.status IN ('claimed', 'digest_claimed', 'sending', 'digest_sending')
            THEN delivery_claims.lease_until
          ELSE NULL
        END,
        updated_at = CASE
          WHEN delivery_claims.status IN ('claimed', 'digest_claimed', 'uncertain', 'sending', 'digest_sending', 'sent')
            THEN delivery_claims.updated_at
          ELSE excluded.updated_at
        END
      WHERE delivery_claims.status NOT IN
        ('claimed', 'digest_claimed', 'sending', 'digest_sending', 'uncertain', 'sent')
      RETURNING status
    `).get(userId, canonicalKey, status, timestamp, timestamp);
    return { jobKey: canonicalKey, accepted: row?.status === status };
  });
  return withBusyRetry(() => setStatus.immediate());
}

/**
 * Log a DM delivery event.
 */
export function logDm(userId, jobKey, status = "sent") {
  jobKey = resolveJobKey(jobKey);
  getDb()
    .prepare(
      `INSERT INTO dm_log (user_id, job_key, status, sent_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(userId, jobKey, status, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// DM Log write-behind buffer
// ---------------------------------------------------------------------------
// Coalesces dm_log + user_seen_jobs inserts into batched transactions to
// reduce per-DM lock acquisitions during high-match bursts. A single 50-entry
// flush is one transaction instead of 50. Trades up to ~5s of dm_log
// durability (lost on crash before flush) for fewer lock collisions.
//
// Cross-session dedup safety: getMuDeliveredJobKeys reads from buffer + DB so
// a freshly-buffered key is treated as delivered even before it hits disk.

function dmLogFlushIntervalMs() {
  const v = Number.parseInt(process.env.DM_LOG_FLUSH_INTERVAL_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 5000;
}
function dmLogFlushMaxSize() {
  const v = Number.parseInt(process.env.DM_LOG_FLUSH_MAX_SIZE ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 100;
}
// 'dm_closed' = permanent recipient failure (DMs closed / bot blocked / unknown
// user): retrying cannot help, so it dedups like a delivery instead of looping.
const _DM_LOG_DEDUP_STATUSES = new Set(["sent", "queued", "dead_link", "dm_closed", "uncertain"]);

const _dmLogBuffer = [];
const _bufferedKeysByUser = new Map(); // userId -> Set<jobKey>
let _flushTimer = null;

function _addBufferedKey(userId, jobKey) {
  let set = _bufferedKeysByUser.get(userId);
  if (!set) { set = new Set(); _bufferedKeysByUser.set(userId, set); }
  set.add(jobKey);
}

function _clearBufferedKey(userId, jobKey) {
  const set = _bufferedKeysByUser.get(userId);
  if (!set) return;
  set.delete(jobKey);
  if (set.size === 0) _bufferedKeysByUser.delete(userId);
}

const _BUFFERED_STATUS_RANK = new Map([
  ["sent", 60],
  ["uncertain", 55],
  ["dm_closed", 50],
  ["dead_link", 50],
  ["queued", 40],
  ["failed", 10],
]);

function coalesceCanonicalBufferedEntries(entries) {
  const coalesced = new Map();
  for (const entry of entries) {
    const canonicalKey = resolveJobKey(entry.jobKey);
    const identity = `${entry.userId}\u0000${canonicalKey}`;
    const existing = coalesced.get(identity);
    if (!existing) {
      coalesced.set(identity, {
        ...entry,
        jobKey: canonicalKey,
        bufferedKeys: new Set([entry.jobKey, canonicalKey]),
      });
      continue;
    }

    existing.bufferedKeys.add(entry.jobKey);
    existing.bufferedKeys.add(canonicalKey);
    const existingRank = _BUFFERED_STATUS_RANK.get(existing.status) || 0;
    const incomingRank = _BUFFERED_STATUS_RANK.get(entry.status) || 0;
    if (incomingRank > existingRank ||
        (incomingRank === existingRank && entry.timestamp > existing.timestamp)) {
      existing.status = entry.status;
      existing.timestamp = entry.timestamp;
    }
  }
  return [...coalesced.values()];
}

function _dropBufferedEntriesForUser(userId) {
  for (let i = _dmLogBuffer.length - 1; i >= 0; i--) {
    if (_dmLogBuffer[i].userId === userId) _dmLogBuffer.splice(i, 1);
  }
  _bufferedKeysByUser.delete(userId);
  if (_dmLogBuffer.length === 0 && _flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

function _scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    try { flushDmLog(); }
    catch (err) { console.error(`[dm-log] Scheduled flush failed: ${err.message}`); }
  }, dmLogFlushIntervalMs());
  if (_flushTimer.unref) _flushTimer.unref();
}

function _doFlush(useRetry) {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_dmLogBuffer.length === 0) return 0;
  const db = getDb();
  const pending = _dmLogBuffer.splice(0);
  const insertUserJob = db.prepare(
    `INSERT OR IGNORE INTO user_seen_jobs (user_id, job_key, status, notified_at)
     VALUES (?, ?, 'notified', ?)`
  );
  const insertDm = db.prepare(
    `INSERT INTO dm_log (user_id, job_key, status, sent_at)
     VALUES (?, ?, ?, ?)`
  );
  // Resolve aliases inside the write transaction. If another process commits a
  // re-key after our first read, WAL rejects the snapshot upgrade and
  // withBusyRetry reruns this transaction against the new alias instead of
  // recreating an orphan under the legacy key.
  const tx = db.transaction(() => {
    const userIds = [...new Set(pending.map((entry) => entry.userId))];
    const placeholders = userIds.map(() => "?").join(",");
    const liveUsers = userIds.length > 0
      ? new Set(db.prepare(`SELECT id FROM user_profiles WHERE id IN (${placeholders})`).all(...userIds).map((row) => row.id))
      : new Set();
    const liveEntries = pending.filter((entry) => liveUsers.has(entry.userId));
    const droppedEntries = pending.filter((entry) => !liveUsers.has(entry.userId));
    const toFlush = coalesceCanonicalBufferedEntries(liveEntries);

    for (const e of toFlush) {
      // Only deliveries and queued-for-digest entries create a user-visible
      // "notified" row; failed/dead_link/dm_closed are delivery bookkeeping
      // for jobs the user never saw (they polluted /search and the tracker).
      if (e.status === "sent" || e.status === "queued") {
        insertUserJob.run(e.userId, e.jobKey, e.timestamp);
      }
      insertDm.run(e.userId, e.jobKey, e.status, e.timestamp);
    }
    return { toFlush, droppedEntries };
  });
  try {
    const { toFlush, droppedEntries } = useRetry ? withBusyRetry(() => tx()) : tx();
    if (droppedEntries.length > 0) {
      console.warn(`[dm-log] Dropped ${droppedEntries.length} buffered entries for deleted users.`);
    }
    for (const e of droppedEntries) {
      if (_DM_LOG_DEDUP_STATUSES.has(e.status)) {
        _clearBufferedKey(e.userId, e.jobKey);
        _clearBufferedKey(e.userId, resolveJobKey(e.jobKey));
      }
    }
    for (const e of toFlush) {
      if (_DM_LOG_DEDUP_STATUSES.has(e.status)) {
        for (const key of e.bufferedKeys) _clearBufferedKey(e.userId, key);
      }
    }
    return toFlush.length;
  } catch (err) {
    // Restore buffer state for a later retry (preserves original order).
    _dmLogBuffer.unshift(...pending);
    if (useRetry) _scheduleFlush();
    throw err;
  }
}

/**
 * Flush buffered dm_log entries with busy-retry. Called by timer / size trigger.
 * Returns number of entries flushed.
 */
export function flushDmLog() {
  return _doFlush(true);
}

/**
 * Synchronous flush for shutdown — no busy-retry, drops entries on failure
 * with a single log line. Bounded latency for pm2's SIGINT->SIGKILL window.
 */
export function flushDmLogSync() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_dmLogBuffer.length === 0) return 0;
  try {
    return _doFlush(false);
  } catch (err) {
    // Capture per-user counts BEFORE clearing so the operator can audit
    // which deliveries went unrecorded after shutdown.
    const droppedByUser = new Map();
    for (const e of _dmLogBuffer) {
      droppedByUser.set(e.userId, (droppedByUser.get(e.userId) || 0) + 1);
    }
    const dropped = _dmLogBuffer.length;
    const breakdown = [...droppedByUser.entries()]
      .map(([u, n]) => `user=${u}:${n}`).join(" ");
    _dmLogBuffer.length = 0;
    _bufferedKeysByUser.clear();
    console.error(`[dm-log] Shutdown flush dropped ${dropped} entries [${breakdown}]: ${err.message}`);
    return 0;
  }
}

/**
 * Records that the MU bot processed a job for a user. Buffered: actual DB
 * write happens on the next flush (every DM_LOG_FLUSH_INTERVAL_MS or when
 * the buffer reaches DM_LOG_FLUSH_MAX_SIZE). For dedup-eligible statuses
 * the (user, job) pair is tracked in memory so getMuDeliveredJobKeys
 * returns it immediately.
 */
export function recordJobDelivery(userId, jobKey, status = "sent") {
  const timestamp = new Date().toISOString();
  const result = _setDeliveryClaimStatus(userId, jobKey, status, timestamp);
  if (!result.accepted) return false;
  _bufferDeliveryLog(userId, result.jobKey, status, timestamp);
  return true;
}

function _bufferDeliveryLog(userId, jobKey, status, timestamp) {
  _dmLogBuffer.push({ userId, jobKey, status, timestamp });
  if (_DM_LOG_DEDUP_STATUSES.has(status)) _addBufferedKey(userId, jobKey);
  if (_dmLogBuffer.length >= dmLogFlushMaxSize()) {
    try { flushDmLog(); }
    catch (err) { console.error(`[dm-log] Size-triggered flush failed: ${err.message}`); }
  } else {
    _scheduleFlush();
  }
}

/** Test/introspection helper. Returns count of unflushed entries. */
export function _dmLogBufferSize() {
  return _dmLogBuffer.length;
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

function isSqliteBusy(error) {
  return error?.code?.startsWith("SQLITE_BUSY") ||
    /database is locked|SQLITE_BUSY/i.test(String(error?.message || ""));
}

export function safeLogError(sourceKey, errorMessage) {
  try {
    logError(sourceKey, errorMessage);
  } catch (error) {
    const prefix = isSqliteBusy(error) ? "DB busy while logging" : "Failed to log";
    console.error(`[multi-user-state] ${prefix} ${sourceKey}: ${error.message}`);
  }
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

// ---------------------------------------------------------------------------
// Feature flags + per-user fit check results
// ---------------------------------------------------------------------------

/**
 * DB-backed feature toggle, flipped from the /admin dashboard.
 * FAILS CLOSED: a missing row, a missing table, or any read error counts as
 * disabled, per the zero-cost hard-guard rule.
 * @param {string} key
 * @returns {boolean}
 */
export function isFeatureEnabled(key) {
  try {
    const row = getDb().prepare("SELECT enabled FROM feature_flags WHERE key = ?").get(key);
    return row ? row.enabled === 1 : false;
  } catch (err) {
    console.error(`[feature-flags] read failed for ${key}: ${err.message}`);
    return false;
  }
}

/**
 * Persist a successful fit check for (user, job). Failures never call this.
 */
export function saveFitResult(userId, jobKey, { fitScore, fitVerdict, fitScoresJson, fitAssessment }) {
  jobKey = resolveJobKey(jobKey);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE user_seen_jobs
         SET fit_score = ?, fit_verdict = ?, fit_scores_json = ?, fit_assessment = ?, fit_checked_at = ?, updated_at = ?
       WHERE user_id = ? AND job_key = ?`
    )
    .run(fitScore, fitVerdict, fitScoresJson, String(fitAssessment ?? "").slice(0, 1500), now, now, userId, jobKey);
}

/**
 * Cached fit result for (user, job); undefined when never checked.
 */
export function getFitResult(userId, jobKey) {
  jobKey = resolveJobKey(jobKey);
  return getDb()
    .prepare(
      `SELECT fit_score, fit_verdict, fit_scores_json, fit_assessment, fit_checked_at
         FROM user_seen_jobs
        WHERE user_id = ? AND job_key = ? AND fit_score IS NOT NULL`
    )
    .get(userId, jobKey);
}

/**
 * Successful checks since midnight UTC. ISO-8601 strings sort lexicographically
 * and date('now') is the UTC date, so a plain string compare is correct.
 */
export function countFitChecksToday(userId) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM user_seen_jobs WHERE user_id = ? AND fit_checked_at >= date('now')")
    .get(userId);
  return row?.n ?? 0;
}
