/**
 * multi-user.js — Entry point for the multi-user JobPulse bot.
 *
 * Separate Discord process (uses MULTI_USER_BOT_TOKEN).
 * Polls seen_jobs, filters per-user, delivers DMs, handles button interactions
 * and /search slash command.
 */

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, getDb, closeDb, cleanupExpiredOtps } from "./state.js";
import {
  getActiveUsers,
  getUserSeenJobKeys,
  markJobNotified,
  updateJobStatus,
  logDm,
  isH1bSponsor,
  getUserProfile,
  searchUserJobs,
  logError,
} from "./multi-user-state.js";
import { filterJobsForUser } from "./user-filter.js";
import { jobIsFresh } from "./sources/shared.js";
import { getDeliveryAction, shouldDeliverDigest, isInQuietHours } from "./mu-scheduler.js";
import { sendJobDm, sendDigestDm, jobButtonHash, buildDmButtons } from "./mu-delivery.js";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

/** Load .env file the same way config.js does — no dotenv dependency. */
function loadEnvFile(envFilePath = path.join(PROJECT_ROOT, ".env")) {
  if (!fs.existsSync(envFilePath)) return;

  const content = fs.readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

// ─────────────────────────────────────────────────────────────────────────────
// DB
// ─────────────────────────────────────────────────────────────────────────────

initDb(path.join(PROJECT_ROOT, "data", "jobs.db"));

// ─────────────────────────────────────────────────────────────────────────────
// Discord client
// ─────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [1], // Channel partial required for DM interactions
});

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let running = true;
/** ISO timestamp — only jobs first_seen_at after this are considered new. */
let lastPollAt = new Date().toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: find job key from a short button hash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a 16-char button hash and a userId, scan user_seen_jobs to find the
 * matching job key by recomputing SHA1 on each key.
 *
 * @param {string} hash
 * @param {number} userId
 * @returns {string|null}
 */
