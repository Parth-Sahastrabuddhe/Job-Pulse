import fs from "node:fs";
import path from "node:path";
import { getConfig, PROJECT_ROOT } from "./config.js";
import { sendDiscordBotNotification, startDiscordBot, stopDiscordBot } from "./discord-bot.js";
import { fetchJobDescription, jobDirId, saveJobData } from "./job-description.js";
import { sendDiscordNotification } from "./notifiers/discord.js";
import { sendTelegramNotification } from "./notifiers/telegram.js";
import { collectAmazonJobs } from "./sources/amazon.js";
import { collectGoogleJobs } from "./sources/google.js";
import { collectGreenhouseJobs } from "./sources/greenhouse.js";
import { collectLeverJobs } from "./sources/lever.js";
import { collectMetaJobs } from "./sources/meta.js";
import { collectMicrosoftJobs } from "./sources/microsoft.js";
import { collectPcsxJobs } from "./sources/pcsx.js";
import { dedupeJobs, delay, jobIsFresh, jobMatchesCountryFilter } from "./sources/shared.js";
import { collectWorkdayJobs } from "./sources/workday.js";
import { collectAshbyJobs } from "./sources/ashby.js";
import { collectAppleJobs } from "./sources/apple.js";
import { collectOracleJobs } from "./sources/oracle.js";
import { collectLinkedInJobs } from "./sources/linkedin.js";
import { collectJPMorganJobs } from "./sources/jpmorgan.js";
import { collectIntuitJobs } from "./sources/intuit.js";
import { collectSmartRecruitersJobs } from "./sources/smartrecruiters.js";
import { collectBloombergJobs } from "./sources/bloomberg.js";
import { collectGoldmanSachsJobs } from "./sources/goldmansachs.js";
import { collectUberJobs } from "./sources/uber.js";
import { collectConfluentJobs } from "./sources/confluent.js";
import {
  initDb, closeDb, migrateFromJson,
  getNewJobs, upsertJobs, pruneState, hasSeenJobs
} from "./state.js";
import { checkJobDescription } from "./jd-filter.js";

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function parseFlags(argv) {
  const flags = {
    dryRun: false,
    seedOnly: false,
    notifyExisting: false,
    watch: false,
    intervalSeconds: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }

    if (arg === "--seed-only") {
      flags.seedOnly = true;
      continue;
    }

    if (arg === "--notify-existing") {
      flags.notifyExisting = true;
      continue;
    }

    if (arg === "--watch") {
      flags.watch = true;
      continue;
    }

    if (arg === "--interval-seconds") {
      const nextValue = argv[index + 1];
      const parsed = Number.parseInt(String(nextValue ?? ""), 10);

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--interval-seconds must be followed by a positive integer.");
      }

      flags.intervalSeconds = parsed;
      index += 1;
    }
  }

  return flags;
}

async function sendNotifications(config, jobs, filteredResults, options) {
  let notified = false;

  // Build a warnings map: job key -> warnings array
  const warningsMap = new Map();
  if (filteredResults) {
    for (const { job, warnings } of filteredResults) {
      if (warnings.length > 0) {
        warningsMap.set(job.key, warnings);
      }
    }
  }

  // Discord bot (preferred — supports buttons + threads)
  if (config.notifications.discordBotToken && config.notifications.discordChannelId) {
    await sendDiscordBotNotification(jobs, warningsMap, options);
    notified = true;
  }
  // Fallback to webhook if no bot token configured
  else if (config.notifications.discordWebhookUrl) {
    await sendDiscordNotification(config.notifications.discordWebhookUrl, jobs, options);
    notified = true;
  }

  if (config.notifications.telegramBotToken && config.notifications.telegramChatId) {
    await sendTelegramNotification(
      config.notifications.telegramBotToken,
      config.notifications.telegramChatId,
      jobs,
      options
    );
    notified = true;
  }

  return notified;
}

