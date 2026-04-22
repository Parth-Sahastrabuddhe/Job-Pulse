/**
 * mu-delivery.js — DM delivery module for the multi-user bot.
 *
 * Builds Discord embeds and buttons for DMs, and sends them.
 *
 * Exports:
 *   jobButtonHash(jobKey)                                        → 16-char SHA1 hex prefix
 *   buildDmButtons(hash, jobUrl, status)                         → ActionRow[]
 *   buildJobEmbed(job, { timezone?, experienceYears? })           → EmbedBuilder
 *   sendJobDm(client, discordId, job, firstName, { timezone?, experienceYears? })  → { messageId } | null
 *   sendDigestDm(client, discordId, jobs, firstName, { timezone? })               → void
 */

import crypto from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a 16-character SHA1 hex prefix from a job key.
 * Used as the identifier in button custom IDs.
 * @param {string} jobKey
 * @returns {string}
 */
export function jobButtonHash(jobKey) {
  return crypto.createHash("sha1").update(jobKey).digest("hex").slice(0, 16);
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
 * @returns {ActionRowBuilder[]}
 */
export function buildDmButtons(hash, jobUrl, status) {
  const isApplied = status === "applied";
  const isSaved = status === "saved";

  const isValidUrl = typeof jobUrl === "string" && /^https?:\/\/.+/.test(jobUrl);
  const viewJobButton = isValidUrl
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
export function buildJobEmbed(job, { timezone, experienceYears, warnings = [] } = {}) {
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

  if (url) embed.setURL(url);
  if (description) embed.setDescription(description);

  return embed;
}

// ─────────────────────────────────────────────────────────────────────────────
// DM senders
// ─────────────────────────────────────────────────────────────────────────────

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
 * @returns {Promise<{ messageId: string }|null>}
 */
export async function sendJobDm(client, discordId, job, firstName, options = {}) {
  try {
    const jobKey = job.key ?? job.jobKey ?? "";
    const jobUrl = job.url ?? "";
    const hash   = jobButtonHash(jobKey);

    const embed   = buildJobEmbed(job, options);
    const buttons = buildDmButtons(hash, jobUrl, "pending");

    const company = job.source_label ?? job.sourceLabel ?? "";
    const title   = job.title ?? "";
    const payload = {
      content: company ? `${company} — ${title}` : undefined,
      embeds: [embed],
      components: buttons,
    };

    let message;
    if (options.notificationChannelId) {
      const channel = await client.channels.fetch(options.notificationChannelId);
      message = await channel.send(payload);
    } else {
      const user = await client.users.fetch(discordId);
      message = await user.send(payload);
    }

    return { messageId: message.id };
  } catch (err) {
    console.error(`[mu-delivery] Failed to send notification for ${discordId}: ${err.message}`);
    return null;
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
 * @returns {Promise<void>}
 */
export async function sendDigestDm(client, discordId, jobs, firstName, options = {}) {
  try {
    let target;
    if (options.notificationChannelId) {
      target = await client.channels.fetch(options.notificationChannelId);
    } else {
      target = await client.users.fetch(discordId);
    }

    // Build the summary embed
    const displayJobs  = jobs.slice(0, 20);
    const individualJobs = jobs.slice(0, 10);

    const summaryLines = displayJobs.map((job, i) => {
      const company = job.source_label ?? job.sourceLabel ?? "Unknown";
      const title   = job.title        ?? "Untitled";
      const url     = job.url          ?? "";
      const line    = url ? `${i + 1}. [${title}](${url}) — ${company}` : `${i + 1}. **${title}** — ${company}`;
      return line;
    });

    const summaryEmbed = new EmbedBuilder()
      .setTitle(`Hey ${firstName}, here are your job matches (${jobs.length} new)`)
      .setDescription(summaryLines.join("\n") || "No jobs to show.")
      .setColor(0x5865F2);

    await target.send({ embeds: [summaryEmbed] });

    // Send individual embeds with action buttons
    for (const job of individualJobs) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const jobKey = job.key ?? job.jobKey ?? "";
      const jobUrl = job.url ?? "";
      const hash   = jobButtonHash(jobKey);

      const embed   = buildJobEmbed(job, {
        timezone: options.timezone,
        experienceYears: job._experienceYears,
        warnings: job._warnings ?? [],
      });
      const buttons = buildDmButtons(hash, jobUrl, "pending");

      await target.send({ embeds: [embed], components: buttons });
    }
  } catch (err) {
    console.error(`[mu-delivery] Failed digest send to ${discordId}: ${err.message}`);
  }
}