function findJobKeyByHash(hash, userId) {
  const db = getDb();
  const rows = db
    .prepare("SELECT job_key FROM user_seen_jobs WHERE user_id = ?")
    .all(userId);

  for (const row of rows) {
    if (jobButtonHash(row.job_key) === hash) {
      return row.job_key;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// /search command definition
// ─────────────────────────────────────────────────────────────────────────────

const searchCommand = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search your job notifications")
  .addStringOption((opt) =>
    opt.setName("query").setDescription("Search by title, company, or location")
  )
  .addStringOption((opt) =>
    opt.setName("company").setDescription("Filter by company key")
  )
  .addStringOption((opt) =>
    opt
      .setName("status")
      .setDescription("Filter by status")
      .addChoices(
        { name: "Applied",      value: "applied"      },
        { name: "Skipped",      value: "skipped"      },
        { name: "Interviewing", value: "interviewing" },
        { name: "Offer",        value: "offer"        },
        { name: "Rejected",     value: "rejected"     }
      )
  )
  .addIntegerOption((opt) =>
    opt.setName("days").setDescription("Look back N days (default: 30)")
  );

// ─────────────────────────────────────────────────────────────────────────────
// /search handler
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_EMOJI = {
  notified:     "🔔",
  applied:      "✅",
  skipped:      "❌",
  interviewing: "💬",
  offer:        "🎉",
  rejected:     "🚫",
};

const PAGE_SIZE = 5;

/**
 * Encode search params + offset into a base64 string for pagination buttons.
 * @param {object} params
 * @returns {string}
 */
function encodeSearchState(params) {
  return Buffer.from(JSON.stringify(params)).toString("base64");
}

/**
 * Decode search params from a base64 string.
 * @param {string} encoded
 * @returns {object}
 */
function decodeSearchState(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * Build a search results embed with Prev/Next pagination buttons.
 *
 * @param {object} profile
 * @param {{ query?, company?, status?, days?, offset? }} searchParams
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[] }}
 */
function buildSearchResponse(profile, searchParams) {
  const { query, company, status, days = 30, offset = 0 } = searchParams;

  const { results, total } = searchUserJobs(profile.id, {
    query,
    company,
    status,
    days,
    limit: PAGE_SIZE,
    offset,
  });

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const lines = results.map((job, i) => {
    const emoji    = STATUS_EMOJI[job.status] ?? "•";
    const company_ = job.source_label ?? "Unknown";
    const title    = job.title        ?? "Untitled";
    const url      = job.url          ?? "";
    const num      = offset + i + 1;
    const link     = url ? `[${title}](${url})` : title;
    return `${num}. ${emoji} ${link} — **${company_}**`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`Job Search Results (${total} total)`)
    .setDescription(
      lines.length > 0
        ? lines.join("\n")
        : "No matching jobs found."
    )
    .setFooter({ text: `Page ${currentPage} of ${totalPages}` })
    .setColor(0x5865F2);

  const components = [];

  if (total > PAGE_SIZE) {
    const hasPrev = offset > 0;
    const hasNext = offset + PAGE_SIZE < total;

    const prevState = encodeSearchState({ query, company, status, days, offset: Math.max(0, offset - PAGE_SIZE) });
    const nextState = encodeSearchState({ query, company, status, days, offset: offset + PAGE_SIZE });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_search:${prevState}`)
        .setLabel("◀ Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasPrev),
      new ButtonBuilder()
        .setCustomId(`mu_search:${nextState}`)
        .setLabel("Next ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasNext)
    );
    components.push(row);
  }

  return { embeds: [embed], components };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction handler
// ─────────────────────────────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  try {
    // ── /search slash command ──────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === "search") {
      await interaction.deferReply({ ephemeral: true });

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.editReply({ content: "You don't have a profile yet. Please sign up first." });
        return;
      }

      const searchParams = {
        query:   interaction.options.getString("query")   ?? undefined,
        company: interaction.options.getString("company") ?? undefined,
        status:  interaction.options.getString("status")  ?? undefined,
        days:    interaction.options.getInteger("days")   ?? 30,
        offset:  0,
      };

      const response = buildSearchResponse(profile, searchParams);
      await interaction.editReply(response);
      return;
    }

    // ── Button interactions ────────────────────────────────────────────────
    if (!interaction.isButton()) return;

    const colonIdx = interaction.customId.indexOf(":");
    if (colonIdx === -1) return;

    const action  = interaction.customId.slice(0, colonIdx);
    const payload = interaction.customId.slice(colonIdx + 1);

    // Only handle mu_ prefixed buttons
    if (!action.startsWith("mu_")) return;

    // ── mu_applied / mu_skip ──────────────────────────────────────────────
    if (action === "mu_applied" || action === "mu_skip") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const hash   = payload;
      const jobKey = findJobKeyByHash(hash, profile.id);
      if (!jobKey) {
        await interaction.followUp({ content: "Job not found.", ephemeral: true });
        return;
      }

      const newStatus = action === "mu_applied" ? "applied" : "skipped";
      updateJobStatus(profile.id, jobKey, newStatus);

      // Fetch job URL to rebuild buttons
      const db  = getDb();
      const row = db.prepare("SELECT url FROM seen_jobs WHERE key = ?").get(jobKey);
      const jobUrl = row?.url ?? "";

      const updatedButtons = buildDmButtons(hash, jobUrl, newStatus);
      await interaction.editReply({ components: updatedButtons });
      return;
    }

    // ── mu_search pagination ──────────────────────────────────────────────
    if (action === "mu_search") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const searchParams = decodeSearchState(payload);
      const response = buildSearchResponse(profile, searchParams);
      await interaction.editReply(response);
      return;
    }
  } catch (err) {
    console.error(`[multi-user] Interaction error: ${err.message}`);
    logError("multi-user-interaction", err.message);
    try {
      const reply = { content: "An error occurred. Please try again.", ephemeral: true };
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(reply);
      } else {
        await interaction.followUp(reply);
      }
    } catch {}
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Polling loop (every 10 seconds)
// ─────────────────────────────────────────────────────────────────────────────

async function pollLoop() {
  while (running) {
    try {
      await runPollCycle();
    } catch (err) {
      console.error(`[multi-user] Poll cycle error: ${err.message}`);
      logError("multi-user-poll", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function runPollCycle() {
  const db      = getDb();
  const cutoff  = lastPollAt;
  const nowIso  = new Date().toISOString();
  lastPollAt    = nowIso;

  // Fetch newly seen jobs since last poll
  const rawJobs = db
    .prepare("SELECT * FROM seen_jobs WHERE first_seen_at > ?")
    .all(cutoff);

  if (rawJobs.length === 0) return;

  // Normalise role_categories from JSON string to array
  const jobs = rawJobs.map((job) => {
    let roleCategories;
    try {
      roleCategories = JSON.parse(job.role_categories || "[]");
    } catch {
      roleCategories = [];
    }
    return {
      ...job,
      roleCategories,
      sourceKey: job.source_key,
      postedAt: job.posted_at,
      postedPrecision: job.posted_precision,
    };
  });

  // Filter stale jobs — mirrors the check in index.js processBatchResults()
  const freshJobs = jobs.filter((job) =>
    jobIsFresh(job, nowIso, {
      maxPostAgeMinutes: Number(process.env.MAX_POST_AGE_MINUTES) || 180,
      maxDateOnlyAgeDays: Number(process.env.MAX_DATE_ONLY_AGE_DAYS) || 1,
      timezone: "America/New_York",
    })
  );

  if (freshJobs.length < jobs.length) {
    console.log(`[multi-user] Suppressed ${jobs.length - freshJobs.length} stale jobs.`);
  }

  if (freshJobs.length === 0) return;

  const users = getActiveUsers();

  for (const user of users) {
    try {
      const seenKeys    = getUserSeenJobKeys(user.id);
      const matchedJobs = filterJobsForUser(freshJobs, user, seenKeys, {
        sponsorLookup: isH1bSponsor,
      });

      if (matchedJobs.length === 0) continue;

      for (const job of matchedJobs) {
        markJobNotified(user.id, job.key);

        const action = getDeliveryAction(user, new Date());

        if (action === "send") {
          const result = await sendJobDm(client, user.discord_id, job, user.first_name);
          logDm(user.id, job.key, result ? "sent" : "failed");
        } else {
          logDm(user.id, job.key, "queued");
        }

        // Rate limit: 300ms between DMs
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (err) {
      console.error(`[multi-user] Error processing user ${user.id}: ${err.message}`);
      logError("multi-user-poll-user", `user=${user.id} ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest / queue-flush loop (every 60 seconds)
// ─────────────────────────────────────────────────────────────────────────────

async function digestLoop() {
  while (running) {
    try {
      await runDigestCycle();
      cleanupExpiredOtps();
    } catch (err) {
      console.error(`[multi-user] Digest cycle error: ${err.message}`);
      logError("multi-user-digest", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}

async function runDigestCycle() {
  const db   = getDb();
  const now  = new Date();
  const users = getActiveUsers();

  for (const user of users) {
    try {
      const mode = user.notification_mode ?? "realtime";
      const tz   = user.quiet_hours_tz    ?? "America/New_York";

      // ── Digest delivery (daily / weekly) ──────────────────────────────
      if (mode === "daily" || mode === "weekly") {
        // Retrieve last delivery time from dm_log
        const lastDeliveryRow = db
          .prepare(
            "SELECT sent_at FROM dm_log WHERE user_id = ? AND status = 'sent' ORDER BY sent_at DESC LIMIT 1"
          )
          .get(user.id);
        const lastDeliveredAt = lastDeliveryRow?.sent_at ?? null;

        if (shouldDeliverDigest(mode, tz, lastDeliveredAt, now)) {
          const queuedRows = db
            .prepare(
              "SELECT job_key FROM dm_log WHERE user_id = ? AND status = 'queued'"
            )
            .all(user.id);

          if (queuedRows.length === 0) continue;

          // Fetch full job rows
          const jobKeys = queuedRows.map((r) => r.job_key);
          const placeholders = jobKeys.map(() => "?").join(",");
          const queuedJobs = db
            .prepare(`SELECT * FROM seen_jobs WHERE key IN (${placeholders})`)
            .all(...jobKeys);

          await sendDigestDm(client, user.discord_id, queuedJobs, user.first_name);

          // Mark all queued DMs as sent
          db.prepare(
            "UPDATE dm_log SET status = 'sent' WHERE user_id = ? AND status = 'queued'"
          ).run(user.id);
        }
        continue;
      }

      // ── Realtime users: flush queue when quiet hours end ──────────────
      if (mode === "realtime") {
        const inQuiet = isInQuietHours(
          user.quiet_hours_start,
          user.quiet_hours_end,
          tz,
          now
        );

        if (!inQuiet) {
          // Deliver any individually queued messages
          const queuedRows = db
            .prepare(
              "SELECT job_key FROM dm_log WHERE user_id = ? AND status = 'queued' ORDER BY id ASC"
            )
            .all(user.id);

          for (const row of queuedRows) {
            const job = db.prepare("SELECT * FROM seen_jobs WHERE key = ?").get(row.job_key);
            if (!job) continue;

            const result = await sendJobDm(client, user.discord_id, job, user.first_name);
            if (result) {
              db.prepare(
                "UPDATE dm_log SET status = 'sent' WHERE user_id = ? AND job_key = ? AND status = 'queued'"
              ).run(user.id, row.job_key);
            }

            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
      }
    } catch (err) {
      console.error(`[multi-user] Digest error for user ${user.id}: ${err.message}`);
      logError("multi-user-digest-user", `user=${user.id} ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

const token = process.env.MULTI_USER_BOT_TOKEN;
if (!token) {
  console.error("[multi-user] MULTI_USER_BOT_TOKEN is not set. Exiting.");
  process.exit(1);
}

client.once("ready", async () => {
  console.log(`[multi-user] Logged in as ${client.user.tag}`);

  // Register /search globally so it works in DMs
  try {
    const rest = new REST().setToken(token);
    await rest.put(Routes.applicationCommands(client.user.id), {
      body: [searchCommand.toJSON()],
    });
    console.log("[multi-user] Slash command /search registered globally.");
  } catch (err) {
    console.error(`[multi-user] Failed to register slash commands: ${err.message}`);
  }

  // Start loops
  pollLoop();
  digestLoop();
});

client.on("error", (err) => {
  console.error(`[multi-user] Discord client error: ${err.message}`);
});

await client.login(token);

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`[multi-user] Received ${signal}, shutting down...`);
  running = false;
  client.destroy();
  closeDb();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