async function collectFastJobs(config) {
  // Collect from all sources in parallel
  const workdayKeys = ["nvidia", "adobe", "cisco", "salesforce", "netflix", "snap", "intel", "paypal", "capitalone", "walmartglobaltech", "samsung", "broadcom"];
  const smartRecruitersKeys = ["servicenow", "visa"];
  const greenhouseKeys = ["stripe", "databricks", "figma", "lyft", "discord", "twilio", "cloudflare", "coinbase", "roblox", "anthropic", "airbnb", "doordash", "reddit", "pinterest", "datadog", "mongodb", "robinhood", "hubspot", "instacart", "samsara", "block", "elastic"];
  const pcsxKeys = ["qualcomm"];
  const leverKeys = ["palantir", "plaid", "spotify", "creditkarma", "quora"];
  const ashbyKeys = ["openai", "notion", "ramp", "snowflake", "cursor", "airtable", "vanta"];

  const [amazonJobs, microsoftJobs, googleJobs, appleJobs, oracleJobs, linkedInJobs, jpmorganJobs, intuitJobs, bloombergJobs, goldmanSachsJobs, uberJobs, confluentJobs, ...rest] = await Promise.all([
    collectAmazonJobs(null, config, log),
    collectMicrosoftJobs(null, config, log),
    collectGoogleJobs(null, config, log),
    collectAppleJobs(null, config, log),
    collectOracleJobs(null, config, log),
    collectLinkedInJobs(null, config, log),
    collectJPMorganJobs(null, config, log),
    collectIntuitJobs(null, config, log),
    collectBloombergJobs(null, config, log),
    collectGoldmanSachsJobs(null, config, log),
    collectUberJobs(null, config, log),
    collectConfluentJobs(null, config, log),
    ...workdayKeys.map((key) => collectWorkdayJobs(null, config, log, key)),
    ...greenhouseKeys.map((key) => collectGreenhouseJobs(null, config, log, key)),
    ...pcsxKeys.map((key) => collectPcsxJobs(null, config, log, key)),
    ...leverKeys.map((key) => collectLeverJobs(null, config, log, key)),
    ...ashbyKeys.map((key) => collectAshbyJobs(null, config, log, key)),
    ...smartRecruitersKeys.map((key) => collectSmartRecruitersJobs(null, config, log, key))
  ]);

  return dedupeJobs([amazonJobs, microsoftJobs, googleJobs, appleJobs, oracleJobs, linkedInJobs, jpmorganJobs, intuitJobs, bloombergJobs, goldmanSachsJobs, uberJobs, confluentJobs, ...rest].flat()).filter((job) =>
    jobMatchesCountryFilter(job, config.countryFilter)
  );
}

async function collectMetaJobsFiltered(config) {
  const metaJobs = await collectMetaJobs(null, config, log);
  return metaJobs.filter((job) => jobMatchesCountryFilter(job, config.countryFilter));
}

async function fetchDescriptionsAndFilter(jobs) {
  const results = [];

  // Fetch descriptions in parallel (max 5 concurrent)
  const CONCURRENCY = 5;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (job) => {
      const dirId = jobDirId(job);
      let description = null;
      try {
        description = await fetchJobDescription(job);
        await saveJobData(job, description || "");
      } catch (error) {
        log(`Failed to fetch description for ${dirId}: ${error.message}`);
      }
      const warnings = checkJobDescription(description);
      return { job, warnings };
    }));
    results.push(...batchResults);
  }

  return results;
}

async function runCycle(config, flags) {
  pruneState(config.retentionDays);

  const hadExistingState = hasSeenJobs();

  // Fire Meta in background — don't block fast sources
  const metaPromise = collectMetaJobsFiltered(config);

  // Process fast sources (Amazon, Microsoft, Google) immediately
  const fastJobs = await collectFastJobs(config);

  // Then merge Meta results
  const metaJobs = await metaPromise;
  const allJobs = dedupeJobs([...fastJobs, ...metaJobs]);
  const now = timestamp();

  log(`Collected ${allJobs.length} total candidate jobs.`);

  if (flags.seedOnly) {
    log(`Seed-only mode. Writing ${allJobs.length} jobs to state without notifications.`);

    if (!flags.dryRun) {
      upsertJobs(allJobs, now);
    } else {
      log("Dry-run mode. State was not updated.");
    }

    return;
  }

  if (!hadExistingState && !flags.notifyExisting) {
    log(`First run detected. Seeding state with ${allJobs.length} jobs and skipping notifications.`);

    if (!flags.dryRun) {
      upsertJobs(allJobs, now);
    } else {
      log("Dry-run mode. State was not updated.");
    }

    return;
  }

  const newJobs = getNewJobs(allJobs);

  // Apply freshness filter: suppress jobs with a known stale date.
  // Jobs without any date still pass through (trust sort-by-date page ordering).
  const freshJobs = newJobs.filter((job) => jobIsFresh(job, now, config));
  const staleJobs = newJobs.filter((job) => !jobIsFresh(job, now, config));

  if (staleJobs.length > 0) {
    log(`Suppressed ${staleJobs.length} stale jobs.`);
    for (const job of staleJobs.slice(0, 5)) {
      log(`  Suppressed: ${job.sourceLabel}: ${job.title} | ${job.postedAt || "no date"}`);
    }
  }

  if (freshJobs.length === 0) {
    log("No new jobs found.");

    if (!flags.dryRun) {
      upsertJobs(allJobs, now);
    } else {
      log("Dry-run mode. State was not updated.");
    }

    return;
  }

  log(`Found ${freshJobs.length} new jobs. Fetching descriptions for pre-filter...`);

  const jobsToNotify = freshJobs.slice(0, config.maxNewJobsPerNotify);

  if (freshJobs.length > config.maxNewJobsPerNotify) {
    log(`Capping notification to ${config.maxNewJobsPerNotify} jobs (${freshJobs.length - config.maxNewJobsPerNotify} deferred).`);
  }

  // Fetch descriptions and run keyword filter before notifying
  const filteredJobs = await fetchDescriptionsAndFilter(jobsToNotify);

  for (const { job, warnings } of filteredJobs) {
    const flag = warnings.length > 0 ? ` [FLAGGED: ${warnings.join("; ")}]` : "";
    log(`${job.sourceLabel}: ${job.title} | ${job.location || "Location not mentioned"}${flag}`);
  }

  const notified = await sendNotifications(config, filteredJobs.map((r) => r.job), filteredJobs, { dryRun: flags.dryRun });

  if (!notified) {
    log("No notification target was configured, so nothing was sent.");
  }

  if (!flags.dryRun) {
    upsertJobs(allJobs, now);
  } else {
    log("Dry-run mode. State was not updated.");
  }
}

