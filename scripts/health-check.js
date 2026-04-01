/**
 * JobPulse Health Check — runs every 12 hours via cron
 * Checks: bot process, DB integrity, collector health, country filter, description fetchers
 * Outputs: JSON report to data/health-logs/{timestamp}.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(PROJECT_ROOT, "data", "jobs.db");
const LOG_DIR = path.join(PROJECT_ROOT, "data", "health-logs");

// Load .env so DISCORD_WEBHOOK_URL is available when run via cron
const envFile = path.join(PROJECT_ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

fs.mkdirSync(LOG_DIR, { recursive: true });

const report = {
  timestamp: new Date().toISOString(),
  status: "PASS",
  checks: [],
  warnings: [],
  errors: []
};

function check(name, fn) {
  try {
    const result = fn();
    report.checks.push({ name, status: "PASS", ...result });
  } catch (e) {
    report.checks.push({ name, status: "FAIL", error: e.message });
    report.errors.push(`${name}: ${e.message}`);
    report.status = "FAIL";
  }
}

// --- Check 0: pm2 process status ---
check("Bot process running", () => {
  try {
    const pm2Out = execSync("pm2 jlist 2>/dev/null", { encoding: "utf8" });
    const procs = JSON.parse(pm2Out);
    const bot = procs.find(p => p.name === "jobpulse");
    if (!bot) {
      throw new Error("jobpulse process not found in pm2");
    }
    if (bot.pm2_env.status !== "online") {
      throw new Error(`jobpulse status is "${bot.pm2_env.status}" (not online)`);
    }
    const restarts = bot.pm2_env.restart_time || 0;
    if (restarts > 5) {
      report.warnings.push(`jobpulse has restarted ${restarts} times — possible crash loop`);
    }
    return { status: bot.pm2_env.status, restarts, uptime: bot.pm2_env.pm_uptime };
  } catch (e) {
    if (e.message.includes("jobpulse")) throw e;
    // pm2 not available (e.g. running locally) — skip
    return { status: "skipped", reason: "pm2 not available" };
  }
});

// --- Check 1: Database exists and is readable ---
check("Database accessible", () => {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT COUNT(*) as cnt FROM seen_jobs").get();
  db.close();
  return { jobs: row.cnt };
});

// --- Check 2: Jobs being collected recently ---
check("Recent job collection", () => {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT MAX(last_seen_at) as latest FROM seen_jobs").get();
  db.close();
  const latest = new Date(row.latest);
  const ageMinutes = (Date.now() - latest.getTime()) / 60000;
  if (ageMinutes > 30) {
    report.warnings.push(`Last job collection was ${Math.round(ageMinutes)} minutes ago`);
  }
  return { latestJob: row.latest, ageMinutes: Math.round(ageMinutes) };
});

// --- Check 3: Company coverage ---
check("Company coverage", () => {
  const db = new Database(DB_PATH, { readonly: true });
  const sources = db.prepare("SELECT DISTINCT source_key FROM seen_jobs").all();
  const recentSources = db.prepare(
    "SELECT DISTINCT source_key FROM seen_jobs WHERE last_seen_at > datetime('now', '-24 hours')"
  ).all();
  db.close();

  const total = sources.length;
  const active24h = recentSources.length;

  if (active24h < total * 0.5) {
    report.warnings.push(`Only ${active24h}/${total} companies active in last 24h`);
  }

  return { totalCompanies: total, active24h };
});

// --- Check 4: Duplicate detection ---
check("Duplicate notifications", () => {
  const db = new Database(DB_PATH, { readonly: true });

  // Check for jobs with same title+source posted within 1 hour of each other
  const dupes = db.prepare(`
    SELECT source_label, title, COUNT(*) as cnt
    FROM seen_jobs
    WHERE first_seen_at > datetime('now', '-24 hours')
    GROUP BY source_key, title
    HAVING COUNT(*) > 1
  `).all();

  db.close();

  if (dupes.length > 0) {
    report.warnings.push(`${dupes.length} potential duplicate job titles in last 24h`);
  }

  return { duplicateTitles: dupes.length, details: dupes.slice(0, 5) };
});

// --- Check 5: Non-US jobs leaking through ---
check("Country filter integrity", () => {
  const db = new Database(DB_PATH, { readonly: true });

  // Check 5a: Jobs explicitly tagged NON-US that were notified
  const nonUS = db.prepare(`
    SELECT source_label, title, location, country_code
    FROM seen_jobs
    WHERE first_seen_at > datetime('now', '-24 hours')
    AND country_code = 'NON-US'
    AND key IN (SELECT job_key FROM job_posts)
  `).all();

  // Check 5b: Jobs tagged US but with clearly non-US location text (e.g. Visa India bug)
  const NON_US_KEYWORDS = ['India', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Mumbai', 'Pune',
    'Chennai', 'Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'London', 'Berlin', 'Tokyo',
    'Singapore', 'Toronto', 'Sydney', 'Amsterdam', 'Dublin', 'INDIA', 'CANADA'];
  const likeClause = NON_US_KEYWORDS.map(() => "location LIKE ?").join(" OR ");
  const likeParams = NON_US_KEYWORDS.map(k => `%${k}%`);

  const mistagged = db.prepare(`
    SELECT source_label, title, location, country_code
    FROM seen_jobs
    WHERE first_seen_at > datetime('now', '-24 hours')
    AND country_code = 'US'
    AND (${likeClause})
  `).all(...likeParams);

  db.close();

  if (nonUS.length > 0) {
    report.errors.push(`${nonUS.length} non-US jobs were notified!`);
    report.status = "FAIL";
  }
  if (mistagged.length > 0) {
    report.errors.push(`${mistagged.length} jobs tagged US but have non-US locations!`);
    report.status = "FAIL";
  }

  return {
    nonUSNotified: nonUS.length,
    mistaggedUS: mistagged.length,
    details: [...nonUS, ...mistagged].slice(0, 5)
  };
});

// --- Check 6: Database size ---
check("Database size", () => {
  const stats = fs.statSync(DB_PATH);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

  if (parseFloat(sizeMB) > 500) {
    report.warnings.push(`Database is ${sizeMB}MB — consider pruning`);
  }

  return { sizeMB: parseFloat(sizeMB) };
});

// --- Check 7: Job posts vs seen jobs ratio ---
check("Notification ratio", () => {
  const db = new Database(DB_PATH, { readonly: true });

  const seen24h = db.prepare(
    "SELECT COUNT(*) as cnt FROM seen_jobs WHERE first_seen_at > datetime('now', '-24 hours')"
  ).get();
  const notified24h = db.prepare(
    "SELECT COUNT(*) as cnt FROM job_posts WHERE job_key IN (SELECT key FROM seen_jobs WHERE first_seen_at > datetime('now', '-24 hours'))"
  ).get();

  db.close();

  return {
    newJobs24h: seen24h.cnt,
    notified24h: notified24h.cnt,
    ratio: seen24h.cnt > 0 ? (notified24h.cnt / seen24h.cnt * 100).toFixed(1) + "%" : "N/A"
  };
});

// --- Check 8: Stale companies (no jobs in 7 days) ---
check("Stale companies", () => {
  const db = new Database(DB_PATH, { readonly: true });

  const stale = db.prepare(`
    SELECT source_label, MAX(last_seen_at) as last_seen
    FROM seen_jobs
    GROUP BY source_key
    HAVING MAX(last_seen_at) < datetime('now', '-7 days')
    ORDER BY last_seen
  `).all();

  db.close();

  if (stale.length > 0) {
    report.warnings.push(`${stale.length} companies have no new jobs in 7+ days`);
  }

  return { staleCompanies: stale.length, details: stale.slice(0, 10) };
});

// --- Send Discord alert if FAIL or warnings ---
async function sendDiscordAlert(report) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;
  // Only alert on failures or warnings, not clean passes
  if (report.status === "PASS" && report.warnings.length === 0) return;

  const emoji = report.status === "FAIL" ? "\u274c" : "\u26a0\ufe0f";
  const lines = [`${emoji} **JobPulse Health Check — ${report.status}**`];

  for (const err of report.errors) lines.push(`  \u2022 ${err}`);
  for (const warn of report.warnings) lines.push(`  \u2022 ${warn}`);

  const body = JSON.stringify({ content: lines.join("\n") });
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
  } catch (e) {
    console.error(`Failed to send Discord alert: ${e.message}`);
  }
}

// --- Write report ---
const filename = `health-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const filepath = path.join(LOG_DIR, filename);
fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

// --- Console summary ---
console.log(`\n=== JobPulse Health Check — ${report.timestamp} ===`);
console.log(`Status: ${report.status}`);
console.log(`Checks: ${report.checks.filter(c => c.status === "PASS").length}/${report.checks.length} passed`);

if (report.warnings.length > 0) {
  console.log(`\nWarnings (${report.warnings.length}):`);
  report.warnings.forEach(w => console.log(`  \u26a0 ${w}`));
}

if (report.errors.length > 0) {
  console.log(`\nErrors (${report.errors.length}):`);
  report.errors.forEach(e => console.log(`  \u2717 ${e}`));
}

console.log(`\nReport saved to: ${filepath}`);

await sendDiscordAlert(report);

// Prune old health logs (keep last 30 days)
const files = fs.readdirSync(LOG_DIR).sort();
const cutoff = 60; // keep 60 reports (30 days at 2/day)
if (files.length > cutoff) {
  files.slice(0, files.length - cutoff).forEach(f => {
    fs.unlinkSync(path.join(LOG_DIR, f));
  });
}

process.exit(report.status === "PASS" ? 0 : 1);
