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
import { upsertJobPost, updateJobPostStatus, getDb, addToCompanyQueue, getPendingCompanies } from "./state.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;
let channelId = null;

function jobButtonId(job) {
  const hash = crypto.createHash("sha1").update(job.key).digest("hex").slice(0, 16);
  return hash;
}

function buildButtonRows(hash, jobUrl, status) {
  // status: "pending" | "fitchecked" | "applied" | "skipped"
  // Applied is truly final. Skip is reversible — Applied stays active.
  const isApplied = status === "applied";

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
        .setDescription("Show pending companies in the integration queue")
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

async function getOrCreateThread(interaction) {
  const message = interaction.message;

  // Check if thread already exists on this message
  if (message.thread) {
    const thread = message.thread;
    if (thread.archived) {
      await thread.setArchived(false);
    }
    return thread;
  }

  // Check if there's a thread we can fetch (thread ID === message ID in Discord)
  if (message.hasThread) {
    try {
      const thread = await message.channel.threads.fetch(message.id);
      if (thread) {
        if (thread.archived) {
          await thread.setArchived(false);
        }
        return thread;
      }
    } catch (fetchErr) {
      console.error(`[getOrCreateThread] Failed to fetch thread for message ${message.id}: ${fetchErr.message}`);
    }
  }

  // Extract thread name from embed or message content
  const embed = message.embeds?.[0];
  let threadName;
  if (embed?.author?.name && embed?.title) {
    threadName = `${embed.author.name} - ${embed.title}`;
  } else {
    const titleMatch = message.content.match(/\*\*\[([^\]]+)\]\s*(.+?)\*\*/);
    threadName = titleMatch
      ? `${titleMatch[1]} - ${titleMatch[2]}`
      : "Job Discussion";
  }
  threadName = threadName.slice(0, 100);

  try {
    const thread = await message.startThread({ name: threadName });
    return thread;
  } catch {
    // Thread may already exist but couldn't be fetched — return null safely
    return null;
  }
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
  await interaction.deferUpdate();

  const thread = await getOrCreateThread(interaction);
  if (!thread) {
    await interaction.followUp({ content: "Could not open a thread for this job. Try again or use View Job.", ephemeral: true });
    return;
  }
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
    await thread.send("Could not identify this job. Try using View Job instead.");
    return;
  }

  const dirId = `${sourceKey}-${jobId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  await thread.send("Running fit check... This may take 20-40 seconds.");

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
        await thread.send(`Could not fetch job description for **${jobCompany} — ${jobTitle}**.\nUse the View Job button to check the listing directly.`);
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
    await thread.send(assessmentMsg);

    // Update buttons to show fit check was done
    if (jobUrl) {
      const updatedRows = buildButtonRows(hash, jobUrl, "fitchecked");
      await interaction.message.edit({ components: updatedRows });
    }
  } catch (error) {
    console.error(`[fit-check] Error for ${sourceKey}-${jobId}: ${error.message}`);
    await thread.send(`Could not complete fit check for **${jobCompany} — ${jobTitle}**.\nUse the View Job button to check the listing directly.`);
  }
}

async function handleApplied(interaction, hash) {
  await interaction.deferUpdate();

  const thread = await getOrCreateThread(interaction);
  if (!thread) {
    await interaction.followUp({ content: "Could not open a thread for this job. Try again.", ephemeral: true });
    return;
  }
  const details = extractJobInfoFromMessage(interaction.message);

  if (!details.company || !details.role || !details.url) {
    await thread.send("Could not extract job details from this message.");
    return;
  }

  // Confirmation step — ask before updating tracker
  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmapply:${hash}`)
      .setLabel("Yes, mark as applied")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`cancelapply:${hash}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  await thread.send({
    content: `Mark **${details.company} — ${details.role}** as applied?\nThis will update your tracker.`,
    components: [confirmRow]
  });
}

async function handleConfirmApply(interaction, hash) {
  await interaction.deferUpdate();

  // Find the original job message from the thread's parent
  const thread = interaction.channel;
  const parentMessage = await thread.fetchStarterMessage();
  if (!parentMessage) {
    await thread.send("Could not find the original job message.");
    return;
  }

  const details = extractJobInfoFromMessage(parentMessage);
  if (!details.company || !details.role || !details.url) {
    await thread.send("Could not extract job details.");
    return;
  }

  try {
    const scriptPath = path.resolve(__dirname, "..", "scripts", "add_application.py");
    const isLinux = process.platform === "linux";
    const pythonCmd = isLinux ? path.resolve(process.env.HOME, "venv", "bin", "python") : "python";
    const { stdout } = await execFileAsync(pythonCmd, [
      scriptPath, details.company, details.role, details.url
    ]);

    if (stdout.trim().startsWith("OK")) {
      await thread.send(`✅ **Marked as applied**\n${details.company} — ${details.role}`);
      try {
        updateJobPostStatus(findJobKeyByMessageId(parentMessage.id), "applied");
      } catch {}
    } else {
      await thread.send(`Tracker update issue: ${stdout.trim()}`);
    }

    // Update buttons on the original message
    const jobUrl = getJobUrlFromMessage(parentMessage);
    if (jobUrl) {
      const updatedRows = buildButtonRows(hash, jobUrl, "applied");
      await parentMessage.edit({ components: updatedRows });
    }

    // Remove the confirmation buttons
    await interaction.message.edit({ components: [] });
  } catch (error) {
    console.error(`[applied] Error: ${error.message}`);
    await thread.send(`Failed to update tracker: ${error.message.slice(0, 300)}`);
  }
}

async function handleCancelApply(interaction, hash) {
  await interaction.deferUpdate();
  await interaction.message.edit({
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
    updateJobPostStatus(findJobKeyByMessageId(interaction.message.id), "skipped");
  } catch {}

  const jobUrl = getJobUrlFromMessage(interaction.message);
  if (jobUrl) {
    const updatedRows = buildButtonRows(hash, jobUrl, "skipped");
    await interaction.message.edit({ components: updatedRows });
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

      // Auto-create thread
      const threadName = `${job.sourceLabel} - ${job.title}`.slice(0, 100);
      const thread = await message.startThread({ name: threadName });

      // Store in DB
      try {
        upsertJobPost(job.key, message.id, thread.id, channelId);
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
