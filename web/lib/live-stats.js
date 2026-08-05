import { getDb } from "./db.js";

// The landing page must render even when the database is unavailable, so every
// reader here degrades to static fallback content instead of throwing.

const CACHE_TTL_MS = 60 * 1000;
let cache = { at: 0, value: null };

const LEVEL_LABELS = { entry: "Entry", mid: "Mid", entry_mid: "Entry-Mid" };

const FALLBACK_FEED = [
  { company: "Microsoft", role: "Software Engineer II", meta: "Atlanta · Entry-Mid", age: "2m" },
  { company: "Amazon", role: "Systems Development Engineer", meta: "Seattle · Entry", age: "8m" },
  { company: "NVIDIA", role: "Machine Learning Engineer", meta: "Remote · Mid", age: "14m" },
];

const FALLBACK_STATS = [
  { value: "190+", label: "companies watched" },
  { value: "19,000+", label: "roles processed" },
  { value: "600+", label: "new in last 24h" },
  { value: "~15 min", label: "median time to alert" },
];

function formatAge(isoString, nowMs) {
  const ms = nowMs - Date.parse(isoString);
  if (!Number.isFinite(ms) || ms < 0) return "now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatLocation(location) {
  const raw = String(location || "").trim();
  if (!raw) return "United States";
  if (/^\d+\s+locations?$/i.test(raw)) return raw;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const trimmed = parts.slice(0, 2).join(", ");
  return trimmed.length > 34 ? `${trimmed.slice(0, 33)}…` : trimmed;
}

export function getLandingSnapshot() {
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT title, source_label, location, first_seen_at, seniority_level
      FROM seen_jobs
      WHERE country_code = 'US'
        AND seniority_level IN ('entry', 'mid', 'entry_mid')
        AND role_categories LIKE '%software_engineer%'
      ORDER BY first_seen_at DESC
      LIMIT 3
    `).all();

    const feed = rows.map((row) => ({
      company: String(row.source_label || "Unknown"),
      role: String(row.title || "Software Engineer"),
      meta: `${formatLocation(row.location)} · ${LEVEL_LABELS[row.seniority_level] || "Entry-Mid"}`,
      age: formatAge(row.first_seen_at, now),
    }));
    if (feed.length < 3) throw new Error("not enough live rows");

    const companies = db.prepare("SELECT COUNT(*) AS c FROM h1b_sponsors").get().c;
    const total = db.prepare("SELECT COUNT(*) AS c FROM seen_jobs").get().c;
    const last24h = db.prepare(
      "SELECT COUNT(*) AS c FROM seen_jobs WHERE first_seen_at > datetime('now', '-1 day')"
    ).get().c;

    const lags = db.prepare(`
      SELECT (julianday(first_seen_at) - julianday(posted_at)) * 1440 AS m
      FROM seen_jobs
      WHERE posted_at IS NOT NULL AND posted_at != ''
        AND first_seen_at > datetime('now', '-14 days')
    `).all()
      .map((r) => r.m)
      .filter((m) => Number.isFinite(m) && m >= 0 && m <= 1440)
      .sort((a, b) => a - b);
    const medianLag = lags.length >= 50 ? Math.round(lags[Math.floor(lags.length / 2)]) : null;

    const newest = db.prepare("SELECT MAX(first_seen_at) AS t FROM seen_jobs").get().t;

    const stats = [
      { value: companies.toLocaleString("en-US"), label: "companies watched" },
      { value: total.toLocaleString("en-US"), label: "roles processed" },
      { value: last24h.toLocaleString("en-US"), label: "new in last 24h" },
      { value: medianLag ? `${medianLag} min` : "~15 min", label: "median time to alert" },
    ];

    const value = {
      live: true,
      feed,
      stats,
      companiesWatched: companies,
      latestMatchAge: newest ? formatAge(newest, now) : null,
    };
    cache = { at: now, value };
    return value;
  } catch {
    const value = {
      live: false,
      feed: FALLBACK_FEED,
      stats: FALLBACK_STATS,
      companiesWatched: null,
      latestMatchAge: null,
    };
    cache = { at: now, value };
    return value;
  }
}
