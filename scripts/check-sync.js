#!/usr/bin/env node
/**
 * Diagnostic: compare Google Sheet rows to user_seen_jobs entries for admin.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../data/jobs.db");
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
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts;
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d)).toISOString();
}

async function main() {
  const res = await fetch(SHEET_CSV_URL);
  const csv = await res.text();
  const rows = parseCSV(csv);
  console.log("Sheet rows (excl header):", rows.length - 1);

  const db = new Database(DB_PATH);
  const user = db.prepare("SELECT id FROM user_profiles WHERE discord_id = ?").get(DISCORD_ID);

  const findExisting = db.prepare(`
    SELECT usj.job_key, usj.status, usj.notified_at, usj.applied_at
    FROM user_seen_jobs usj
    JOIN seen_jobs sj ON usj.job_key = sj.key
    WHERE usj.user_id = ? AND sj.source_label = ? AND sj.title = ?
      AND usj.notified_at LIKE ?
  `);

  let missing = 0, matchedBot = 0, matchedSheet = 0, wrongDate = 0;
  const sampleMissing = [];
  const sampleWrongDate = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const company = row[0], role = row[1], dateApplied = row[3];
    if (!company || !role) continue;

    const appliedAt = parseDate(dateApplied);
    const datePrefix = appliedAt ? appliedAt.slice(0, 10) : "";

    const existing = findExisting.get(user.id, company, role, `${datePrefix}%`);
    if (!existing) {
      missing++;
      if (sampleMissing.length < 10) sampleMissing.push({ i, company, role, date: dateApplied });
    } else {
      if (existing.job_key.startsWith("sheet:")) matchedSheet++;
      else matchedBot++;

      // Check date accuracy
      const dbDate = existing.applied_at || existing.notified_at;
      if (appliedAt && dbDate && dbDate.slice(0, 10) !== appliedAt.slice(0, 10)) {
        wrongDate++;
        if (sampleWrongDate.length < 5) {
          sampleWrongDate.push({ company, role, sheetDate: dateApplied, dbDate: dbDate.slice(0, 10) });
        }
      }
    }
  }

  console.log("\n--- Results ---");
  console.log("Matched (sheet key):", matchedSheet);
  console.log("Matched (bot key):", matchedBot);
  console.log("Missing from DB:", missing);
  console.log("Wrong dates:", wrongDate);
  if (sampleMissing.length) {
    console.log("\nSample missing entries:");
    sampleMissing.forEach((m) => console.log(`  Row ${m.i}: ${m.company} | ${m.role} | ${m.date}`));
  }
  if (sampleWrongDate.length) {
    console.log("\nSample wrong dates:");
    sampleWrongDate.forEach((d) => console.log(`  ${d.company} | ${d.role} | sheet: ${d.sheetDate} → db: ${d.dbDate}`));
  }

  db.close();
}

main().catch(console.error);
