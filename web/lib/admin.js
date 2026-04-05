import { getDb } from "./db.js";

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
  const user = d.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(discordId);
  if (!user) return false;

  const del = d.transaction(() => {
    d.prepare("DELETE FROM user_seen_jobs WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM dm_log WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM support_tickets WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM company_suggestions WHERE user_id = ?").run(user.id);
    d.prepare("DELETE FROM user_profiles WHERE id = ?").run(user.id);
  });

  del();
  return true;
}

// --- Support Tickets ---

export function getAllTickets({ status } = {}) {
  const d = getDb();
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push("st.status = ?");
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return d.prepare(`
    SELECT st.id, st.category, st.description, st.status, st.admin_response,
           st.submitted_at, st.resolved_at,
           up.discord_username, up.first_name, up.discord_id
    FROM support_tickets st
    JOIN user_profiles up ON st.user_id = up.id
    ${where}
    ORDER BY st.submitted_at DESC
  `).all(...params);
}

export function respondToTicket(ticketId, { status, adminResponse }) {
  const d = getDb();
  const now = new Date().toISOString();
  const resolvedAt = (status === "resolved" || status === "closed") ? now : null;

  d.prepare(`
    UPDATE support_tickets
    SET status = ?, admin_response = ?, resolved_at = ?
    WHERE id = ?
  `).run(status, adminResponse || "", resolvedAt, ticketId);
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

  d.prepare(`
    UPDATE company_suggestions
    SET status = ?, admin_response = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, adminResponse || "", now, suggestionId);
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
  const recentErrors = d.prepare("SELECT * FROM error_log ORDER BY occurred_at DESC LIMIT 20").all();

  return {
    totalUsers,
    activeUsers,
    totalJobs,
    jobsToday,
    dmsSent,
    dmsFailed,
    openTickets,
    pendingSuggestions,
    recentErrors,
  };
}
