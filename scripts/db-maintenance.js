#!/usr/bin/env node

import Database from "better-sqlite3";
import { resolveDbFile } from "../src/db-path.js";
import {
  canonicalizeStoredStableJobKeys,
  closeDb,
  initDb,
} from "../src/state.js";

const DB_PATH = resolveDbFile();
const apply = process.argv.includes("--apply");

function busyTimeoutMs() {
  const parsed = Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || "2000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

function openInspectionDb() {
  // Inspection must not create or mutate a database when --apply is absent.
  const database = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  database.pragma(`busy_timeout = ${busyTimeoutMs()}`);
  database.pragma("foreign_keys = ON");
  return database;
}

function scalar(db, sql) {
  return db.prepare(sql).get().c;
}

function hasTable(db, table) {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table));
}

function orphanCount(db, childTable, childAlias) {
  if (!hasTable(db, childTable) || !hasTable(db, "seen_jobs")) return null;
  return scalar(db, `
    SELECT COUNT(*) AS c
      FROM ${childTable} ${childAlias}
     WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = ${childAlias}.job_key)
  `);
}

function counts(db) {
  return {
    orphanUserSeen: orphanCount(db, "user_seen_jobs", "usj"),
    orphanDmLog: orphanCount(db, "dm_log", "dl"),
    orphanJobPosts: orphanCount(db, "job_posts", "jp"),
    orphanDeliveryClaims: orphanCount(db, "delivery_claims", "dc"),
    duplicateUrlGroups: scalar(db, `
      SELECT COUNT(*) AS c FROM (
        SELECT url FROM seen_jobs
         WHERE url != ''
         GROUP BY url
        HAVING COUNT(*) > 1
      )
    `),
    duplicateStableIdentityGroups: scalar(db, `
      SELECT COUNT(*) AS c FROM (
        SELECT source_key, id FROM seen_jobs
         WHERE TRIM(source_key) != '' AND TRIM(id) != ''
         GROUP BY source_key, id
        HAVING COUNT(*) > 1
      )
    `),
  };
}

let db = openInspectionDb();
console.log(`[db-maintenance] Database: ${DB_PATH}`);
console.log("[db-maintenance] Before:", counts(db));

if (!apply) {
  console.log("[db-maintenance] Dry run only. Re-run with --apply to canonicalize stable source/ID keys.");
  console.log("[db-maintenance] Orphans and URL-only duplicates are reported but never deleted automatically.");
  db.close();
  process.exit(0);
}

// Do not maintain a second copy of the key/reference merge SQL here. The
// runtime implementation preserves delivery claims, per-user fit data,
// terminal status precedence, personal message conflicts, and durable aliases.
db.close();
db = initDb(DB_PATH);
try {
  const result = canonicalizeStoredStableJobKeys();
  console.log("[db-maintenance] Applied stable-key canonicalization:", result);
  console.log("[db-maintenance] After:", counts(db));
  console.log("[db-maintenance] Orphans and URL-only duplicates were left unchanged for manual review.");
} finally {
  closeDb();
}
