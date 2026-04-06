import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} from "discord.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchJobDescription, saveJobData, jobDirId } from "./job-description.js";
import { fitCheckResume } from "./tailor.js";
import { upsertJobPost, updateJobPostStatus, bridgeToTracker, getDb, addToCompanyQueue, getPendingCompanies, getJobPost } from "./state.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;
let channelId = null;

function jobButtonId(job) {
  const hash = crypto.createHash("sha1").update(job.key).digest("hex").slice(0, 16);
  return hash;
}

function buildButtonRows(hash, jobUrl, status) {
  // status: "pending" | "fitchecked" | "applied" | "skipped" | "saved"
  const isApplied = status === "applied";
  const isSaved = status === "saved";

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("View Job")
      .setStyle(ButtonStyle.Link)
      .setURL(jobUrl),
    new ButtonBuilder()
      .setCustomId(`fitcheck:${hash}`)
      .setLabel(status === "fitchecked" ? "\u2714 Fit Check" : "Fit Check")
      .setStyle(status === "fitchecked" ? ButtonStyle.Success : ButtonStyle.Primary)
      .setDisabled(isApplied),
    new ButtonBuilder()
      .setCustomId(`applied:${hash}`)
      .setLabel(status === "applied" ? "\u2705 Applied" : "Applied")
      .setStyle(ButtonStyle.Success)
      .setDisabled(isApplied),
    new ButtonBuilder()
      .setCustomId(`save:${hash}`)
      .setLabel(isSaved ? "\uD83D\uDCCC Saved" : "Save")
      .setStyle(isSaved ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(isApplied),
    new ButtonBuilder()
      .setCustomId(`skip:${hash}`)
      .setLabel(status === "skipped" ? "\u274C Skipped" : "Skip")
      .setStyle(status === "skipped" ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setDisabled(isApplied)
  );

  return [row];
}

function getJobUrlFromMessage(message) {
  const embed = message.embeds?.[0];
  if (embed?.url) return embed.url;
  // Fallback for old-format plain text messages
  const content = message.content || "";
  const match = content.match(/<(https?:\/\/[^\s>]+)>/);
  return match ? match[1] : content.match(/\bhttps?:\/\/[^\s>]+/)?.[0] || "";
}

export async function startDiscordBot(config) {
  const token = config.notifications.discordBotToken;
  channelId = config.notifications.discordChannelId;

  if (!token || !channelId) {
    return null;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  client.on("interactionCreate", async (interaction) => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "add") {
        await handleAddCompany(interaction);
      } else if (interaction.commandName === "queue") {
        await handleShowQueue(interaction);
      } else if (interaction.commandName === "saved") {
        await handleSavedCommand(interaction);
      }
      return;
    }

    if (!interaction.isButton()) return;

    const [action, hash] = interaction.customId.split(":");
    if (!action || !hash) return;

    try {
      if (action === "fitcheck") {
        await handleFitCheck(interaction, hash);
      } else if (action === "applied") {
        await handleApplied(interaction, hash);
      } else if (action === "skip") {
        await handleSkip(interaction, hash);
      } else if (action === "save") {
        await handleSave(interaction, hash);
      } else if (action === "saved_apply" || action === "saved_remove") {
        await handleSavedAction(interaction, hash, action);
      } else if (action === "saved_page") {
        await handleSavedPage(interaction, hash);
      } else if (action === "confirmapply") {
        await handleConfirmApply(interaction, hash);
      } else if (action === "cancelapply") {
        await handleCancelApply(interaction, hash);
      }
    } catch (error) {
      console.error(`[interaction] Error handling ${action}: ${error.message}`);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `Error: ${error.message.slice(0, 200)}`, ephemeral: true });
        } else if (interaction.deferred) {
          await interaction.followUp({ content: `Error: ${error.message.slice(0, 200)}`, ephemeral: true });
        }
      } catch {}
    }
  });

  await client.login(token);

  client.on("error", (error) => {
    console.error(`[discord-bot] Client error: ${error.message}`);
  });

  client.on("disconnect", () => {
    console.log("[discord-bot] Disconnected. Attempting reconnect...");
  });

  // Register slash commands after login (need client.user.id)
  try {
    const rest = new REST().setToken(token);
    const commands = [
      new SlashCommandBuilder()
        .setName("add")
        .setDescription("Queue a company for integration into the job tracker")
        .addStringOption((opt) =>
          opt.setName("company").setDescription("Company name").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("queue")
        .setDescription("Show pending companies in the integration queue"),
      new SlashCommandBuilder()
        .setName("saved")
        .setDescription("Show your saved jobs"),
    ].map((c) => c.toJSON());

    const channel = await client.channels.fetch(channelId);
    await rest.put(Routes.applicationGuildCommands(client.user.id, channel.guildId), { body: commands });
    const commandNames = commands.map((c) => `/${c.name}`).join(", ");
    console.log(`[discord-bot] Slash commands registered: ${commandNames}`);
  } catch (err) {
    console.error(`[discord-bot] Failed to register slash commands: ${err.message}`);
  }

  return client;
}



