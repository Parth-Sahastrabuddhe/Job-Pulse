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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
import { initDb, getDb, closeDb, cleanupExpiredOtps } from "./state.js";
import {
  getActiveUsers,
  getUserSeenJobKeys,
  getMuDeliveredJobKeys,
  markJobNotified,
  updateJobStatus,
  getSavedJobs,
  getExpiringReminders,
  markRemindersSent,
  expireSavedJobs,
  logDm,
  isH1bSponsor,
  upsertH1bSponsor,
  getUserProfile,
  searchUserJobs,
  logError,
} from "./multi-user-state.js";
import { filterJobForUser } from "./filter.js";
import { isJobUrlLive } from "./liveness.js";
import { jobIsFresh } from "./sources/shared.js";
import { COMPANIES } from "./companies.js";
import { checkJobDescription, extractExperienceTiers, pickTierYearsForUser } from "./jd-filter.js";
import { fetchJobDescription, jobDirId, loadJobData } from "./job-description.js";
import { getDeliveryAction, shouldDeliverDigest, isInQuietHours } from "./mu-scheduler.js";
import { sendJobDm, sendDigestDm, jobButtonHash, buildDmButtons } from "./mu-delivery.js";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;

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
/** ISO timestamp — only jobs first_seen_at after this are considered new.
 *  Persisted in the meta table so restarts don't lose pending jobs. */
let lastPollAt = null;
let lastExpiryCheck = 0;

/** Track consecutive liveness failures per user+job.
 *  After DEAD_LINK_ABANDON_AFTER failures, the job is logged as dead_link
 *  in dm_log so it stops being retried every cycle. */
const deadLinkFailures = new Map(); // `${userId}:${jobKey}` → count
const DEAD_LINK_ABANDON_AFTER = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: find job key from a short button hash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a 16-char button hash and a userId, scan user_seen_jobs to find the
 * matching job key by recomputing SHA1 on each key.
 *
 * If the primary lookup fails (e.g. markJobNotified was lost due to a write
 * error), fall back to matching the hash against seen_jobs and auto-heal
 * the missing user_seen_jobs row so subsequent button clicks work.
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

  console.log(`[btn-debug] findJobKeyByHash: hash=${hash} userId=${userId} user_seen_jobs_count=${rows.length}`);

  for (const row of rows) {
    if (jobButtonHash(row.job_key) === hash) {
      return row.job_key;
    }
  }

  // Fallback: scan seen_jobs for a matching hash and auto-heal user_seen_jobs
  const allKeys = db.prepare("SELECT key FROM seen_jobs").all();
  console.log(`[btn-debug] Fallback: scanning ${allKeys.length} seen_jobs keys`);
  for (const row of allKeys) {
    if (jobButtonHash(row.key) === hash) {
      console.log(`[btn-debug] Auto-healing: user=${userId} key=${row.key}`);
      try {
        markJobNotified(userId, row.key);
      } catch (err) {
        console.error(`[btn-debug] markJobNotified failed: ${err.message}`);
      }
      return row.key;
    }
  }

  console.log(`[btn-debug] No match found in seen_jobs either`);
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
        { name: "Saved",        value: "saved"        },
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

const savedCommand = new SlashCommandBuilder()
  .setName("saved")
  .setDescription("Show your saved jobs");

const companyCommand = new SlashCommandBuilder()
  .setName("company")
  .setDescription("List all companies tracked by the bot");

