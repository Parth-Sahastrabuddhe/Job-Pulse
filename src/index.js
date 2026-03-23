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
import { collectFordJobs } from "./sources/ford.js";
import { collectCitiJobs } from "./sources/citi.js";
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

// --- Company Registry ---
// Each entry: { key, collector, collectorArgs, lane }
// lane: "fast" (every batch), "normal" (batched rotation), "slow" (separate timer)
// collector: function reference or { fn, args } for parameterized collectors

function buildRegistry(config) {
  const registry = [];

  // Helper: standalone collector (fn signature: fn(browser, config, log))
  const solo = (key, fn, lane) => {
    registry.push({ key, collect: (cfg) => fn(null, cfg, log), lane });
  };

  // Helper: parameterized collector (fn signature: fn(browser, config, log, companyKey))
  const param = (key, fn, lane) => {
    registry.push({ key, collect: (cfg) => fn(null, cfg, log, key), lane });
  };

  // Fast lane — checked every batch cycle
  solo("microsoft", collectMicrosoftJobs, "fast");
  solo("amazon", collectAmazonJobs, "fast");

  // Normal lane — standalone collectors
  solo("google", collectGoogleJobs, "normal");
  solo("meta", collectMetaJobs, "normal");
  solo("goldmansachs", collectGoldmanSachsJobs, "normal");
  solo("oracle", collectOracleJobs, "normal");
  solo("jpmorgan", collectJPMorganJobs, "normal");
  solo("ford", collectFordJobs, "normal");
  solo("citi", collectCitiJobs, "normal");

  // Slow lane — Playwright/HTML scrapers (run sequentially, less frequently)
  solo("uber", collectUberJobs, "slow");
  solo("confluent", collectConfluentJobs, "slow");
  solo("apple", collectAppleJobs, "slow");
  solo("linkedin", collectLinkedInJobs, "slow");
  solo("intuit", collectIntuitJobs, "slow");
  solo("bloomberg", collectBloombergJobs, "slow");

  // Normal lane — parameterized ATS collectors
  for (const key of ["nvidia", "adobe", "cisco", "salesforce", "netflix", "snap", "intel", "paypal", "capitalone", "walmartglobaltech", "samsung", "broadcom", "nike", "usbank", "fidelity", "wellsfargo", "bankofamerica", "threeM", "boeing", "disney", "amgen", "accenture"]) {
    param(key, collectWorkdayJobs, "normal");
  }
  for (const key of ["stripe", "databricks", "figma", "lyft", "discord", "twilio", "cloudflare", "coinbase", "roblox", "anthropic", "airbnb", "doordash", "reddit", "pinterest", "datadog", "mongodb", "robinhood", "hubspot", "instacart", "samsara", "block", "elastic", "waymo", "rubrik", "dropbox", "spacex", "okta", "deepmind"]) {
    param(key, collectGreenhouseJobs, "normal");
  }
  for (const key of ["qualcomm"]) {
    param(key, collectPcsxJobs, "normal");
  }
  for (const key of ["palantir", "plaid", "spotify", "creditkarma", "quora", "zoox", "binance"]) {
    param(key, collectLeverJobs, "normal");
  }
  for (const key of ["openai", "notion", "ramp", "snowflake", "cursor", "airtable", "vanta", "docker", "zapier", "sentry", "mapbox", "lambdalabs"]) {
    param(key, collectAshbyJobs, "normal");
  }
  for (const key of ["servicenow", "visa", "aristanetworks"]) {
    param(key, collectSmartRecruitersJobs, "normal");
  }

  // Override lane for any companies in config.fastTrackCompanies
  for (const entry of registry) {
    if (config.fastTrackCompanies.includes(entry.key) && entry.lane !== "fast") {
      entry.lane = "fast";
    }
  }

  return registry;
}

// --- Notifications ---

