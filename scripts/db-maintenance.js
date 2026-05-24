#!/usr/bin/env node
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, "data", "jobs.db");
const apply = process.argv.includes("--apply");

function busyTimeoutMs() {
  const parsed = Number.parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS || "2000", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2000;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma(`busy_timeout = ${busyTimeoutMs()}`);
db.pragma("wal_autocheckpoint = 500");
db.pragma("foreign_keys = ON");

function scalar(sql) {
  return db.prepare(sql).get().c;
}

function userJobStatusRankSql(expr) {
  return `CASE COALESCE(${expr}, '')
    WHEN 'offer' THEN 60
    WHEN 'rejected' THEN 55
    WHEN 'interviewing' THEN 50
    WHEN 'applied' THEN 40
    WHEN 'saved' THEN 30
    WHEN 'skipped' THEN 20
    WHEN 'notified' THEN 10
    ELSE 0
  END`;
}

function earliestIsoSql(column, excludedColumn) {
  return `CASE
    WHEN ${column} IS NULL THEN ${excludedColumn}
    WHEN ${excludedColumn} IS NULL THEN ${column}
    WHEN ${excludedColumn} < ${column} THEN ${excludedColumn}
    ELSE ${column}
  END`;
}

function latestIsoSql(column, excludedColumn) {
  return `CASE
    WHEN ${column} IS NULL THEN ${excludedColumn}
    WHEN ${excludedColumn} IS NULL THEN ${column}
    WHEN ${excludedColumn} > ${column} THEN ${excludedColumn}
    ELSE ${column}
  END`;
}

function counts() {
  return {
    orphanUserSeen: scalar(`
      SELECT COUNT(*) AS c
      FROM user_seen_jobs usj
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = usj.job_key)
    `),
    orphanDmLog: scalar(`
      SELECT COUNT(*) AS c
      FROM dm_log dl
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = dl.job_key)
    `),
    orphanJobPosts: scalar(`
      SELECT COUNT(*) AS c
      FROM job_posts jp
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = jp.job_key)
    `),
    duplicateUrlGroups: scalar(`
      SELECT COUNT(*) AS c
      FROM (
        SELECT url
        FROM seen_jobs
        WHERE url != ''
        GROUP BY url
        HAVING COUNT(*) > 1
      )
    `),
    duplicateSourceIdGroups: scalar(`
      SELECT COUNT(*) AS c
      FROM (
        SELECT source_key, id
        FROM seen_jobs
        GROUP BY source_key, id
        HAVING COUNT(*) > 1
      )
    `),
  };
}

function remapJobReferences(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return true;

  const oldPost = db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?").get(oldKey);
  const newPost = db.prepare("SELECT 1 FROM job_posts WHERE job_key = ?").get(newKey);
  if (oldPost && newPost) return false;

  db.prepare(`
    INSERT INTO user_seen_jobs
      (user_id, job_key, status, notified_at, applied_at, saved_at, save_reminder_sent, updated_at)
    SELECT user_id, ?, status, notified_at, applied_at, saved_at, save_reminder_sent, updated_at
    FROM user_seen_jobs
    WHERE job_key = ?
    ON CONFLICT(user_id, job_key) DO UPDATE SET
      status = CASE
        WHEN ${userJobStatusRankSql("excluded.status")} > ${userJobStatusRankSql("user_seen_jobs.status")}
        THEN excluded.status
        ELSE user_seen_jobs.status
      END,
      notified_at = ${earliestIsoSql("user_seen_jobs.notified_at", "excluded.notified_at")},
      applied_at = ${earliestIsoSql("user_seen_jobs.applied_at", "excluded.applied_at")},
      saved_at = ${earliestIsoSql("user_seen_jobs.saved_at", "excluded.saved_at")},
      save_reminder_sent = CASE
        WHEN COALESCE(user_seen_jobs.save_reminder_sent, 0) = 1 OR COALESCE(excluded.save_reminder_sent, 0) = 1 THEN 1
        ELSE 0
      END,
      updated_at = ${latestIsoSql("user_seen_jobs.updated_at", "excluded.updated_at")}
  `).run(newKey, oldKey);
  db.prepare("DELETE FROM user_seen_jobs WHERE job_key = ?").run(oldKey);
  db.prepare("UPDATE dm_log SET job_key = ? WHERE job_key = ?").run(newKey, oldKey);
  db.prepare("UPDATE job_posts SET job_key = ? WHERE job_key = ?").run(newKey, oldKey);
  db.prepare("DELETE FROM job_posts WHERE job_key = ?").run(oldKey);
  return true;
}

function canonicalizeDuplicateGroups(groupSql, rowSql, paramsFromGroup) {
  let removed = 0;
  let skipped = 0;
  const groups = db.prepare(groupSql).all();
  for (const group of groups) {
    const tx = db.transaction(() => {
      const rows = db.prepare(rowSql).all(...paramsFromGroup(group));
      if (rows.length <= 1) return;
      const [canonical, ...duplicates] = rows;
      for (const duplicate of duplicates) {
        if (!remapJobReferences(duplicate.key, canonical.key)) {
          skipped++;
          continue;
        }
        db.prepare("DELETE FROM seen_jobs WHERE key = ?").run(duplicate.key);
        removed++;
      }
    });
    tx();
  }
  return { removed, skipped };
}

function applyMaintenance() {
  const deleteOrphans = db.transaction(() => ({
    deletedUserSeen: db.prepare(`
      DELETE FROM user_seen_jobs
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = user_seen_jobs.job_key)
    `).run().changes,
    deletedDmLog: db.prepare(`
      DELETE FROM dm_log
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = dm_log.job_key)
    `).run().changes,
    deletedJobPosts: db.prepare(`
      DELETE FROM job_posts
      WHERE NOT EXISTS (SELECT 1 FROM seen_jobs sj WHERE sj.key = job_posts.job_key)
    `).run().changes,
  }));
  const orphanResult = deleteOrphans();

  const urlDuplicates = canonicalizeDuplicateGroups(
    `
      SELECT url
      FROM seen_jobs
      WHERE url != ''
      GROUP BY url
      HAVING COUNT(*) > 1
    `,
    `
      SELECT key
      FROM seen_jobs
      WHERE url = ?
      ORDER BY first_seen_at ASC, last_seen_at DESC, key ASC
    `,
    (group) => [group.url]
  );

  const sourceIdDuplicates = canonicalizeDuplicateGroups(
    `
      SELECT source_key, id
      FROM seen_jobs
      GROUP BY source_key, id
      HAVING COUNT(*) > 1
    `,
    `
      SELECT key
      FROM seen_jobs
      WHERE source_key = ? AND id = ?
      ORDER BY first_seen_at ASC, last_seen_at DESC, key ASC
    `,
    (group) => [group.source_key, group.id]
  );

  return {
    ...orphanResult,
    removedUrlDuplicates: urlDuplicates.removed,
    skippedUrlDuplicates: urlDuplicates.skipped,
    removedSourceIdDuplicates: sourceIdDuplicates.removed,
    skippedSourceIdDuplicates: sourceIdDuplicates.skipped,
  };
}

console.log(`[db-maintenance] Database: ${DB_PATH}`);
console.log("[db-maintenance] Before:", counts());

if (!apply) {
  console.log("[db-maintenance] Dry run only. Re-run with --apply to modify the DB.");
  db.close();
  process.exit(0);
}

const result = applyMaintenance();
console.log("[db-maintenance] Applied:", result);
console.log("[db-maintenance] After:", counts());
db.close();