function extractJobInfoFromMessage(message) {
  const embed = message.embeds?.[0];
  if (embed?.author?.name && embed?.title && embed?.url) {
    return { company: embed.author.name, role: embed.title, url: embed.url };
  }
  // Fallback for old-format plain text messages
  const content = message.content || "";
  const titleMatch = content.match(/\*\*\[([^\]]+)\]\s*(.+?)\*\*/);
  const company = titleMatch ? titleMatch[1] : null;
  const role = titleMatch ? titleMatch[2] : null;
  const urlMatch = content.match(/\bhttps?:\/\/[^\s>]+/);
  const url = urlMatch ? urlMatch[0] : null;
  return { company, role, url };
}

// URL patterns — imported from central registry (companies.js)
import { JOB_URL_PATTERNS } from "./companies.js";


function extractJobFromMessage(urlOrText) {
  for (const { source, sourceLabel, regex } of JOB_URL_PATTERNS) {
    const match = urlOrText.match(regex);
    if (match) {
      return { sourceKey: source, sourceLabel, id: match[1], url: match[0] };
    }
  }
  return null;
}

async function handleFitCheck(interaction, hash) {
  await interaction.deferReply({ ephemeral: true });

  const jobUrl = getJobUrlFromMessage(interaction.message);
  const jobInfo = extractJobFromMessage(jobUrl);

  // Extract job details from embed for fallback description
  const embedDetails = extractJobInfoFromMessage(interaction.message);

  // Look up the actual job from DB
  const db = getDb();
  let sourceKey = jobInfo?.sourceKey || "";
  let jobId = jobInfo?.id || "";
  let jobTitle = embedDetails.role || "";
  let jobCompany = embedDetails.company || "";
  let jobLocation = "";

  if (db) {
    const jobKey = findJobKeyByMessageId(interaction.message.id);
    if (jobKey) {
      const row = db.prepare("SELECT source_key, source_label, id, title, location, url FROM seen_jobs WHERE key = ?").get(jobKey);
      if (row) {
        sourceKey = row.source_key;
        jobId = row.id;
        jobTitle = row.title;
        jobCompany = row.source_label;
        jobLocation = row.location;
      }
    }
  }

  if (!sourceKey || !jobId) {
    await interaction.editReply("Could not identify this job. Try using View Job instead.");
    return;
  }

  const dirId = `${sourceKey}-${jobId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  await interaction.editReply("Running fit check... This may take 20-40 seconds.");

  try {
    // Try to fetch job description if we don't have one
    let hasDescription = false;
    try {
      await fs.access(`data/jobs/${dirId}/description.txt`);
      const stat = await fs.stat(`data/jobs/${dirId}/description.txt`);
      hasDescription = stat.size > 50; // Must have meaningful content
    } catch {}

    if (!hasDescription) {
      console.log(`[fit-check] Fetching job description for ${dirId}...`);
      const jobForFetch = {
        sourceKey,
        id: jobId,
        url: jobUrl || embedDetails.url || "",
        sourceLabel: jobCompany
      };
      let description = null;
      try {
        description = await fetchJobDescription(jobForFetch);
      } catch (fetchErr) {
        console.log(`[fit-check] Description fetch failed for ${dirId}: ${fetchErr.message}`);
      }

      if (!description || description.length < 50) {
        await interaction.editReply(`Could not fetch job description for **${jobCompany} — ${jobTitle}**.\nUse the View Job button to check the listing directly.`);
        return;
      }

      await saveJobData({ sourceKey, id: jobId }, description);
    }

    const result = await fitCheckResume(dirId, (msg) => console.log(`[fit-check] ${msg}`));
    const fitEmoji = result.shouldApply === "YES" ? "✅" : result.shouldApply === "STRETCH" ? "⚠️" : "❌";
    let assessmentMsg = `${fitEmoji} **Fit Assessment: ${result.shouldApply}**\n*Powered by ${result.engine || "unknown"}*`;
    if (result.fitAssessment) {
      const trimmed = result.fitAssessment.length > 1500
        ? result.fitAssessment.slice(0, 1500) + "..."
        : result.fitAssessment;
      assessmentMsg += `\n\`\`\`\n${trimmed}\n\`\`\``;
    }
    await interaction.editReply(assessmentMsg);

    // Update buttons to show fit check was done
    if (jobUrl) {
      const updatedRows = buildButtonRows(hash, jobUrl, "fitchecked");
      await interaction.message.edit({ components: updatedRows });
    }
  } catch (error) {
    console.error(`[fit-check] Error for ${sourceKey}-${jobId}: ${error.message}`);
    await interaction.editReply(`Could not complete fit check for **${jobCompany} — ${jobTitle}**.\nUse the View Job button to check the listing directly.`);
  }
}