const LOCK_FILE = path.join(PROJECT_ROOT, "data", "bot.lock");
let lockFd = null;

function killOldProcess() {
  // Kill any old bot process from pid file or lock file
  for (const file of [PID_FILE, LOCK_FILE]) {
    try {
      const pid = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0); // check if alive
          console.log(`[startup] Killing old bot process ${pid}`);
          process.kill(pid, "SIGTERM");
        } catch {} // already dead
      }
    } catch {} // file doesn't exist
  }
  // Give old process time to exit
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function acquireLock() {
  try {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    killOldProcess();
    lockFd = fs.openSync(LOCK_FILE, "wx");
    fs.writeSync(lockFd, String(process.pid));
    return true;
  } catch {
    // Lock file may have been recreated between delete and open — retry once
    try {
      try { fs.unlinkSync(LOCK_FILE); } catch {}
      lockFd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(lockFd, String(process.pid));
      return true;
    } catch {}
    return false;
  }
}

function releaseLock() {
  if (lockFd !== null) {
    try { fs.closeSync(lockFd); } catch {}
    lockFd = null;
  }
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

process.title = "job-alert-bot";

const PID_FILE = path.join(PROJECT_ROOT, "data", "bot.pid");

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  if (flags.watch && !acquireLock()) {
    console.error(`[${timestamp()}] Another bot instance is already running. Exiting.`);
    process.exitCode = 1;
    return;
  }

  if (flags.watch) {
    fs.writeFileSync(PID_FILE, String(process.pid));
    const cleanup = () => { try { fs.unlinkSync(PID_FILE); } catch {} };
    process.on("exit", () => { releaseLock(); cleanup(); });
    process.on("SIGINT", () => { stopDiscordBot(); closeDb(); releaseLock(); cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { stopDiscordBot(); closeDb(); releaseLock(); cleanup(); process.exit(0); });
  }

  const config = getConfig();

  // Initialize SQLite database
  initDb(config.dbFile);

  // Migrate from state.json if it exists
  migrateFromJson(config.stateFile);

  const intervalSeconds = flags.intervalSeconds ?? config.pollIntervalSeconds;

  log(`Tracking keywords: ${config.keywords.join(", ")}`);
  log(`Country filter: ${config.countryFilter.toUpperCase() || "ALL"}`);
  log(`Poll interval: ${intervalSeconds} seconds`);

  // Start Discord bot if configured
  if (config.notifications.discordBotToken && config.notifications.discordChannelId) {
    try {
      await startDiscordBot(config);
      log("Discord bot connected with interactive buttons.");
    } catch (error) {
      log(`Discord bot failed to start: ${error.message}. Falling back to webhook.`);
    }
  } else if (!config.notifications.discordWebhookUrl && !(config.notifications.telegramBotToken && config.notifications.telegramChatId)) {
    log("No Discord or Telegram configuration found. The bot will log results locally only.");
  }

  if (flags.watch && flags.seedOnly) {
    log("Seed-only mode requested. Watch mode is ignored after the first cycle.");
  }

  do {
    const cycleStartedAt = Date.now();

    try {
      await runCycle(config, flags);
    } catch (error) {
      log(`Cycle failed: ${error.message}`);
    }

    if (!flags.watch || flags.seedOnly) {
      break;
    }

    const elapsedMs = Date.now() - cycleStartedAt;
    const waitMs = Math.max(5000, intervalSeconds * 1000 - elapsedMs);
    log(`Sleeping ${Math.round(waitMs / 1000)} seconds before the next poll.`);
    await delay(waitMs);
  } while (true);

  stopDiscordBot();
  closeDb();
}

main().catch((error) => {
  console.error(`[${timestamp()}] ${error.message}`);
  process.exitCode = 1;
});