// ─────────────────────────────────────────────────────────────────────────────
// /search handler
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_EMOJI = {
  notified:     "\uD83D\uDD14",
  saved:        "\uD83D\uDCCC",
  applied:      "\u2705",
  skipped:      "\u274C",
  interviewing: "\uD83D\uDCAC",
  offer:        "\uD83C\uDF89",
  rejected:     "\uD83D\uDEAB",
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
// /saved response builder
// ─────────────────────────────────────────────────────────────────────────────

const SAVED_PAGE_SIZE = 4;

function buildMuSavedResponse(profile, offset = 0) {
  const { results, total } = getSavedJobs(profile.id, {
    limit: SAVED_PAGE_SIZE,
    offset,
  });

  if (total === 0) {
    const embed = new EmbedBuilder()
      .setTitle("\uD83D\uDCCC Saved Jobs")
      .setDescription("No saved jobs. Click **Save** on a job notification to bookmark it for later.")
      .setColor(0x5865F2);
    return { embeds: [embed], components: [] };
  }

  // Group by company
  const byCompany = new Map();
  results.forEach((row) => {
    const company = row.source_label ?? "Unknown";
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(row);
  });

  const lines = [];
  for (const [company, jobs] of byCompany) {
    lines.push(`**${company}**`);
    for (const job of jobs) {
      const title = job.url ? `[${job.title}](${job.url})` : job.title;
      const loc = job.location ? ` \u2014 ${job.location}` : "";
      const daysLeft = Math.max(0, 7 - Math.floor((Date.now() - new Date(job.saved_at).getTime()) / (24 * 60 * 60 * 1000)));
      lines.push(`\u2022 ${title}${loc} (expires in ${daysLeft}d)`);
    }
    lines.push("");
  }

  const totalPages = Math.ceil(total / SAVED_PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / SAVED_PAGE_SIZE) + 1;

  const embed = new EmbedBuilder()
    .setTitle(`\uD83D\uDCCC Saved Jobs (${total})`)
    .setDescription(lines.join("\n").trim())
    .setFooter({ text: `Page ${currentPage} of ${totalPages}` })
    .setColor(0x5865F2);

  const components = [];

  // Per-job action buttons (Applied / Remove) for each job on this page
  for (const row of results) {
    const hash = jobButtonHash(row.job_key);
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_saved_apply:${hash}`)
        .setLabel(`Applied \u2014 ${(row.title ?? "Job").slice(0, 40)}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`mu_saved_remove:${hash}`)
        .setLabel(`Remove \u2014 ${(row.title ?? "Job").slice(0, 40)}`)
        .setStyle(ButtonStyle.Danger)
    );
    components.push(actionRow);
  }

  // Pagination buttons — Discord max 5 action rows
  if (total > SAVED_PAGE_SIZE && components.length < 5) {
    const hasPrev = offset > 0;
    const hasNext = offset + SAVED_PAGE_SIZE < total;
    const prevOffset = Math.max(0, offset - SAVED_PAGE_SIZE);
    const nextOffset = offset + SAVED_PAGE_SIZE;

    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_saved_page:${prevOffset}`)
        .setLabel("\u25C0 Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasPrev),
      new ButtonBuilder()
        .setCustomId(`mu_saved_page:${nextOffset}`)
        .setLabel("Next \u25B6")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasNext)
    );
    components.push(navRow);
  }

  return { embeds: [embed], components };
}

// ─────────────────────────────────────────────────────────────────────────────
// /company handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleCompanyCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const sorted = [...COMPANIES]
    .map((c) => c.label)
    .sort((a, b) => a.localeCompare(b));

  const description = sorted.map((name) => `• ${name}`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`Tracked Companies (${sorted.length})`)
    .setDescription(description)
    .setColor(0x5865f2);

  await interaction.editReply({ embeds: [embed] });
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

    // ── /company slash command ─────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === "company") {
      await handleCompanyCommand(interaction);
      return;
    }

    // ── /saved slash command ──────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === "saved") {
      await interaction.deferReply({ ephemeral: true });

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.editReply({ content: "You don't have a profile yet. Please sign up first." });
        return;
      }

      const response = buildMuSavedResponse(profile, 0);
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

    // ── mu_applied (show confirmation) ─────────────────────────────────────
    if (action === "mu_applied") {
      await interaction.deferUpdate();

      // Extract job URL from the message embed
      const jobUrl = interaction.message?.embeds?.[0]?.url ?? "";

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("View Job")
          .setStyle(ButtonStyle.Link)
          .setURL(jobUrl || "https://example.com"),
        new ButtonBuilder()
          .setCustomId(`mu_confirmapply:${payload}`)
          .setLabel("Yes, mark as applied")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`mu_cancelapply:${payload}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.message.edit({ components: [confirmRow] });
      return;
    }

    // ── mu_confirmapply (actually mark applied) ─────────────────────────────
    if (action === "mu_confirmapply") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const hash   = payload;
      const jobKey = findJobKeyByHash(hash, profile.id);
      if (!jobKey) {
        await interaction.followUp({ content: "Job not found (MU).", ephemeral: true });
        return;
      }

      updateJobStatus(profile.id, jobKey, "applied");

      const db  = getDb();
      const row = db.prepare("SELECT url, source_label, title FROM seen_jobs WHERE key = ?").get(jobKey);
      const jobUrl = row?.url ?? "";

      const updatedButtons = buildDmButtons(hash, jobUrl, "applied");
      await interaction.editReply({ components: updatedButtons });

      // Update Google Sheet in background — only for the sheet owner
      if (row?.source_label && row?.title && profile.discord_id === ADMIN_DISCORD_ID) {
        try {
          const scriptPath = path.resolve(PROJECT_ROOT, "scripts", "add_application.py");
          const isLinux = process.platform === "linux";
          const pythonCmd = isLinux ? path.resolve(process.env.HOME, "venv", "bin", "python") : "python";
          const tz = profile.quiet_hours_tz || "America/New_York";
          await execFileAsync(pythonCmd, [scriptPath, row.source_label, row.title, jobUrl, tz]);
        } catch (sheetErr) {
          console.error(`[mu-applied] Sheet update failed: ${sheetErr.message}`);
        }
      }
      return;
    }

    // ── mu_cancelapply (restore original buttons) ───────────────────────────
    if (action === "mu_cancelapply") {
      await interaction.deferUpdate();

      const jobUrl = interaction.message?.embeds?.[0]?.url ?? "";
      const restoredButtons = buildDmButtons(payload, jobUrl, "pending");
      await interaction.message.edit({ components: restoredButtons });
      return;
    }

    // ── mu_skip ──────────────────────────────────────────────────────────────
    if (action === "mu_skip") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const hash   = payload;
      const jobKey = findJobKeyByHash(hash, profile.id);
      if (!jobKey) {
        await interaction.followUp({ content: "Job not found (MU).", ephemeral: true });
        return;
      }

      updateJobStatus(profile.id, jobKey, "skipped");

      const db  = getDb();
      const row = db.prepare("SELECT url FROM seen_jobs WHERE key = ?").get(jobKey);
      const jobUrl = row?.url ?? "";

      const updatedButtons = buildDmButtons(hash, jobUrl, "skipped");
      await interaction.editReply({ components: updatedButtons });
      return;
    }

    // ── mu_save ───────────────────────────────────────────────────────────
    if (action === "mu_save") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const hash   = payload;
      const jobKey = findJobKeyByHash(hash, profile.id);
      if (!jobKey) {
        await interaction.followUp({ content: "Job not found (MU).", ephemeral: true });
        return;
      }

      // Toggle: if already saved, unsave back to notified
      const db  = getDb();
      const row = db.prepare("SELECT status FROM user_seen_jobs WHERE user_id = ? AND job_key = ?").get(profile.id, jobKey);
      const newStatus = row?.status === "saved" ? "notified" : "saved";
      updateJobStatus(profile.id, jobKey, newStatus);

      const urlRow = db.prepare("SELECT url FROM seen_jobs WHERE key = ?").get(jobKey);
      const jobUrl = urlRow?.url ?? "";

      const updatedButtons = buildDmButtons(hash, jobUrl, newStatus);
      await interaction.editReply({ components: updatedButtons });
      return;
    }

    // ── mu_saved_apply / mu_saved_remove (from /saved list) ───────────────
    if (action === "mu_saved_apply" || action === "mu_saved_remove") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const hash   = payload;
      const jobKey = findJobKeyByHash(hash, profile.id);
      if (!jobKey) {
        await interaction.followUp({ content: "Job not found (MU).", ephemeral: true });
        return;
      }

      const newStatus = action === "mu_saved_apply" ? "applied" : "skipped";
      updateJobStatus(profile.id, jobKey, newStatus);

      // Refresh the /saved list
      const response = buildMuSavedResponse(profile, 0);
      await interaction.editReply(response);
      return;
    }

    // ── mu_saved_page (pagination for /saved) ─────────────────────────────
    if (action === "mu_saved_page") {
      await interaction.deferUpdate();

      const profile = getUserProfile(interaction.user.id);
      if (!profile) {
        await interaction.followUp({ content: "Profile not found.", ephemeral: true });
        return;
      }

      const offset = parseInt(payload, 10) || 0;
      const response = buildMuSavedResponse(profile, offset);
      await interaction.editReply(response);
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
// Expiry check: reminders + auto-expire saved jobs
// ─────────────────────────────────────────────────────────────────────────────

async function checkSavedJobExpiry() {
  try {
    // Step 1: Send reminders for jobs expiring tomorrow
    const expiring = getExpiringReminders();

    // Group by user
    const byUser = new Map();
    for (const row of expiring) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, { discordId: row.discord_id, jobs: [] });
      byUser.get(row.user_id).jobs.push(row);
    }

    for (const [userId, { discordId, jobs }] of byUser) {
      try {
        const user = await client.users.fetch(discordId);
        const jobLines = jobs.map((j) => `\u2022 ${j.title} \u2014 ${j.source_label}${j.location ? ", " + j.location : ""}`);
        await user.send(
          `\u23F0 **Saved jobs expiring tomorrow**\n\n${jobLines.join("\n")}\n\nReply \`/saved\` to review them, or they'll be removed tomorrow.`
        );
        markRemindersSent(jobs.map((j) => ({ user_id: j.user_id, job_key: j.job_key })));
        console.log(`[expiry] Sent reminder to user ${userId} for ${jobs.length} jobs`);
      } catch (err) {
        console.error(`[expiry] Failed to send reminder to user ${userId}: ${err.message}`);
      }
    }

    // Step 2: Expire jobs older than 7 days
    const expired = expireSavedJobs();
    if (expired > 0) {
      console.log(`[expiry] Expired ${expired} saved jobs`);
    }
  } catch (err) {
    console.error(`[expiry] Error in saved job expiry check: ${err.message}`);
    logError("expiry-check", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JD helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Try to load a cached job description from disk. If not found, fetch it.
 * Returns the description text or null.
 */
async function getJobDescription(job) {
  const dirId = jobDirId(job);
  try {
    const data = await loadJobData(dirId);
    if (data?.description) return data.description;
  } catch {
    // Not on disk yet — fall through to fetch
  }
  try {
    return await fetchJobDescription(job);
  } catch (err) {
    console.error(`[multi-user] Failed to fetch JD for ${dirId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the JD for a job and derive warnings + education-aware experience
 * years for a given user profile. Returns `{ warnings: [], experienceYears: null }`
 * on JD fetch failure (never throws).
 *
 * Used by both the immediate-send path in runPollCycle and the delayed-
 * delivery paths in runDigestCycle to keep warning generation consistent.
 */
async function computeJobEnrichment(job, user) {
  let experienceYears = null;
  let warnings = [];
  try {
    const description = await getJobDescription(job);
    if (description) {
      const rawWarnings = checkJobDescription(description);

      warnings = rawWarnings.filter((w) => {
        // Sponsorship warnings → only shown to users requiring sponsorship
        if (w.text.startsWith("No sponsorship")) {
          return Boolean(user.requires_sponsorship);
        }
        // Strip generic experience warning — replaced with education-aware below
        if (/^\d+\+ years required/.test(w.text)) {
          return false;
        }
        return true;
      });

      const tierInfo = extractExperienceTiers(description);
      const yearsForUser = pickTierYearsForUser(
        tierInfo.tiers,
        tierInfo.fallbackMax,
        user.education_level
      );
      if (yearsForUser >= 5) {
        experienceYears = yearsForUser;
        warnings.push({ text: `${yearsForUser}+ years required`, severity: "soft" });
      }
    }
  } catch (err) {
    console.error(`[multi-user] JD processing failed for ${job.key}: ${err.message}`);
    // Fall through — return empty warnings rather than throwing
  }
  return { warnings, experienceYears };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-seed h1b_sponsors from COMPANIES registry
// ─────────────────────────────────────────────────────────────────────────────

function seedMissingH1bSponsors() {
  const db = getDb();
  const existing = new Set(
    db.prepare("SELECT company_key FROM h1b_sponsors").all().map((r) => r.company_key)
  );
  let added = 0;
  for (const company of COMPANIES) {
    if (!existing.has(company.key)) {
      upsertH1bSponsor({
        companyKey: company.key,
        companyName: company.label,
        sponsorsH1b: true,
        lcaCount: 0,
        avgSalary: 0,
      });
      added++;
    }
  }
  if (added > 0) {
    console.log(`[multi-user] Auto-seeded ${added} missing companies into h1b_sponsors.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Polling loop (every 10 seconds)
// ─────────────────────────────────────────────────────────────────────────────

async function pollLoop() {
  while (running) {
    try {
      await runPollCycle();
    } catch (err) {
      console.error(`[multi-user] Poll cycle error: ${err.message}`);
      try { logError("multi-user-poll", err.message); } catch (_) { /* DB may be busy */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

async function runPollCycle() {
  const db      = getDb();
  const cutoff  = lastPollAt;
  const nowIso  = new Date().toISOString();

  // Fetch newly seen jobs since last poll, plus re-posted jobs
  // (where posted_at was updated to a recent date on an old listing)
  const rawJobs = db
    .prepare(`SELECT * FROM seen_jobs
              WHERE first_seen_at > ?
                 OR (posted_at > ? AND last_seen_at > ?)`)
    .all(cutoff, cutoff, cutoff);

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
      sourceLabel: job.source_label,
      postedAt: job.posted_at,
      postedPrecision: job.posted_precision,
      countryCode: job.country_code,
      seniorityLevel: job.seniority_level,
    };
  });

  // Freshness filter — use first_seen_at as reference for normal jobs.
  // For re-posted jobs (posted_at > first_seen_at), use nowIso. Exception:
  // if posted_at is in the future (ATS clock drift), use posted_at itself so
  // ageMinutes = 0 rather than a large negative value that causes stale rejection.
  const freshConfig = {
    maxPostAgeMinutes: Number(process.env.MAX_POST_AGE_MINUTES) || 180,
    maxDateOnlyAgeDays: Number(process.env.MAX_DATE_ONLY_AGE_DAYS) || 1,
    timezone: "America/New_York",
  };
  const freshJobs = jobs.filter((job) => {
    const postedMs = Date.parse(job.postedAt ?? "");
    const firstSeenMs = Date.parse(job.first_seen_at ?? "");
    const reposted = Number.isFinite(postedMs) && Number.isFinite(firstSeenMs) && postedMs > firstSeenMs;
    if (reposted) {
      // When the ATS timestamp is in the future (clock drift / scheduled posting),
      // using nowIso gives a large negative ageMinutes → incorrectly stale.
      // Use postedMs itself as reference so ageMinutes = 0 (always fresh).
      const nowMs = Date.now();
      return jobIsFresh(job, postedMs > nowMs ? postedMs : nowMs, freshConfig);
    }
    return jobIsFresh(job, job.first_seen_at, freshConfig);
  });

  if (freshJobs.length < jobs.length) {
    console.log(`[multi-user] Filtered ${jobs.length - freshJobs.length} stale postings (posted >24h / >3d ago).`);
  }

  if (freshJobs.length === 0) return;

  const users = getActiveUsers();

  for (const user of users) {
    // ── Setup phase (per-user) ──────────────────────────────────────────────
    let seenKeys, profileInvalid, matchedJobs, userTz;
    try {
      seenKeys = getMuDeliveredJobKeys(user.id);
      profileInvalid = false;
      matchedJobs = freshJobs.filter((job) => {
        if (seenKeys.has(job.key)) return false;
        const result = filterJobForUser(job, user, { sponsorLookup: isH1bSponsor });
        if (result.reason === "invalid_profile") profileInvalid = true;
        return result.pass;
      });
      userTz = user.quiet_hours_tz || "America/New_York";
    } catch (err) {
      console.error(`[multi-user] Setup error for user ${user.id}: ${err.message}`);
      try { logError("multi-user-poll-user", `user=${user.id} ${err.message}`); } catch (_) { /* DB may be busy */ }
      continue;
    }

    if (profileInvalid) {
      try { logError("filter-bad-profile", `user=${user.id}`); } catch (_) { /* DB may be busy */ }
      continue;
    }

    if (matchedJobs.length === 0) continue;

    // ── Per-job delivery (isolated try-catch per job) ───────────────────────
    // A failure on one job (e.g. SQLITE_BUSY on logDm) must NOT skip the
    // remaining jobs in this poll window — they would become permanently
    // invisible once lastPollAt advances past their first_seen_at.
    for (const job of matchedJobs) {
      try {
        const liveKey = `${user.id}:${job.key}`;

        // Check if job URL is still live — skip ghost listings.
        const live = await isJobUrlLive(job.url);
        if (!live) {
          const fails = (deadLinkFailures.get(liveKey) ?? 0) + 1;
          deadLinkFailures.set(liveKey, fails);
          if (fails >= DEAD_LINK_ABANDON_AFTER) {
            // After N strikes, record as dead_link so it stops retrying.
            markJobNotified(user.id, job.key);
            logDm(user.id, job.key, "dead_link");
            deadLinkFailures.delete(liveKey);
            console.log(`[multi-user] Dead link abandoned after ${fails} tries: ${job.sourceLabel} — ${job.title}`);
          } else {
            console.log(`[multi-user] Dead link skipped (attempt ${fails}/${DEAD_LINK_ABANDON_AFTER}): ${job.sourceLabel} — ${job.title}`);
          }
          continue;
        }
        deadLinkFailures.delete(liveKey); // reset on success

        // Compute JD-based warnings + education-aware experience years
        const { warnings, experienceYears } = await computeJobEnrichment(job, user);

        const action = getDeliveryAction(user, new Date());
        const dmOptions = { timezone: userTz, experienceYears, warnings };
        if (user.discord_id === ADMIN_DISCORD_ID && process.env.PERSONAL_CHANNEL_ID) {
          dmOptions.notificationChannelId = process.env.PERSONAL_CHANNEL_ID;
        }

        if (action === "send") {
          const result = await sendJobDm(client, user.discord_id, job, user.first_name, dmOptions);
          markJobNotified(user.id, job.key);
          logDm(user.id, job.key, result ? "sent" : "failed");
          if (!result) {
            console.error(`[multi-user] DM to ${user.discord_id} (user ${user.id}) returned null for ${job.title}`);
            try { logError("dm-failed", `user=${user.id} discord=${user.discord_id} job=${job.title} (${job.sourceLabel})`); } catch (_) { /* DB may be busy */ }
          }
        } else {
          markJobNotified(user.id, job.key);
          logDm(user.id, job.key, "queued");
        }

        // Rate limit: 300ms between DMs
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (err) {
        console.error(`[multi-user] Error on job ${job.key} for user ${user.id}: ${err.message}`);
        try { logError("multi-user-poll-job", `user=${user.id} job=${job.key} ${err.message}`); } catch (_) { /* DB may be busy */ }
      }
    }
  }

  // Advance lastPollAt only AFTER the cycle completes successfully —
  // if the cycle throws (e.g. "database is locked"), the cutoff stays put
  // so those jobs are retried next cycle instead of being permanently skipped.
  lastPollAt = nowIso;
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('mu_lastPollAt', ?)").run(nowIso);
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest / queue-flush loop (every 60 seconds)
// ─────────────────────────────────────────────────────────────────────────────

async function digestLoop() {
  while (running) {
    try {
      await runDigestCycle();
      cleanupExpiredOtps();

      // Hourly check: saved job reminders + expiry
      if (Date.now() - lastExpiryCheck >= 60 * 60 * 1000) {
        lastExpiryCheck = Date.now();
        await checkSavedJobExpiry();
      }
    } catch (err) {
      console.error(`[multi-user] Digest cycle error: ${err.message}`);
      try { logError("multi-user-digest", err.message); } catch (_) { /* DB may be busy */ }
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

          const userTz = user.quiet_hours_tz || "America/New_York";

          // Compute warnings + experience per job before sending the digest
          const enrichedJobs = [];
          for (const job of queuedJobs) {
            const normalisedJob = {
              ...job,
              sourceKey: job.source_key,
              sourceLabel: job.source_label,
            };
            const enrichment = await computeJobEnrichment(normalisedJob, user);
            enrichedJobs.push({
              ...job,
              _warnings: enrichment.warnings,
              _experienceYears: enrichment.experienceYears,
            });
          }

          const digestOpts = { timezone: userTz };
          if (user.discord_id === ADMIN_DISCORD_ID && process.env.PERSONAL_CHANNEL_ID) {
            digestOpts.notificationChannelId = process.env.PERSONAL_CHANNEL_ID;
          }
          await sendDigestDm(client, user.discord_id, enrichedJobs, user.first_name, digestOpts);

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

            // Normalise the DB row into the shape computeJobEnrichment expects
            const normalisedJob = {
              ...job,
              sourceKey: job.source_key,
              sourceLabel: job.source_label,
            };
            const { warnings, experienceYears } = await computeJobEnrichment(normalisedJob, user);

            const flushOpts = { timezone: tz, experienceYears, warnings };
            if (user.discord_id === ADMIN_DISCORD_ID && process.env.PERSONAL_CHANNEL_ID) {
              flushOpts.notificationChannelId = process.env.PERSONAL_CHANNEL_ID;
            }
            const result = await sendJobDm(client, user.discord_id, job, user.first_name, flushOpts);
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
      try { logError("multi-user-digest-user", `user=${user.id} ${err.message}`); } catch (_) { /* DB may be busy */ }
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
      body: [searchCommand.toJSON(), savedCommand.toJSON(), companyCommand.toJSON()],
    });
    console.log("[multi-user] Slash commands /search and /saved registered globally.");
  } catch (err) {
    console.error(`[multi-user] Failed to register slash commands: ${err.message}`);
  }

  // Auto-seed h1b_sponsors for any companies missing from the table
  seedMissingH1bSponsors();

  // Restore lastPollAt from DB so restarts don't lose pending jobs
  const saved = getDb().prepare("SELECT value FROM meta WHERE key = 'mu_lastPollAt'").get();
  lastPollAt = saved?.value || new Date().toISOString();
  console.log(`[multi-user] Resuming poll from ${lastPollAt}`);

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
