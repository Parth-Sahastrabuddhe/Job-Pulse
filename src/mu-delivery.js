/**
 * mu-delivery.js — DM delivery module for the multi-user bot.
 *
 * Builds Discord embeds and buttons for DMs, and sends them.
 *
 * Exports:
 *   jobButtonHash(jobKey)                                        → 16-char SHA1 hex prefix
 *   buildDmButtons(hash, jobUrl, status, opts)                    → ActionRow[]
 *   buildJobEmbed(job, { timezone?, experienceYears? })           → EmbedBuilder
 *   sendJobDm(client, discordId, job, firstName, { timezone?, experienceYears? })  → { messageId } | null
 *   sendDigestDm(client, discordId, jobs, firstName, { timezone? })  → { ok, deliveredKeys }
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { formatLevelLine } from "./role-taxonomy.js";
import { jobButtonHash } from "./job-key-hash.js";

export { jobButtonHash } from "./job-key-hash.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a 16-character SHA1 hex prefix from a job key.
 * Used as the identifier in button custom IDs.
 * @param {string} jobKey
 * @returns {string}
 */
function isValidJobUrl(url) {
  return typeof url === "string" && /^https?:\/\/.+/.test(url);
}

/**
 * Build the ActionRow with View Job / Applied / Save / Skip buttons.
 *
 * Prefixes use `mu_applied:`, `mu_save:`, and `mu_skip:` to avoid collision
 * with the personal bot's `applied:` / `skip:` custom IDs.
 *
 * @param {string} hash    16-char button hash (from jobButtonHash)
 * @param {string} jobUrl  direct URL to the job posting
 * @param {"pending"|"notified"|"saved"|"applied"|"skipped"} status
 * @param {object} [opts]
 * @param {boolean} [opts.fitCheck] append a 5th "Fit Check" (mu_fitcheck:<hash>) button
 * @returns {ActionRowBuilder[]}
 */
export function buildDmButtons(hash, jobUrl, status, opts = {}) {
  const isApplied = status === "applied";
  const isSaved = status === "saved";

  const viewJobButton = isValidJobUrl(jobUrl)
    ? new ButtonBuilder().setLabel("View Job").setStyle(ButtonStyle.Link).setURL(jobUrl)
    : new ButtonBuilder().setCustomId(`mu_noop:${hash}`).setLabel("View Job").setStyle(ButtonStyle.Secondary).setDisabled(true);

  const row = new ActionRowBuilder().addComponents(
    viewJobButton,
    new ButtonBuilder()
      .setCustomId(`mu_applied:${hash}`)
      .setLabel(isApplied ? "\u2705 Applied" : "Apply")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isApplied),
    new ButtonBuilder()
      .setCustomId(`mu_save:${hash}`)
      .setLabel(isSaved ? "\uD83D\uDCCC Saved" : "Save")
      .setStyle(isSaved ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(isApplied),
    new ButtonBuilder()
      .setCustomId(`mu_skip:${hash}`)
      .setLabel(status === "skipped" ? "\u274C Skipped" : "Skip")
      .setStyle(status === "skipped" ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(isApplied)
  );

  // 5th button fills the row to Discord's 5-per-row cap; a future button
  // must start a second ActionRow.
  if (opts.fitCheck) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`mu_fitcheck:${hash}`)
        .setLabel("Fit Check")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return [row];
}

/**
 * Build an EmbedBuilder for a single job.
 *
 * Job objects may come from seen_jobs (snake_case) or be camelCase —
 * this function handles both.
 *
 * @param {object} job
 * @param {object} [options]
 * @param {string} [options.timezone]       IANA timezone, e.g. "America/New_York"
 * @param {number} [options.experienceYears] max years of experience found in JD
 * @returns {EmbedBuilder}
 */
/**
 * One-line H-1B history hint from h1b_sponsors LCA stats.
 * Shared by the mu DMs and the personal bot's channel posts.
 * @param {{lca_count: number, avg_salary?: number, lca_fy?: string}|null} stats
 * @returns {string|null}
 */
