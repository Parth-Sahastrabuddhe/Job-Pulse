import { getDb } from "./db.js";

function explainOperationalError(row) {
  const text = `${row.source_key || ""} ${row.error_message || ""}`.toLowerCase();
  const classified = [
    [/database is locked|sqlite_busy/, "Database contention", "warning", "SQLite was busy while another process was writing.", "Retry the operation. If it repeats, inspect overlapping collector runs and database write volume."],
    [/429|rate.?limit|too many requests/, "Upstream rate limit", "warning", "A job source temporarily rejected requests because its request limit was reached.", "Let the configured backoff retry. If frequent, reduce that collector's polling rate."],
    [/401|403|unauthori[sz]ed|forbidden|invalid token/, "Access or credentials", "error", "A source or service rejected the credentials or permissions being used.", "Verify the relevant API token, account access, and environment configuration."],
    [/timeout|etimedout|aborterror|timed out/, "Network timeout", "warning", "A source did not respond before the request deadline.", "Retry the source and check EC2 network access. Raise the timeout only if the source is consistently slow."],
    [/enotfound|eai_again|dns|econnrefused|socket hang up/, "Network or DNS", "error", "The service could not connect to the source host.", "Check DNS resolution, the source URL, and whether the upstream service is online."],
    [/selector|playwright|browser|locator/, "Scraper changed", "error", "A browser-based collector likely no longer matches the source page.", "Open the source page and update its selectors or consent/navigation handling."],
    [/all .*collectors.*failed|fast lane failed/, "Collector lane outage", "critical", "Every collector named in this health-check lane failed.", "Open the technical details, test each named source, and compare their individual runtime logs."],
    [/discord.*(closed|cannot send|missing access)|dm-closed/, "Discord delivery", "warning", "Discord could not deliver a job alert to a user or channel.", "Check bot channel permissions and whether the user still accepts direct messages."],
  ].find(([pattern]) => pattern.test(text));

  const [, category, severity, summary, suggestedAction] = classified || [
    null,
    row.category && row.category !== "unclassified" ? row.category : "Unclassified",
    row.severity || "error",
    "A collector or service reported a failure that has not been classified yet.",
    "Expand the technical details and compare the timestamp with the runtime logs below.",
  ];
  return { ...row, category, severity, summary, suggestedAction, technicalDetails: row.error_message || "No message recorded." };
}

// --- Users ---

export function getAllUsers({ search, status } = {}) {
  const d = getDb();
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push("(up.discord_username LIKE ? OR up.first_name LIKE ? OR up.email LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  if (status === "active") {
    conditions.push("up.is_active = 1");
  } else if (status === "paused") {
    conditions.push("up.is_active = 0");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return d.prepare(`
    SELECT up.discord_id, up.discord_username, up.first_name, up.email,
           up.role_categories, up.seniority_levels, up.role, up.is_active,
           up.requires_sponsorship, up.created_at, up.updated_at
    FROM user_profiles up
    ${where}
    ORDER BY up.created_at DESC
  `).all(...params);
}

export function deleteUser(discordId) {
  const d = getDb();
  const user = d.prepare("SELECT id, email FROM user_profiles WHERE discord_id = ?").get(discordId);
  if (!user) return false;

  const del = d.transaction(() => {
    const addressTable = d.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_addresses'"
    ).get();
    const deliveryClaimsTable = d.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'delivery_claims'"
    ).get();
    if (addressTable) d.prepare("DELETE FROM user_addresses WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM user_seen_jobs WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM dm_log WHERE user_id = ?").run(user.id);
    // Older production schemas did not declare ON DELETE CASCADE here.
    if (deliveryClaimsTable) d.prepare("DELETE FROM delivery_claims WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM support_tickets WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM company_suggestions WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM otp_codes WHERE email = ?").run(user.email);
    d.prepare("DELETE FROM user_profiles WHERE id = ?").run(user.id);
  });

  del();
  return true;
}

// --- Support Tickets ---

// Member tickets and signed-out visitor requests share one queue. Visitor rows
// come back with a NEGATIVE id and username "visitor", so the admin UI and the
// respond flow keep working unchanged; respondToTicket routes negative ids to
// the public table.
export function getAllTickets({ status } = {}) {
  const d = getDb();
  const memberWhere = status ? "WHERE st.status = ?" : "";
  const publicWhere = status ? "WHERE pr.status = ?" : "";
  const params = status ? [status, status] : [];

  return d.prepare(`
    SELECT st.id AS id, st.category, st.description, st.status, st.admin_response,
           st.submitted_at, st.resolved_at,
           up.discord_username, up.first_name, up.discord_id
    FROM support_tickets st
    JOIN user_profiles up ON st.user_id = up.id
    ${memberWhere}
    UNION ALL
    SELECT -pr.id AS id, pr.category, pr.description, pr.status, pr.admin_response,
           pr.submitted_at, pr.resolved_at,
           COALESCE(NULLIF(pr.email, ''), 'visitor') AS discord_username,
           '' AS first_name, '' AS discord_id
    FROM public_support_requests pr
    ${publicWhere}
    ORDER BY submitted_at DESC
  `).all(...params);
}

