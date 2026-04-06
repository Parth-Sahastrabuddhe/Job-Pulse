#!/usr/bin/env node
/**
 * Sync Google Sheet application tracker → SQLite.
 * Runs hourly via cron. Only syncs for the admin user.
 * Full replace: deletes all sheet entries and re-inserts every row.
 * Each sheet row gets its own entry — no deduplication.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../data/jobs.db");
const DISCORD_ID = "1038422401874145372";
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1cBerym6t8Ws_SxWQCX06BbWVOCK3oQnxh9lqc8WTDVw/export?format=csv&gid=1100127803";

function parseCSV(text) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  let fields = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim()); current = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(current.trim());
      if (fields.some((f) => f)) rows.push(fields);
      fields = []; current = "";
    } else {
      current += ch;
    }
  }
  if (current || fields.length) {
    fields.push(current.trim());
    if (fields.some((f) => f)) rows.push(fields);
  }
  return rows;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  const parts = dateStr.split("/");
  if (parts.length !== 3) return new Date().toISOString();
  const [m, d, y] = parts;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString();
}

function mapStatus(s) {
  s = (s || "").toLowerCase().trim();
  if (s === "rejected") return "rejected";
  if (s === "assessment") return "interviewing";
  return "applied";
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function main() {
  console.log(`[${new Date().toISOString()}] Sheet sync starting...`);

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) { console.error("Failed to fetch sheet:", res.status); process.exit(1); }
  const csv = await res.text();
  const rows = parseCSV(csv);
  const dataRows = rows.length - 1;
  console.log(`Fetched ${dataRows} rows from sheet`);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const user = db.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(DISCORD_ID);
  if (!user) { console.error("User not found"); db.close(); process.exit(1); }

  const insertJob = db.prepare(`
    INSERT OR REPLACE INTO seen_jobs (key, source_key, source_label, id, title, location, url, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertUserJob = db.prepare(`
    INSERT OR REPLACE INTO user_seen_jobs (user_id, job_key, status, notified_at, applied_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  let inserted = 0, skipped = 0;

  const tx = db.transaction(() => {
    // Delete all existing sheet entries for admin
    const deleted = db.prepare("DELETE FROM user_seen_jobs WHERE user_id = ? AND job_key LIKE 'sheet:%'").run(user.id).changes;
    db.prepare("DELETE FROM seen_jobs WHERE key LIKE 'sheet:%' AND key NOT IN (SELECT job_key FROM user_seen_jobs)").run();
    console.log(`Cleared ${deleted} old sheet entries`);

    // Insert every row — one entry per row, keyed by row index
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const company = row[0];
      const role = row[1];
      const jobId = (row[2] || "").trim();
      const dateApplied = row[3];
      const status = row[4];
      const url = (row[6] || "").trim();

      if (!company || !role) { skipped++; continue; }

      const cleanUrl = url.startsWith("http") ? url : "";
      const appliedAt = parseDate(dateApplied);
      const dbStatus = mapStatus(status);
      const slug = slugify(company);
      const key = `sheet:${slug}:row-${i}`;
      const id = jobId || `row-${i}`;

      insertJob.run(key, slug, company, id, role, "", cleanUrl, appliedAt, now);
      insertUserJob.run(user.id, key, dbStatus, appliedAt, appliedAt, now);
      inserted++;
    }
  });

  tx();
  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}`);
  db.close();
}

main().catch((err) => { console.error("Sync error:", err); process.exit(1); });
