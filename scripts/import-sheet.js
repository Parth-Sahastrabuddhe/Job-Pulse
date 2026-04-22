#!/usr/bin/env node
/**
 * Import application tracker data from Google Sheet CSV into SQLite.
 * Usage: node scripts/import-sheet.js [csv-path]
 * Default CSV path: data/sheet_import.csv
 */
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../data/jobs.db");
const CSV_PATH = process.argv[2] || resolve(__dirname, "../data/sheet_import.csv");
const DISCORD_ID = process.env.ADMIN_DISCORD_ID;

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
      fields.push(current.trim());
      current = "";
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(current.trim());
      if (fields.some((f) => f)) rows.push(fields);
      fields = [];
      current = "";
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

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const user = db.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(DISCORD_ID);
if (!user) { console.error("User not found:", DISCORD_ID); process.exit(1); }
console.log("User ID:", user.id);

const csv = readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(csv);
console.log("CSV rows (including header):", rows.length);

const insertJob = db.prepare(`
  INSERT OR IGNORE INTO seen_jobs (key, source_key, source_label, id, title, location, url, first_seen_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertUserJob = db.prepare(`
  INSERT OR REPLACE INTO user_seen_jobs (user_id, job_key, status, notified_at, applied_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const now = new Date().toISOString();
let imported = 0;
let skipped = 0;

const tx = db.transaction(() => {
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
    const slug = slugify(company);
    const id = jobId || `row-${i}`;
    const key = `sheet:${slug}:${id}`;
    const appliedAt = parseDate(dateApplied);
    const dbStatus = mapStatus(status);

    insertJob.run(key, slug, company, id, role, "", cleanUrl, appliedAt, now);
    insertUserJob.run(user.id, key, dbStatus, appliedAt, appliedAt, now);
    imported++;
  }
});

tx();
console.log(`Done. Imported: ${imported}, Skipped: ${skipped}`);
db.close();