export function respondToTicket(ticketId, { status, adminResponse }) {
  const d = getDb();
  const now = new Date().toISOString();
  const resolvedAt = (status === "resolved" || status === "closed") ? now : null;

  const table = ticketId < 0 ? "public_support_requests" : "support_tickets";
  const rowId = Math.abs(ticketId);
  const result = d.prepare(`
    UPDATE ${table}
    SET status = ?, admin_response = ?, resolved_at = ?
    WHERE id = ?
  `).run(status, adminResponse || "", resolvedAt, rowId);
  return result.changes === 1;
}

// --- Company Suggestions ---

export function getAllSuggestions({ status } = {}) {
  const d = getDb();
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("cs.status = ?");
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return d.prepare(`
    SELECT cs.id, cs.company_name, cs.careers_url, cs.reason, cs.status,
           cs.admin_response, cs.submitted_at, cs.reviewed_at,
           up.discord_username, up.first_name, up.discord_id
    FROM company_suggestions cs
    JOIN user_profiles up ON cs.user_id = up.id
    ${where}
    ORDER BY cs.submitted_at DESC
  `).all(...params);
}

export function respondToSuggestion(suggestionId, { status, adminResponse }) {
  const d = getDb();
  const now = new Date().toISOString();

  const result = d.prepare(`
    UPDATE company_suggestions
    SET status = ?, admin_response = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, adminResponse || "", now, suggestionId);
  return result.changes === 1;
}

// --- System Health ---

export function getSystemHealth() {
  const d = getDb();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const totalUsers = d.prepare("SELECT COUNT(*) as count FROM user_profiles").get().count;
  const activeUsers = d.prepare("SELECT COUNT(*) as count FROM user_profiles WHERE is_active = 1").get().count;
  const totalJobs = d.prepare("SELECT COUNT(*) as count FROM seen_jobs").get().count;
  const jobsToday = d.prepare("SELECT COUNT(*) as count FROM seen_jobs WHERE first_seen_at >= ?").get(todayStart).count;
  const dmsSent = d.prepare("SELECT COUNT(*) as count FROM dm_log WHERE status = 'sent' AND sent_at >= ?").get(since24h).count;
  const dmsFailed = d.prepare("SELECT COUNT(*) as count FROM dm_log WHERE status = 'failed' AND sent_at >= ?").get(since24h).count;
  const openTickets = d.prepare("SELECT COUNT(*) as count FROM support_tickets WHERE status = 'open'").get().count;
  const pendingSuggestions = d.prepare("SELECT COUNT(*) as count FROM company_suggestions WHERE status = 'pending'").get().count;
  const rawErrors = d.prepare("SELECT * FROM error_log ORDER BY occurred_at DESC LIMIT 100").all();
  const groupedErrors = new Map();
  for (const row of rawErrors) {
    const key = `${row.source_key || "unknown"}\u0000${row.error_message || ""}`;
    const existing = groupedErrors.get(key);
    if (existing) {
      existing.occurrences += 1;
      existing.firstSeen = row.occurred_at;
    } else {
      groupedErrors.set(key, { ...row, occurrences: 1, firstSeen: row.occurred_at, lastSeen: row.occurred_at });
    }
  }
  const recentErrors = [...groupedErrors.values()].slice(0, 20).map(explainOperationalError);
  // Aggregate only: delivery claims are operational state and must not expose
  // per-user/job details through the health endpoint.
  const deliveryClaimsTable = d.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'delivery_claims'"
  ).get();
  const muDeliveryClaims = deliveryClaimsTable
    ? d.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('sending', 'digest_sending')
                             AND lease_until > ? THEN 1 ELSE 0 END), 0) AS inFlight,
          COALESCE(SUM(CASE WHEN status IN ('sending', 'digest_sending')
                             AND (lease_until IS NULL OR lease_until <= ?) THEN 1 ELSE 0 END), 0) AS staleInFlight,
          COALESCE(SUM(CASE WHEN status = 'uncertain' THEN 1 ELSE 0 END), 0) AS uncertain
          FROM delivery_claims
      `).get(now.toISOString(), now.toISOString())
    : { inFlight: 0, staleInFlight: 0, uncertain: 0 };

  return {
    totalUsers,
    activeUsers,
    totalJobs,
    jobsToday,
    dmsSent,
    dmsFailed,
    openTickets,
    pendingSuggestions,
    muDeliveryClaims,
    recentErrors,
  };
}