export function formatH1bLine(stats) {
  if (!stats || !(stats.lca_count > 0)) return null;
  const year = stats.lca_fy ? ` ${stats.lca_fy}` : "";
  const wage = stats.avg_salary > 0 ? `, median ~$${Math.round(stats.avg_salary / 1000)}k` : "";
  return `🛂 H-1B${year}: ~${Number(stats.lca_count).toLocaleString("en-US")} LCAs certified${wage}`;
}

export function buildJobEmbed(job, { timezone, experienceYears, warnings = [], h1bStats = null } = {}) {
  // Normalise field names — prefer snake_case (DB), fall back to camelCase
  const company   = job.source_label    ?? job.sourceLabel    ?? "Unknown Company";
  const title     = job.title           ?? "Untitled";
  const url       = job.url             ?? "";
  const location  = job.location        ?? "";
  const postedAt  = job.posted_at       ?? job.postedAt       ?? "";
  const precision = job.posted_precision ?? job.postedPrecision ?? "";

  // Build description lines
  const descParts = [];
  if (location) descParts.push(location);

  if (postedAt) {
    const d = new Date(postedAt);
    const tz = { timeZone: timezone || "America/New_York" };
    const postedStr = (precision === "day" || precision === "date")
      ? d.toLocaleDateString(undefined, { timeZone: "UTC" })
      : d.toLocaleString(undefined, tz);
    descParts.push(`Posted: ${postedStr}`);
  }

  if (experienceYears) {
    descParts.push(`Experience: ${experienceYears}+ years`);
  }

  // Cross-company level equivalence (levels.fyi-style), only when an explicit
  // convention matched: "Level: Associate (≈ mid, SDE 2 / L4 equivalent)".
  const levelLine = formatLevelLine(title, job.source_key ?? job.sourceKey ?? "");
  if (levelLine) descParts.push(levelLine);

  const h1bLine = formatH1bLine(h1bStats);
  if (h1bLine) descParts.push(h1bLine);

  // Render JD warnings inline (sponsorship, clearance, etc.)
  if (warnings.length > 0) {
    descParts.push(""); // blank line separator
    for (const w of warnings) {
      const icon = w.severity === "hard" ? "🛑" : "⚠️";
      descParts.push(`${icon} ${w.text}`);
    }
  }

  const description = descParts.join("\n") || undefined;

  // Color reflects the most severe warning present
  const hasHard = warnings.some((w) => w.severity === "hard");
  const hasSoft = warnings.some((w) => w.severity === "soft");
  const color = hasHard ? 0xED4245 : hasSoft ? 0xFFA500 : 0x5865F2;

  const embed = new EmbedBuilder()
    .setAuthor({ name: company })
    .setTitle(title)
    .setColor(color);

  if (isValidJobUrl(url)) embed.setURL(url);
  if (description) embed.setDescription(description);

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// DM senders
// ─────────────────────────────────────────────────────────────────────────────

const PERMANENT_DISCORD_CODES = new Set([50007, 10013]);

function numericDiscordValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Classify an error raised by the external Discord send itself. A response in
 * the 4xx range is an explicit rejection and therefore safe to retry (except
 * permanent recipient errors). A 5xx or an error without an HTTP response can
 * happen after Discord accepted the message, so its outcome is uncertain.
 */
export function classifyDiscordSendError(error) {
  const code = numericDiscordValue(error?.code ?? error?.rawError?.code ?? error?.data?.code);
  if (PERMANENT_DISCORD_CODES.has(code)) return "dm_closed";

  const status = numericDiscordValue(
    error?.status ?? error?.statusCode ?? error?.httpStatus ?? error?.response?.status
  );
  if (status !== null && status >= 400 && status < 500) return "known_failure";
  return "uncertain";
}

function deliveryFailure(error, { sendStarted = false } = {}) {
  const code = numericDiscordValue(error?.code ?? error?.rawError?.code ?? error?.data?.code);
  const outcome = PERMANENT_DISCORD_CODES.has(code)
    ? "dm_closed"
    : sendStarted
      ? classifyDiscordSendError(error)
      : "known_failure";
  return {
    ok: false,
    outcome,
    permanent: outcome === "dm_closed",
    uncertain: outcome === "uncertain",
    sendStarted,
    error,
  };
}

async function resolveDeliveryTarget(client, discordId, notificationChannelId) {
  const target = notificationChannelId
    ? await client.channels.fetch(notificationChannelId)
    : await client.users.fetch(discordId);
  if (!target || typeof target.send !== "function") {
    throw new Error("Discord delivery target is unavailable");
  }
  return target;
}

async function beginExternalSend(options, jobKeys) {
  if (!options.onBeforeSend) return true;
  const began = await options.onBeforeSend(jobKeys);
  if (began === false) throw new Error("Durable delivery state could not enter sending");
  return true;
}

/**
 * Fetch a Discord user and send a single job DM with embed + buttons.
 *
 * @param {import("discord.js").Client} client
 * @param {string}  discordId   Snowflake string
 * @param {object}  job         Job row from seen_jobs (snake_case) or camelCase
 * @param {string}  firstName   User's first name
 * @param {object}  [options]
 * @param {string}  [options.timezone]        IANA timezone for date formatting
 * @param {number}  [options.experienceYears] max experience years from JD
 * @param {boolean} [options.fitCheckEnabled] render the Fit Check button (mu_fit_check flag)
 * @param {(jobKeys: string[]) => boolean|Promise<boolean>} [options.onBeforeSend]
 *        Durable claimed->sending transition, invoked after target lookup and
 *        immediately before the external send.
 * @returns {Promise<{ ok: true, messageId: string, outcome: "sent" }|{
 *   ok: false, outcome: "known_failure"|"dm_closed"|"uncertain",
 *   permanent: boolean, uncertain: boolean, sendStarted: boolean, error: unknown
 * }>}
 */
export async function sendJobDm(client, discordId, job, firstName, options = {}) {
  let jobKey;
  let payload;
  try {
    jobKey = job.key ?? job.jobKey ?? "";
    const jobUrl = job.url ?? "";
    const hash   = jobButtonHash(jobKey);

    const embed   = buildJobEmbed(job, options);
    const buttons = buildDmButtons(hash, jobUrl, "pending", { fitCheck: !!options.fitCheckEnabled });

    const company = job.source_label ?? job.sourceLabel ?? "";
    const title   = job.title ?? "";
    payload = {
      content: company ? `${company} — ${title}` : undefined,
      embeds: [embed],
      components: buttons,
      allowedMentions: { parse: [] },
    };
  } catch (err) {
    console.error(`[mu-delivery] Failed to prepare notification for ${discordId}: ${err.message}`);
    return deliveryFailure(err);
  }

  let target;
  try {
    target = await resolveDeliveryTarget(client, discordId, options.notificationChannelId);
  } catch (err) {
    const result = deliveryFailure(err);
    console.error(`[mu-delivery] Failed to resolve notification target for ${discordId}${result.permanent ? " (permanent: DMs closed/blocked)" : ""}: ${err.message}`);
    return result;
  }

  try {
    await beginExternalSend(options, [jobKey]);
  } catch (err) {
    console.error(`[mu-delivery] Failed to persist pre-send state for ${discordId}: ${err.message}`);
    return deliveryFailure(err);
  }

  try {
    const message = await target.send(payload);
    return { ok: true, messageId: message.id, outcome: "sent" };
  } catch (err) {
    const result = deliveryFailure(err, { sendStarted: true });
    console.error(`[mu-delivery] Failed to send notification for ${discordId}${result.permanent ? " (permanent: DMs closed/blocked)" : result.uncertain ? " (outcome uncertain)" : ""}: ${err.message}`);
    return result;
  }
}

/**
 * Send a digest DM to a user: a summary embed followed by up to 10 individual
 * job embeds with buttons (max 20 listed in the summary).
 *
 * Inserts a 500 ms delay between messages to respect Discord rate limits.
 *
 * @param {import("discord.js").Client} client
 * @param {string}   discordId
 * @param {object[]} jobs       Array of job rows (snake_case or camelCase)
 * @param {string}   firstName
 * @param {object}   [options]
 * @param {string}   [options.timezone]  IANA timezone for date formatting
 * @param {boolean}  [options.fitCheckEnabled] render the Fit Check button (mu_fit_check flag)
 * @param {(jobKeys: string[]) => boolean|Promise<boolean>} [options.onBeforeSend]
 *        Atomically transitions every selected digest claim to digest_sending.
 * @returns {Promise<{ ok: boolean, deliveredKeys: string[], outcome: string,
 *   permanent?: boolean, uncertain?: boolean, sendStarted?: boolean,
 *   attemptedKeys?: string[], error?: unknown }>}
 */
export async function sendDigestDm(client, discordId, jobs, firstName, options = {}) {
  let target;
  try {
    target = await resolveDeliveryTarget(client, discordId, options.notificationChannelId);
  } catch (err) {
    const result = deliveryFailure(err);
    console.error(`[mu-delivery] Failed to resolve digest target for ${discordId}: ${err.message}`);
    return { ...result, deliveredKeys: [], attemptedKeys: [] };
  }

  // The summary lists up to 20 jobs (with links); the first 10 also get their own
  // embed with action buttons. Only these are communicated to the user, so only
  // these count as delivered; any overflow stays queued for the next digest.
  const displayJobs    = jobs.slice(0, 20);
  const individualJobs = jobs.slice(0, 10);
  const deliveredKeys  = displayJobs.map((j) => j.key ?? j.jobKey ?? "").filter(Boolean);

  const summaryLines = displayJobs.map((job, i) => {
    const company = job.source_label ?? job.sourceLabel ?? "Unknown";
    const title   = job.title        ?? "Untitled";
    const url     = job.url          ?? "";
    return isValidJobUrl(url) ? `${i + 1}. [${title}](${url}) — ${company}` : `${i + 1}. **${title}** — ${company}`;
  });

  const overflow = jobs.length - displayJobs.length;
  let summaryEmbed;
  try {
    summaryEmbed = new EmbedBuilder()
      .setTitle(`Hey ${firstName}, here are your job matches (${jobs.length} new)`)
      .setDescription(
        (summaryLines.join("\n") || "No jobs to show.") +
        (overflow > 0 ? `\n\n…and ${overflow} more in your next digest.` : "")
      )
      .setColor(0x5865F2);
    await beginExternalSend(options, deliveredKeys);
  } catch (err) {
    console.error(`[mu-delivery] Failed to prepare digest send for ${discordId}: ${err.message}`);
    return { ...deliveryFailure(err), deliveredKeys: [], attemptedKeys: deliveredKeys };
  }

  try {
    await target.send({ embeds: [summaryEmbed], allowedMentions: { parse: [] } });
  } catch (err) {
    const result = deliveryFailure(err, { sendStarted: true });
    console.error(`[mu-delivery] Failed digest summary send to ${discordId}${result.uncertain ? " (outcome uncertain)" : ""}: ${err.message}`);
    return { ...result, deliveredKeys: [], attemptedKeys: deliveredKeys };
  }

  // Individual embeds are best-effort enhancements (action buttons); the jobs are
  // already listed in the summary, so a failure here does not un-deliver them.
  for (const job of individualJobs) {
    try {
      const delay = options.delayFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      await delay(500);

      const jobKey = job.key ?? job.jobKey ?? "";
      const jobUrl = job.url ?? "";
      const hash   = jobButtonHash(jobKey);

      const embed   = buildJobEmbed(job, {
        timezone: options.timezone,
        experienceYears: job._experienceYears,
        warnings: job._warnings ?? [],
        h1bStats: job._h1bStats ?? null,
      });
      const buttons = buildDmButtons(hash, jobUrl, "pending", { fitCheck: !!options.fitCheckEnabled });

      await target.send({ embeds: [embed], components: buttons, allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`[mu-delivery] Failed digest item send to ${discordId}: ${err.message}`);
    }
  }

  return { ok: true, deliveredKeys, attemptedKeys: deliveredKeys, outcome: "sent" };
}