async function sendNotifications(config, jobs, filteredResults, options) {
  let notified = false;

  const warningsMap = new Map();
  if (filteredResults) {
    for (const { job, warnings } of filteredResults) {
      if (warnings.length > 0) {
        warningsMap.set(job.key, warnings);
      }
    }
  }

  if (config.notifications.discordBotToken && config.notifications.discordChannelId) {
    await sendDiscordBotNotification(jobs, warningsMap, options);
    notified = true;
  } else if (config.notifications.discordWebhookUrl) {
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

// --- Description Fetching & Filtering ---

async function fetchDescriptionsAndFilter(jobs) {
  const results = [];
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

// --- Process batch results: dedup, filter, notify, upsert ---

async function processBatchResults(config, flags, jobs, batchLabel) {
  if (jobs.length === 0) return;

  const filtered = jobs.filter((job) => jobMatchesCountryFilter(job, config.countryFilter));
  const now = timestamp();

  if (flags.seedOnly || (!hasSeenJobs() && !flags.notifyExisting)) {
    if (!flags.dryRun) {
      upsertJobs(filtered, now);
    }
    return;
  }

  const newJobs = getNewJobs(filtered);
  const freshJobs = newJobs.filter((job) => jobIsFresh(job, now, config));
  const staleJobs = newJobs.filter((job) => !jobIsFresh(job, now, config));

  if (staleJobs.length > 0) {
    log(`[${batchLabel}] Suppressed ${staleJobs.length} stale jobs.`);
  }

  if (freshJobs.length > 0) {
    const jobsToNotify = freshJobs.slice(0, config.maxNewJobsPerNotify);
    const filteredJobs = await fetchDescriptionsAndFilter(jobsToNotify);

    for (const { job, warnings } of filteredJobs) {
      const flag = warnings.length > 0 ? ` [FLAGGED: ${warnings.join("; ")}]` : "";
      log(`${job.sourceLabel}: ${job.title} | ${job.location || "Location not mentioned"}${flag}`);
    }

    await sendNotifications(config, filteredJobs.map((r) => r.job), filteredJobs, { dryRun: flags.dryRun });
  }

  if (!flags.dryRun) {
    upsertJobs(filtered, now);
  }
}

// --- Batch Collection ---

async function collectBatch(config, entries) {
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await entry.collect(config);
      } catch (error) {
        log(`[${entry.key}] Collection error: ${error.message}`);
        return [];
      }
    })
  );
  return dedupeJobs(results.flat());
}

// --- Main Loop: Rolling Window with Batching ---

async function runBatchLoop(config, flags, registry) {
  const fastEntries = registry.filter((e) => e.lane === "fast");
  const normalEntries = registry.filter((e) => e.lane === "normal");
  const slowEntries = registry.filter((e) => e.lane === "slow");

  const batchSize = config.batchSize;
  const batchDelayMs = config.batchDelayMs;
  const slowCycleMs = config.slowCycleMinutes * 60 * 1000;

  // Split normal entries into batches
  const batches = [];
  for (let i = 0; i < normalEntries.length; i += batchSize) {
    batches.push(normalEntries.slice(i, i + batchSize));
  }

  const totalBatches = batches.length || 1;
  log(`Batch configuration: ${normalEntries.length} normal companies in ${totalBatches} batches of ${batchSize}`);
  log(`Fast track: ${fastEntries.map((e) => e.key).join(", ")}`);
  log(`Slow lane (${slowCycleMs / 1000}s interval): ${slowEntries.map((e) => e.key).join(", ")}`);

  // Initial prune
  pruneState(config.retentionDays);

  // Seed mode: run everything once
  if (flags.seedOnly) {
    log("Seed-only mode. Collecting all sources...");
    const allJobs = await collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries]);
    log(`Collected ${allJobs.length} total candidate jobs for seeding.`);
    await processBatchResults(config, flags, allJobs, "seed");
    return;
  }

  // First-run detection
  if (!hasSeenJobs() && !flags.notifyExisting) {
    log("First run detected. Seeding all sources without notifications...");
    const allJobs = await collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries]);
    log(`Seeded ${allJobs.length} jobs.`);
    if (!flags.dryRun) {
      upsertJobs(allJobs.filter((j) => jobMatchesCountryFilter(j, config.countryFilter)), timestamp());
    }
    if (!flags.watch) return;
    log("Seeding complete. Starting batch rotation...");
  }

  let batchIndex = 0;
  let lastSlowRun = 0;
  let rotationCount = 0;

  while (true) {
    const cycleStart = Date.now();

    // --- Fast lane: always runs ---
    const fastJobs = await collectBatch(config, fastEntries);
    await processBatchResults(config, flags, fastJobs, "fast");

    // --- Normal lane: current batch ---
    if (batches.length > 0) {
      const currentBatch = batches[batchIndex];
      const batchLabel = `batch ${batchIndex + 1}/${totalBatches}`;
      log(`[${batchLabel}] Running ${currentBatch.length} companies: ${currentBatch.map((e) => e.key).join(", ")}`);
      const normalJobs = await collectBatch(config, currentBatch);
      await processBatchResults(config, flags, normalJobs, batchLabel);

      batchIndex = (batchIndex + 1) % totalBatches;
      if (batchIndex === 0) {
        rotationCount++;
        pruneState(config.retentionDays);
        if (rotationCount % 10 === 0) {
          log(`Completed ${rotationCount} full rotations.`);
        }
      }
    }

    // --- Slow lane: runs on its own timer ---
    if (slowEntries.length > 0 && (Date.now() - lastSlowRun) >= slowCycleMs) {
      log(`Running slow lane (${slowEntries.length} sources)...`);
      // Run slow entries sequentially to avoid multiple browser instances
      for (const entry of slowEntries) {
        try {
          const jobs = await entry.collect(config);
          await processBatchResults(config, flags, jobs, `slow:${entry.key}`);
        } catch (error) {
          log(`[slow:${entry.key}] Error: ${error.message}`);
        }
      }
      lastSlowRun = Date.now();
    }

    if (!flags.watch) break;

    // Wait before next batch
    const elapsed = Date.now() - cycleStart;
    const waitMs = Math.max(500, batchDelayMs - elapsed);
    await delay(waitMs);
  }
}

