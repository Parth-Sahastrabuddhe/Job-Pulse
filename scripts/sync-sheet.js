#!/usr/bin/env node
/**
 * Sync Google Sheet application tracker → SQLite.
 * Runs hourly via cron. Only syncs for the admin user.
 * Full replace: deletes all sheet entries and re-inserts every row.
 * Each sheet row gets its own entry — no deduplication.
 */
import Database from "better-sqlite3";
import fs from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DB_PATH = resolve(__dirname, "../data/jobs.db");
const ENV_PATH = resolve(PROJECT_ROOT, ".env");

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const rawLine of fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const DISCORD_ID = process.env.ADMIN_DISCORD_ID;
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

  if (!DISCORD_ID) {
    console.error("ADMIN_DISCORD_ID is not set; skipping sheet sync before opening DB or fetching sheet.");
    process.exit(1);
  }

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) { console.error("Failed to fetch sheet:", res.status); process.exit(1); }
  const csv = await res.text();
  const rows = parseCSV(csv);
  const dataRows = rows.length - 1;
  console.log(`Fetched ${dataRows} rows from sheet`);

  const db = new Database(DB_PATH);
  const busyTimeoutMs = Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || "2000", 10);
  db.pragma("journal_mode = WAL");
  db.pragma(`busy_timeout = ${Number.isFinite(busyTimeoutMs) && busyTimeoutMs > 0 ? busyTimeoutMs : 2000}`);
  db.pragma("wal_autocheckpoint = 500");

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

  const deleteUserJob = db.prepare("DELETE FROM user_seen_jobs WHERE user_id = ? AND job_key = ?");
  const deleteSeenJob = db.prepare("DELETE FROM seen_jobs WHERE key = ? AND key NOT IN (SELECT job_key FROM user_seen_jobs)");

  const now = new Date().toISOString();
  const CHUNK_SIZE = Number.parseInt(process.env.SHEET_SYNC_CHUNK_SIZE || "100", 10);
  const CHUNK_DELAY_MS = Number.parseInt(process.env.SHEET_SYNC_CHUNK_DELAY_MS || "50", 10);
  let inserted = 0, skipped = 0;

  // Build the desired row set first (no DB writes yet)
  const desiredRows = [];
  const desiredKeys = new Set();
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
    const baseDate = parseDate(dateApplied);
    // Add row index as seconds offset so within-day ordering is preserved (higher row = later)
    const appliedAt = new Date(new Date(baseDate).getTime() + i * 1000).toISOString();
    const dbStatus = mapStatus(status);
    const slug = slugify(company);
    const key = `sheet:${slug}:row-${i}`;
    const id = jobId || `row-${i}`;

    desiredRows.push({ key, slug, company, id, role, cleanUrl, appliedAt, dbStatus });
    desiredKeys.add(key);
  }

  // Stale key cleanup: rows present in DB but not in current sheet snapshot
  const existingKeys = db
    .prepare("SELECT job_key FROM user_seen_jobs WHERE user_id = ? AND job_key LIKE 'sheet:%'")
    .all(user.id)
    .map((r) => r.job_key);
  const staleKeys = existingKeys.filter((k) => !desiredKeys.has(k));

  // Upsert in small transactions to release the write lock between chunks
  const upsertChunk = db.transaction((chunk) => {
    for (const r of chunk) {
      insertJob.run(r.key, r.slug, r.company, r.id, r.role, "", r.cleanUrl, r.appliedAt, now);
      insertUserJob.run(user.id, r.key, r.dbStatus, r.appliedAt, r.appliedAt, now);
      inserted++;
    }
  });

  for (let i = 0; i < desiredRows.length; i += CHUNK_SIZE) {
    upsertChunk(desiredRows.slice(i, i + CHUNK_SIZE));
    if (i + CHUNK_SIZE < desiredRows.length && CHUNK_DELAY_MS > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CHUNK_DELAY_MS);
    }
  }

  // Delete stale entries in small chunks too
  const deleteStaleChunk = db.transaction((chunk) => {
    for (const key of chunk) {
      deleteUserJob.run(user.id, key);
      deleteSeenJob.run(key);
    }
  });
  for (let i = 0; i < staleKeys.length; i += CHUNK_SIZE) {
    deleteStaleChunk(staleKeys.slice(i, i + CHUNK_SIZE));
    if (i + CHUNK_SIZE < staleKeys.length && CHUNK_DELAY_MS > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, CHUNK_DELAY_MS);
    }
  }
  if (staleKeys.length) console.log(`Removed ${staleKeys.length} stale sheet entries`);

  // Remove bot entries that duplicate a sheet entry (same company + title)
  const dupes = db.prepare(`
    DELETE FROM user_seen_jobs WHERE rowid IN (
      SELECT usj.rowid FROM user_seen_jobs usj
      JOIN seen_jobs sj ON sj.key = usj.job_key
      WHERE usj.user_id = ? AND usj.job_key NOT LIKE 'sheet:%'
      AND EXISTS (
        SELECT 1 FROM user_seen_jobs usj2
        JOIN seen_jobs sj2 ON sj2.key = usj2.job_key
        WHERE usj2.user_id = usj.user_id AND usj2.job_key LIKE 'sheet:%'
        AND sj2.source_label = sj.source_label AND sj2.title = sj.title
      )
    )
  `).run(user.id).changes;
  if (dupes) console.log(`Removed ${dupes} duplicate bot entries`);

  console.log(`Done. Inserted: ${inserted}, Skipped: ${skipped}, Stale removed: ${staleKeys.length}`);
  db.close();
}

main().catch((err) => { console.error("Sync error:", err); process.exit(1); });