async function handleApplied(interaction, hash) {
  await interaction.deferReply({ ephemeral: true });

  const details = extractJobInfoFromMessage(interaction.message);

  if (!details.company || !details.role || !details.url) {
    await interaction.editReply("Could not extract job details from this message.");
    return;
  }

  // Encode original message ID in button so handleConfirmApply can find the job notification
  const originalMessageId = interaction.message.id;

  // Confirmation step — ask before updating tracker
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmapply:${hash}:${originalMessageId}`)
      .setLabel("Yes, mark as applied")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancelapply:${hash}:${originalMessageId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    content: `Mark **${details.company} — ${details.role}** as applied?\nThis will update your tracker.`,
    components: [confirmRow]
  });
}

async function handleConfirmApply(interaction, hash) {
  await interaction.deferUpdate();

  // Find the original job message using the ID encoded in the button
  const parts = interaction.customId.split(":");
  const originalMessageId = parts[2];
  const channel = interaction.channel;
  let parentMessage;
  try {
    parentMessage = await channel.messages.fetch(originalMessageId);
  } catch {}
  if (!parentMessage) {
    await interaction.followUp({ content: "Could not find the original job message.", ephemeral: true });
    return;
  }

  const details = extractJobInfoFromMessage(parentMessage);
  if (!details.company || !details.role || !details.url) {
    await interaction.followUp({ content: "Could not extract job details.", ephemeral: true });
    return;
  }

  try {
    // Update tracker immediately — don't wait for the Google Sheet script
    const applyKey = findJobKeyByMessageId(parentMessage.id);
    if (applyKey) {
      updateJobPostStatus(applyKey, "applied");
      bridgeToTracker(applyKey, "applied");
    }

    await interaction.editReply({ content: `✅ **Marked as applied**\n${details.company} — ${details.role}`, components: [] });

    // Update buttons on the original message
    const jobUrl = getJobUrlFromMessage(parentMessage);
    if (jobUrl) {
      const updatedRows = buildButtonRows(hash, jobUrl, "applied");
      await parentMessage.edit({ components: updatedRows });
    }

    // Update Google Sheet in background — don't block the tracker
    try {
      const scriptPath = path.resolve(__dirname, "..", "scripts", "add_application.py");
      const isLinux = process.platform === "linux";
      const pythonCmd = isLinux ? path.resolve(process.env.HOME, "venv", "bin", "python") : "python";
      await execFileAsync(pythonCmd, [scriptPath, details.company, details.role, details.url]);
    } catch (sheetErr) {
      console.error(`[applied] Sheet update failed: ${sheetErr.message}`);
    }
  } catch (error) {
    console.error(`[applied] Error: ${error.message}`);
    await interaction.followUp({ content: `Failed to update tracker: ${error.message.slice(0, 300)}`, ephemeral: true });
  }
}

async function handleCancelApply(interaction, hash) {
  await interaction.deferUpdate();
  await interaction.editReply({
    content: "~~" + interaction.message.content + "~~\nCancelled.",
    components: []
  });
}

async function handleAddCompany(interaction) {
  const companyName = interaction.options.getString("company");
  try {
    addToCompanyQueue(companyName);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("Company Queued")
          .setDescription(`**${companyName}** has been added to the integration queue.\nIt will be picked up in the next Claude session.`)
      ]
    });
  } catch (error) {
    await interaction.reply({ content: `Failed to queue: ${error.message}`, ephemeral: true });
  }
}

async function handleShowQueue(interaction) {
  try {
    const pending = getPendingCompanies();
    if (pending.length === 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("Integration Queue")
            .setDescription("No companies in the queue. Use `/add <company>` to add one.")
        ],
        ephemeral: true
      });
      return;
    }

    const lines = pending.map((c, i) =>
      `${i + 1}. **${c.company_name}** — queued ${new Date(c.requested_at).toLocaleDateString()}`
    );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFFA500)
          .setTitle(`Integration Queue (${pending.length} pending)`)
          .setDescription(lines.join("\n"))
      ],
      ephemeral: true
    });
  } catch (error) {
    await interaction.reply({ content: `Failed to load queue: ${error.message}`, ephemeral: true });
  }
}

async function handleSkip(interaction, hash) {
  await interaction.deferUpdate();

  try {
    const skipKey = findJobKeyByMessageId(interaction.message.id);
    updateJobPostStatus(skipKey, "skipped");
  } catch {}

  const jobUrl = getJobUrlFromMessage(interaction.message);
  if (jobUrl) {
    const updatedRows = buildButtonRows(hash, jobUrl, "skipped");
    await interaction.message.edit({ components: updatedRows });
  }

}

const SAVED_PAGE_SIZE = 4;

function savedJobHash(jobKey) {
  return crypto.createHash("sha1").update(jobKey).digest("hex").slice(0, 16);
}

function buildSavedResponse(offset = 0) {
  const db = getDb();

  const total = db.prepare("SELECT COUNT(*) AS cnt FROM job_posts WHERE status = 'saved'").get().cnt;

  if (total === 0) {
    const embed = new EmbedBuilder()
      .setTitle("\uD83D\uDCCC Saved Jobs")
      .setDescription("No saved jobs. Click **Save** on a job notification to bookmark it for later.")
      .setColor(0x5865F2);
    return { embeds: [embed], components: [] };
  }

  const rows = db.prepare(`
    SELECT jp.job_key, sj.title, sj.location, sj.url, sj.source_label, sj.last_seen_at
    FROM job_posts jp
    LEFT JOIN seen_jobs sj ON sj.key = jp.job_key
    WHERE jp.status = 'saved'
    ORDER BY sj.last_seen_at ASC
    LIMIT ? OFFSET ?
  `).all(SAVED_PAGE_SIZE, offset);

  // Group by company
  const byCompany = new Map();
  rows.forEach((row) => {
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
      lines.push(`\u2022 ${title}${loc}`);
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

  // Per-job action buttons (Applied / Remove)
  for (const row of rows) {
    const hash = savedJobHash(row.job_key);
    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`saved_apply:${hash}`)
        .setLabel(`Applied \u2014 ${(row.title ?? "Job").slice(0, 40)}`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`saved_remove:${hash}`)
        .setLabel(`Remove \u2014 ${(row.title ?? "Job").slice(0, 40)}`)
        .setStyle(ButtonStyle.Danger)
    );
    components.push(actionRow);
  }

  // Pagination buttons — Discord max 5 action rows
  if (total > SAVED_PAGE_SIZE && components.length < 5) {
    const hasPrev = offset > 0;
    const hasNext = offset + SAVED_PAGE_SIZE < total;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`saved_page:${Math.max(0, offset - SAVED_PAGE_SIZE)}`)
        .setLabel("\u25C0 Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasPrev),
      new ButtonBuilder()
        .setCustomId(`saved_page:${offset + SAVED_PAGE_SIZE}`)
        .setLabel("Next \u25B6")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasNext)
    );
    components.push(row);
  }

  return { embeds: [embed], components };
}

async function handleSavedCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const response = buildSavedResponse(0);
  await interaction.editReply(response);
}

async function handleSavedAction(interaction, hash, action) {
  await interaction.deferUpdate();

  // Find job_key by matching hash against all saved job_posts
  const db = getDb();
  const savedRows = db.prepare("SELECT job_key FROM job_posts WHERE status = 'saved'").all();
  const jobKey = savedRows.find((r) => savedJobHash(r.job_key) === hash)?.job_key;

  if (!jobKey) {
    await interaction.followUp({ content: "Job not found.", ephemeral: true });
    return;
  }

  const newStatus = action === "saved_apply" ? "applied" : "pending";
  updateJobPostStatus(jobKey, newStatus);
  bridgeToTracker(jobKey, newStatus);

  // Update buttons on the original notification message
  const post = getJobPost(jobKey);
  if (post?.message_id && post?.channel_id && client) {
    try {
      const ch = await client.channels.fetch(post.channel_id);
      const msg = await ch.messages.fetch(post.message_id);
      const jobUrl = getJobUrlFromMessage(msg);
      if (jobUrl) {
        const updatedRows = buildButtonRows(savedJobHash(jobKey), jobUrl, newStatus);
        await msg.edit({ components: updatedRows });
      }
    } catch {}
  }

  // Refresh the /saved list
  const response = buildSavedResponse(0);
  await interaction.editReply(response);
}

async function handleSavedPage(interaction, offsetStr) {
  await interaction.deferUpdate();
  const offset = parseInt(offsetStr, 10) || 0;
  const response = buildSavedResponse(offset);
  await interaction.editReply(response);
}

async function handleSave(interaction, hash) {
  await interaction.deferUpdate();

  try {
    const saveKey = findJobKeyByMessageId(interaction.message.id);
    if (saveKey) {
      const post = getJobPost(saveKey);
      const newStatus = post?.status === "saved" ? "pending" : "saved";
      updateJobPostStatus(saveKey, newStatus);
      bridgeToTracker(saveKey, newStatus);

      const jobUrl = getJobUrlFromMessage(interaction.message);
      if (jobUrl) {
        const updatedRows = buildButtonRows(hash, jobUrl, newStatus);
        await interaction.message.edit({ components: updatedRows });
      }
    }
  } catch (error) {
    console.error(`[save] Error: ${error.message}`);
  }
}

function findJobKeyByMessageId(messageId) {
  try {
    const db = getDb();
    if (!db) return null;
    const row = db.prepare("SELECT job_key FROM job_posts WHERE message_id = ?").get(messageId);
    return row?.job_key || null;
  } catch {
    return null;
  }
}

export async function sendDiscordBotNotification(jobs, warningsMap = new Map(), options = {}) {
  if (!client || !channelId) return;

  const channel = await client.channels.fetch(channelId);
  if (!channel) return;

  for (const [index, job] of jobs.entries()) {
    if (options.dryRun) {
      console.log(`[dry-run][discord-bot] Would send: ${job.title}`);
      continue;
    }

    const hash = jobButtonId(job);
    const warnings = warningsMap.get(job.key);
    const hasWarnings = warnings && warnings.length > 0;
    const hasHardWarnings = hasWarnings && warnings.some((w) => w.severity === "hard");

    const descParts = [];
    if (job.location) descParts.push(job.location);
    if (job.postedAt) {
      const d = new Date(job.postedAt);
      const tz = { timeZone: "America/New_York" };
      const postedStr = (job.postedPrecision === "day" || job.postedPrecision === "date")
        ? d.toLocaleDateString(undefined, tz)
        : d.toLocaleString(undefined, tz);
      descParts.push(`Posted: ${postedStr}`);
    }
    if (hasWarnings) {
      const parts = warnings.map((w) =>
        w.severity === "hard" ? `:octagonal_sign: ${w.text}` : `:warning: ${w.text}`
      );
      descParts.push(`\n${parts.join("\n")}`);
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: job.sourceLabel })
      .setTitle(job.title)
      .setURL(job.url)
      .setColor(hasHardWarnings ? 0xED4245 : hasWarnings ? 0xFFA500 : 0x5865F2);

    if (descParts.length > 0) {
      embed.setDescription(descParts.join("\n"));
    }

    const rows = buildButtonRows(hash, job.url, "pending");

    try {
      const message = await channel.send({
        embeds: [embed],
        components: rows
      });

      // Store in DB (thread created on-demand when user clicks Fit Check)
      try {
        upsertJobPost(job.key, message.id, null, channelId);
        bridgeToTracker(job.key, "notified");
      } catch (err) {
        console.error(`[discord-bot] Failed to store job_post: ${err.message}`);
      }

      if (index < jobs.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      console.error(`Discord send error: ${error.message}`);
    }
  }
}

export function stopDiscordBot() {
  if (client) {
    client.destroy();
    client = null;
  }
}
