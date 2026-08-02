#!/usr/bin/env node

/**
 * Owner-only reconciliation for ambiguous personal notification sends.
 *
 * The filesystem permissions on the private SQLite database are the access
 * boundary. Do not expose this command through the public web application.
 */

import Database from "better-sqlite3";
import { resolveDbFile } from "../src/db-path.js";
import {
  closeDb,
  initDb,
  recordExternalDelivery,
  releasePersonalDeliveryClaim,
  upsertJobPost,
} from "../src/state.js";

const DB_PATH = resolveDbFile();
const [command = "list", ...args] = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function has(name) {
  return args.includes(name);
}

function usage(exitCode = 1) {
  console.error(`Usage:
  npm run delivery:claims -- list [--older-than-minutes 60]
  npm run delivery:claims -- release --job-key KEY --claim-token TOKEN --confirm-not-delivered
  npm run delivery:claims -- finalize --job-key KEY --claim-token TOKEN --channel-id CHANNEL --confirm-delivered [--message-id DISCORD_MESSAGE_ID]

Before release/finalize, verify the provider manually. Ambiguous sends must not
be retried automatically because the original message may have been accepted.`);
  process.exit(exitCode);
}

function requireNonEmpty(name) {
  const value = String(option(name) || "").trim();
  if (!value) usage();
  return value;
}

function listClaims() {
  const olderRaw = option("--older-than-minutes");
  const olderMinutes = olderRaw === undefined ? null : Number(olderRaw);
  if (olderMinutes !== null && (!Number.isFinite(olderMinutes) || olderMinutes < 0)) usage();

  const database = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const columns = new Set(database.pragma("table_info(job_posts)").map((column) => column.name));
    if (!columns.has("delivery_claim_token") || !columns.has("delivery_claimed_at")) {
      throw new Error("The delivery-claim schema has not been migrated; start the private bot once first");
    }
    const cutoff = olderMinutes === null
      ? null
      : new Date(Date.now() - olderMinutes * 60 * 1000).toISOString();
    const rows = database.prepare(`
      SELECT jp.job_key AS jobKey,
             jp.channel_id AS channelId,
             jp.delivery_claim_token AS claimToken,
             jp.delivery_claimed_at AS claimedAt,
             sj.source_label AS sourceLabel,
             sj.title AS title
        FROM job_posts jp
        LEFT JOIN seen_jobs sj ON sj.key = jp.job_key
       WHERE jp.status = 'delivery_claimed'
         AND (? IS NULL OR jp.delivery_claimed_at IS NULL OR jp.delivery_claimed_at <= ?)
       ORDER BY jp.delivery_claimed_at ASC, jp.job_key ASC
    `).all(cutoff, cutoff);
    console.log(JSON.stringify({ database: DB_PATH, unresolved: rows.length, claims: rows }, null, 2));
  } finally {
    database.close();
  }
}

function mutateClaim() {
  const jobKey = requireNonEmpty("--job-key");
  const claimToken = requireNonEmpty("--claim-token");
  let changed = false;

  initDb(DB_PATH);
  try {
    if (command === "release") {
      if (!has("--confirm-not-delivered")) usage();
      changed = releasePersonalDeliveryClaim(jobKey, claimToken);
    } else if (command === "finalize") {
      if (!has("--confirm-delivered")) usage();
      const channelId = requireNonEmpty("--channel-id");
      const messageId = String(option("--message-id") || "").trim();
      changed = messageId
        ? upsertJobPost(jobKey, messageId, null, channelId, claimToken)
        : recordExternalDelivery(jobKey, channelId, claimToken);
    } else {
      usage();
    }
  } finally {
    closeDb();
  }

  if (!changed) {
    throw new Error("No matching owned claim was changed; refresh the list and verify its token");
  }
  console.log(`${command} completed for ${jobKey}`);
}

try {
  if (command === "list") listClaims();
  else mutateClaim();
} catch (error) {
  console.error(`[delivery-claims] ${error.message}`);
  process.exitCode = 1;
}
