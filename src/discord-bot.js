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
import { fetchJobDescription, jobDirId, saveJobData } from "./job-description.js";
import { fitCheckResume } from "./tailor.js";
import { upsertJobPost, getJobPost, updateJobPostStatus, getDb, addToCompanyQueue, getPendingCompanies } from "./state.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;
let channelId = null;

function jobButtonId(job) {
  const hash = crypto.createHash("sha1").update(job.key).digest("hex").slice(0, 16);
  return hash;
}

function buildButtonRow(hash, jobUrl, status) {
  // status: "pending" | "fitchecked" | "applied" | "skipped"
  // Applied is truly final. Skip is reversible — Applied stays active.
  const isApplied = status === "applied";

  return new ActionRowBuilder().addComponents(
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
        }
      } catch {}
    }
  });

  await client.login(token);

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
    console.log("[discord-bot] Slash commands registered: /add, /queue");
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

  // Check if there's a thread we can fetch
  if (message.hasThread) {
    const thread = await message.thread?.fetch();
    if (thread) {
      if (thread.archived) {
        await thread.setArchived(false);
      }
      return thread;
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

  const thread = await message.startThread({ name: threadName });
  return thread;
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

// URL patterns to extract source + job ID from message text
const JOB_URL_PATTERNS = [
  { source: "microsoft", sourceLabel: "Microsoft", regex: /apply\.careers\.microsoft\.com\/careers\/job\/(\d+)/i },
  { source: "amazon", sourceLabel: "Amazon", regex: /amazon\.jobs\/(?:[a-z]{2}\/)?jobs\/(\d+)/i },
  { source: "google", sourceLabel: "Google", regex: /google\.com\/about\/careers\/applications\/jobs\/results\/(\d+)/i },
  { source: "meta", sourceLabel: "Meta", regex: /metacareers\.com\/jobs\/(\d+)/i },
  { source: "nvidia", sourceLabel: "Nvidia", regex: /nvidia\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "salesforce", sourceLabel: "Salesforce", regex: /salesforce\.wd12\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "adobe", sourceLabel: "Adobe", regex: /adobe\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "cisco", sourceLabel: "Cisco", regex: /cisco\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "stripe", sourceLabel: "Stripe", regex: /(?:stripe\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "databricks", sourceLabel: "Databricks", regex: /(?:databricks\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "figma", sourceLabel: "Figma", regex: /(?:figma\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "lyft", sourceLabel: "Lyft", regex: /(?:lyft\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "discord", sourceLabel: "Discord", regex: /(?:discord\.com\/careers|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "twilio", sourceLabel: "Twilio", regex: /(?:twilio\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "cloudflare", sourceLabel: "Cloudflare", regex: /(?:cloudflare\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "coinbase", sourceLabel: "Coinbase", regex: /(?:coinbase\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "roblox", sourceLabel: "Roblox", regex: /(?:roblox\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "anthropic", sourceLabel: "Anthropic", regex: /(?:anthropic\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "airbnb", sourceLabel: "Airbnb", regex: /(?:airbnb\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "doordash", sourceLabel: "DoorDash", regex: /(?:doordash\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "reddit", sourceLabel: "Reddit", regex: /(?:reddit\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "pinterest", sourceLabel: "Pinterest", regex: /(?:pinterest\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "datadog", sourceLabel: "Datadog", regex: /(?:datadoghq\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "mongodb", sourceLabel: "MongoDB", regex: /(?:mongodb\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "robinhood", sourceLabel: "Robinhood", regex: /(?:robinhood\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "hubspot", sourceLabel: "HubSpot", regex: /(?:hubspot\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "instacart", sourceLabel: "Instacart", regex: /(?:instacart\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "samsara", sourceLabel: "Samsara", regex: /(?:samsara\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "netflix", sourceLabel: "Netflix", regex: /netflix\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "snap", sourceLabel: "Snap", regex: /snapchat\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "plaid", sourceLabel: "Plaid", regex: /jobs\.lever\.co\/plaid\/([a-f0-9-]+)/i },
  { source: "spotify", sourceLabel: "Spotify", regex: /jobs\.lever\.co\/spotify\/([a-f0-9-]+)/i },
  { source: "creditkarma", sourceLabel: "Credit Karma", regex: /jobs\.lever\.co\/creditkarma\/([a-f0-9-]+)/i },
  { source: "quora", sourceLabel: "Quora", regex: /jobs\.lever\.co\/quora\/([a-f0-9-]+)/i },
  { source: "openai", sourceLabel: "OpenAI", regex: /jobs\.ashbyhq\.com\/openai\/([a-f0-9-]+)/i },
  { source: "notion", sourceLabel: "Notion", regex: /jobs\.ashbyhq\.com\/notion\/([a-f0-9-]+)/i },
  { source: "ramp", sourceLabel: "Ramp", regex: /jobs\.ashbyhq\.com\/ramp\/([a-f0-9-]+)/i },
  { source: "snowflake", sourceLabel: "Snowflake", regex: /jobs\.ashbyhq\.com\/snowflake\/([a-f0-9-]+)/i },
  { source: "cursor", sourceLabel: "Cursor", regex: /jobs\.ashbyhq\.com\/cursor\/([a-f0-9-]+)/i },
  { source: "airtable", sourceLabel: "Airtable", regex: /jobs\.ashbyhq\.com\/airtable\/([a-f0-9-]+)/i },
  { source: "vanta", sourceLabel: "Vanta", regex: /jobs\.ashbyhq\.com\/vanta\/([a-f0-9-]+)/i },
  // New Greenhouse companies
  { source: "block", sourceLabel: "Block", regex: /(?:block\.xyz|squareup\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { source: "elastic", sourceLabel: "Elastic", regex: /(?:elastic\.co|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  // New Workday companies
  { source: "intel", sourceLabel: "Intel", regex: /intel\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "paypal", sourceLabel: "PayPal", regex: /paypal\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "capitalone", sourceLabel: "Capital One", regex: /capitalone\.wd12\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "walmartglobaltech", sourceLabel: "Walmart Global Tech", regex: /walmart\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "samsung", sourceLabel: "Samsung", regex: /sec\.wd3\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  // Custom scraper companies
  { source: "apple", sourceLabel: "Apple", regex: /jobs\.apple\.com\/.*?details\/([a-zA-Z0-9-]+)/i },
  { source: "oracle", sourceLabel: "Oracle", regex: /careers\.oracle\.com\/.*?job\/(\d+)/i },
  { source: "linkedin", sourceLabel: "LinkedIn", regex: /linkedin\.com\/jobs\/view\/(?:[^/]*-)?(\d+)/i },
  { source: "jpmorgan", sourceLabel: "JPMorgan Chase", regex: /jpmc\.fa\.oraclecloud\.com\/.*?job\/(\d+)/i },
  { source: "intuit", sourceLabel: "Intuit", regex: /jobs\.intuit\.com\/job\/[^/]+\/[^/]+\/27595\/(\d+)/i },
  { source: "bloomberg", sourceLabel: "Bloomberg", regex: /bloomberg\.avature\.net\/careers\/JobDetail\/[^/]+\/(\d+)/i },
  { source: "broadcom", sourceLabel: "Broadcom", regex: /broadcom\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { source: "servicenow", sourceLabel: "ServiceNow", regex: /jobs\.smartrecruiters\.com\/ServiceNow\/([a-f0-9-]+)/i },
  { source: "visa", sourceLabel: "Visa", regex: /jobs\.smartrecruiters\.com\/Visa\/([a-f0-9-]+)/i },
  { source: "goldmansachs", sourceLabel: "Goldman Sachs", regex: /higher\.gs\.com\/roles\/(\d+)/i },
  { source: "uber", sourceLabel: "Uber", regex: /uber\.com\/.*?careers\/list\/(\d+)/i },
  { source: "confluent", sourceLabel: "Confluent", regex: /careers\.confluent\.io\/jobs\/job\/([a-f0-9-]+)/i }
];

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
  const jobUrl = getJobUrlFromMessage(interaction.message);
  const jobInfo = extractJobFromMessage(jobUrl);

  if (!jobInfo) {
    await thread.send("Could not find a job URL in this message.");
    return;
  }

  const dirId = `${jobInfo.sourceKey}-${jobInfo.id}`;
  await thread.send("Running fit check... This may take 20-40 seconds.");

  let hasDescription = false;
  try {
    await fs.access(`data/jobs/${dirId}/description.txt`);
    hasDescription = true;
  } catch {}

  try {
    if (!hasDescription) {
      console.log(`[fit-check] Fetching job description for ${dirId}...`);
      const description = await fetchJobDescription(jobInfo);
      await saveJobData(jobInfo, description || "");
    }

    const result = await fitCheckResume(dirId, (msg) => console.log(`[fit-check] ${msg}`));
    const fitEmoji = result.shouldApply === "YES" ? "✅" : result.shouldApply === "STRETCH" ? "⚠️" : "❌";
    let assessmentMsg = `${fitEmoji} **Fit Assessment: ${result.shouldApply}**`;
    if (result.fitAssessment) {
      const trimmed = result.fitAssessment.length > 1500
        ? result.fitAssessment.slice(0, 1500) + "..."
        : result.fitAssessment;
      assessmentMsg += `\n\`\`\`\n${trimmed}\n\`\`\``;
    }
    await thread.send(assessmentMsg);

    // Update buttons to show fit check was done
    if (jobUrl) {
      const updatedRow = buildButtonRow(hash, jobUrl, "fitchecked");
      await interaction.message.edit({ components: [updatedRow] });
    }
  } catch (error) {
    console.error(`[fit-check] Error: ${error.message}`);
    const errMsg = error.message.length > 500 ? error.message.slice(0, 500) + "..." : error.message;
    await thread.send(`Fit check failed: ${errMsg}`);
  }
}

async function handleApplied(interaction, hash) {
  await interaction.deferUpdate();

  const thread = await getOrCreateThread(interaction);
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
    const { stdout } = await execFileAsync("python", [
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
      const updatedRow = buildButtonRow(hash, jobUrl, "applied");
      await parentMessage.edit({ components: [updatedRow] });
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

  const thread = await getOrCreateThread(interaction);
  await thread.send("❌ **Skipped**");

  try {
    updateJobPostStatus(findJobKeyByMessageId(interaction.message.id), "skipped");
  } catch {}

  // Update buttons to show skipped state
  const jobUrl = getJobUrlFromMessage(interaction.message);
  if (jobUrl) {
    const updatedRow = buildButtonRow(hash, jobUrl, "skipped");
    await interaction.message.edit({ components: [updatedRow] });
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

    const descParts = [];
    if (job.location) descParts.push(job.location);
    if (job.postedAt) descParts.push(`Posted: ${new Date(job.postedAt).toLocaleString()}`);
    if (hasWarnings) {
      descParts.push(`\n:warning: **Flags:** ${warnings.join(" | ")}`);
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: job.sourceLabel })
      .setTitle(job.title)
      .setURL(job.url)
      .setColor(hasWarnings ? 0xFFA500 : 0x5865F2);

    if (descParts.length > 0) {
      embed.setDescription(descParts.join("\n"));
    }

    const row = buildButtonRow(hash, job.url, "pending");

    try {
      const message = await channel.send({
        embeds: [embed],
        components: [row]
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