// --- Single-run mode (non-watch) ---

async function runOnce(config, flags, registry) {
  const allEntries = registry;

  pruneState(config.retentionDays);

  log("Single run: collecting all sources...");
  const allJobs = await collectBatch(config, allEntries);
  log(`Collected ${allJobs.length} total candidate jobs.`);
  await processBatchResults(config, flags, allJobs, "all");
}

// --- Flags ---

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

// --- Lock / PID ---

const LOCK_FILE = path.join(PROJECT_ROOT, "data", "bot.lock");
const PID_FILE = path.join(PROJECT_ROOT, "data", "bot.pid");
let lockFd = null;

function killOldProcess() {
  for (const file of [PID_FILE, LOCK_FILE]) {
    try {
      const pid = parseInt(fs.readFileSync(file, "utf8").trim(), 10);
      if (pid && pid !== process.pid) {
        console.log(`[startup] Killing old bot process ${pid}`);
        try { process.kill(pid, "SIGKILL"); } catch {}
        // Windows fallback: taskkill force-kills the process tree
        try {
          const { execSync } = require("node:child_process");
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", timeout: 5000 });
        } catch {}
      }
    } catch {}
  }
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

// --- Main ---

process.title = "job-alert-bot";

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

  // Override batch delay if --interval-seconds is specified
  if (flags.intervalSeconds) {
    config.batchDelayMs = flags.intervalSeconds * 1000;
  }

  initDb(config.dbFile);
  migrateFromJson(config.stateFile);

  // Build company registry
  const registry = buildRegistry(config);
  const fastCount = registry.filter((e) => e.lane === "fast").length;
  const normalCount = registry.filter((e) => e.lane === "normal").length;
  const slowCount = registry.filter((e) => e.lane === "slow").length;

  log(`JobPulse started — tracking ${registry.length} companies`);
  log(`  Fast: ${fastCount} | Normal: ${normalCount} | Slow: ${slowCount}`);
  log(`  Keywords: ${config.keywords.join(", ")}`);
  log(`  Country: ${config.countryFilter.toUpperCase() || "ALL"}`);
  log(`  Batch size: ${config.batchSize} | Batch delay: ${config.batchDelayMs}ms | Slow cycle: ${config.slowCycleMinutes}min`);

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

  if (flags.watch) {
    await runBatchLoop(config, flags, registry);
  } else {
    await runOnce(config, flags, registry);
  }

  stopDiscordBot();
  closeDb();
}

main().catch((error) => {
  console.error(`[${timestamp()}] ${error.message}`);
  process.exitCode = 1;
});
