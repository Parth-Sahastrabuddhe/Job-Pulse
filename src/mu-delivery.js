/**
 * mu-delivery.js — DM delivery module for the multi-user bot.
 *
 * Builds Discord embeds and buttons for DMs, and sends them.
 *
 * Exports:
 *   jobButtonHash(jobKey)                                → 16-char SHA1 hex prefix
 *   buildDmButtons(hash, jobUrl, status)                 → ActionRow[]
 *   buildJobEmbed(job)                                   → EmbedBuilder
 *   sendJobDm(client, discordId, job, firstName)         → { messageId } | null
 *   sendDigestDm(client, discordId, jobs, firstName)     → void
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
 * Build the ActionRow with View Job / Applied / Skip buttons.
 *
 * Prefixes use `mu_applied:` and `mu_skip:` to avoid collision with the
 * personal bot's `applied:` / `skip:` custom IDs.
 *
 * @param {string} hash    16-char button hash (from jobButtonHash)
 * @param {string} jobUrl  direct URL to the job posting
 * @param {"pending"|"applied"|"skipped"} status
 * @returns {ActionRowBuilder[]}
 */
export function buildDmButtons(hash, jobUrl, status) {
  const isApplied = status === "applied";

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("View Job")
      .setStyle(ButtonStyle.Link)
      .setURL(jobUrl),
    new ButtonBuilder()
      .setCustomId(`mu_applied:${hash}`)
      .setLabel(isApplied ? "\u2705 Applied" : "Applied")
      .setStyle(ButtonStyle.Success)
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
 * @returns {EmbedBuilder}
 */
export function buildJobEmbed(job) {
  // Normalise field names — prefer snake_case (DB), fall back to camelCase
  const company   = job.source_label  ?? job.sourceLabel  ?? "Unknown Company";
  const title     = job.title         ?? "Untitled";
  const url       = job.url           ?? "";
  const location  = job.location      ?? "";
  const postedAt  = job.posted_at     ?? job.postedAt     ?? "";
  const postedTxt = job.posted_text   ?? job.postedText   ?? "";

  // Build a compact description line
  const descParts = [];
  if (location) descParts.push(`**Location:** ${location}`);
  if (postedTxt || postedAt) descParts.push(`**Posted:** ${postedTxt || postedAt}`);
  const description = descParts.join("\n") || undefined;

  const embed = new EmbedBuilder()
    .setAuthor({ name: company })
    .setTitle(title)
    .setColor(0x5865F2);

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
 * @param {string}  firstName   User's first name (currently unused in single-job DMs
 *                              but kept for API consistency)
 * @returns {Promise<{ messageId: string }|null>}
 */
export async function sendJobDm(client, discordId, job, firstName) {
  try {
    const user = await client.users.fetch(discordId);

    const jobKey = job.key ?? job.jobKey ?? "";
    const jobUrl = job.url ?? "";
    const hash   = jobButtonHash(jobKey);

    const embed   = buildJobEmbed(job);
    const buttons = buildDmButtons(hash, jobUrl, "pending");

    const message = await user.send({
      embeds: [embed],
      components: buttons,
    });

    return { messageId: message.id };
  } catch (err) {
    console.error(`[mu-delivery] Failed to DM ${discordId}: ${err.message}`);
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
 * @returns {Promise<void>}
 */
export async function sendDigestDm(client, discordId, jobs, firstName) {
  try {
    const user = await client.users.fetch(discordId);

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

    await user.send({ embeds: [summaryEmbed] });

    // Send individual embeds with action buttons
    for (const job of individualJobs) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const jobKey = job.key ?? job.jobKey ?? "";
      const jobUrl = job.url ?? "";
      const hash   = jobButtonHash(jobKey);

      const embed   = buildJobEmbed(job);
      const buttons = buildDmButtons(hash, jobUrl, "pending");

      await user.send({ embeds: [embed], components: buttons });
    }
  } catch (err) {
    console.error(`[mu-delivery] Failed digest DM to ${discordId}: ${err.message}`);
  }
}
