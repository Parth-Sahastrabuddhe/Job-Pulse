import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig, PROJECT_ROOT } from "./config.js";
import { sendDiscordBotNotification, startDiscordBot, stopDiscordBot, isDiscordBotConnected } from "./discord-bot.js";
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
import { COMPANIES } from "./companies.js";
import { filterJobForUser } from "./filter.js";
import { PERSONAL_PROFILE } from "./personal-profile.js";
import { collectWorkdayJobs } from "./sources/workday.js";
import { collectAshbyJobs } from "./sources/ashby.js";
import { collectOracleJobs } from "./sources/oracle.js";
import { collectLinkedInJobs } from "./sources/linkedin.js";
import { collectJPMorganJobs } from "./sources/jpmorgan.js";
import { collectIntuitJobs } from "./sources/intuit.js";
import { collectSmartRecruitersJobs } from "./sources/smartrecruiters.js";
import { collectBloombergJobs } from "./sources/bloomberg.js";
import { collectGoldmanSachsJobs } from "./sources/goldmansachs.js";
import { collectAppleJobs } from "./sources/apple.js";
import { collectUberJobs } from "./sources/uber.js";
import { collectConfluentJobs } from "./sources/confluent.js";
import { collectFordJobs } from "./sources/ford.js";
import { collectCitiJobs } from "./sources/citi.js";
import { collectMercedesBenzJobs } from "./sources/mercedesbenz.js";
import { collectHexawareJobs } from "./sources/hexaware.js";
import { collectExlJobs } from "./sources/exl.js";
import { collectDynatraceJobs } from "./sources/dynatrace.js";
import {
  initDb, closeDb, migrateFromJson,
  getNewJobs, getUnnotifiedJobs, upsertJobs, pruneState, hasSeenJobs, expireSavedJobPosts,
  updateJobLegitimacy, upsertJobPost
} from "./state.js";
import { checkJobDescription, extractExperienceTiers, pickTierYearsForUser } from "./jd-filter.js";
import { checkLegitimacy } from "./legitimacy.js";
import { isJobUrlLive } from "./liveness.js";
import { ping, pingFail } from "./heartbeat.js";
import { shouldRunScheduledPlaywrightSource } from "./playwright-guard.js";

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function isSqliteBusy(error) {
  return error?.code?.startsWith("SQLITE_BUSY") ||
    /database is locked|SQLITE_BUSY/i.test(String(error?.message || ""));
}

async function backoffAfterDbBusy(config, label, error) {
  const backoffMs = Math.max(0, Number(config.dbBusyBackoffMs) || 0);
  log(`[${label}] Database busy: ${error.message}. Backing off ${backoffMs}ms.`);
  void pingFail(config.heartbeat.micro, `${label}: ${error.message}`);
  if (backoffMs > 0) await delay(backoffMs);
}

// --- Company Registry ---
// Each entry: { key, collector, collectorArgs, lane }
// lane: "fast" (every batch), "normal" (batched rotation), "slow" (separate timer)
// collector: function reference or { fn, args } for parameterized collectors

function buildRegistry(config) {
  const registry = [];

  // Helper: standalone collector (fn signature: fn(browser, config, log))
  const solo = (key, fn, lane, options = {}) => {
    registry.push({ key, collect: (cfg) => fn(null, cfg, log), lane, ...options });
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
  solo("mercedesbenz", collectMercedesBenzJobs, "normal");
  solo("hexaware", collectHexawareJobs, "normal");
  solo("exl", collectExlJobs, "normal");
  solo("dynatrace", collectDynatraceJobs, "normal");

  // Slow lane — Playwright/HTML scrapers (run sequentially, less frequently)
  solo("apple", collectAppleJobs, "slow");
  solo("uber", collectUberJobs, "slow", { usesPlaywright: true });
  solo("confluent", collectConfluentJobs, "slow", { usesPlaywright: true });
  solo("linkedin", collectLinkedInJobs, "slow");
  solo("intuit", collectIntuitJobs, "slow");
  solo("bloomberg", collectBloombergJobs, "slow");

  // Normal lane — parameterized ATS collectors (derived from central registry)
  const atsCollectors = {
    workday: collectWorkdayJobs,
    greenhouse: collectGreenhouseJobs,
    pcsx: collectPcsxJobs,
    lever: collectLeverJobs,
    ashby: collectAshbyJobs,
    smartrecruiters: collectSmartRecruitersJobs
  };

  for (const company of COMPANIES) {
    if (company.ats !== "solo" && atsCollectors[company.ats]) {
      param(company.key, atsCollectors[company.ats], company.lane);
    }
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

async function sendNotifications(config, jobs, filteredResults, options = {}) {
  let notified = false;

  const warningsMap = new Map();
  if (filteredResults) {
    for (const { job, warnings } of filteredResults) {
      if (warnings.length > 0) {
        warningsMap.set(job.key, warnings);
      }
    }
  }

  // Discord bot is the primary channel, but only when it's actually connected.
  // A failed startup or a later disconnect must fall through to the webhook rather
  // than throw every cycle and silently deliver nothing (heartbeats stay green).
  const botConfigured = config.notifications.discordBotToken && config.notifications.discordChannelId;
  let botDelivered = false;
  if (botConfigured && isDiscordBotConnected()) {
    try {
      await sendDiscordBotNotification(jobs, warningsMap, options);
      botDelivered = true;
      notified = true;
    } catch (error) {
      log(`[notify] Discord bot send failed (${error.message}); falling back to webhook if configured.`);
    }
  } else if (botConfigured) {
    log("[notify] Discord bot not connected; using webhook fallback if configured.");
  }

  // Webhook fallback, used when the bot path is unavailable or failed.
  if (!botDelivered && config.notifications.discordWebhookUrl) {
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

  // Dedupe ledger: the Discord-bot path records job_posts per successful send (with
  // the real message_id, needed for button/status updates). Webhook/telegram-only
  // delivery records nothing, so getUnnotifiedJobs would re-admit these jobs every
  // cycle. Record a ledger row here for any job delivered via a non-bot path.
  if (notified && !botDelivered && !options.dryRun) {
    for (const job of jobs) {
      try {
        upsertJobPost(job.key, null, null, config.notifications.discordChannelId || null);
      } catch (error) {
        log(`[notify] Ledger write failed for ${job.key}: ${error.message}`);
      }
    }
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
      // Check if the job URL is still live before processing
      const live = await isJobUrlLive(job.url);
      if (!live) {
        log(`[liveness] Dead link: ${job.sourceLabel} — ${job.title} (${job.url})`);
        return null;
      }

      const dirId = jobDirId(job);
      let description = null;
      try {
        description = await fetchJobDescription(job);
        await saveJobData(job, description || "");
      } catch (error) {
        log(`Failed to fetch description for ${dirId}: ${error.message}`);
      }
      const rawWarnings = checkJobDescription(description);

      // Strip the generic experience warning — we'll add an education-aware
      // one below that picks the tier matching PERSONAL_PROFILE.education_level
      const warnings = rawWarnings.filter((w) => !/^\d+\+ years required/.test(w.text));

      if (description) {
        const tierInfo = extractExperienceTiers(description);
        const yearsForUser = pickTierYearsForUser(
          tierInfo.tiers,
          tierInfo.fallbackMax,
          PERSONAL_PROFILE.education_level
        );
        if (yearsForUser >= 5) {
          warnings.push({ text: `${yearsForUser}+ years required`, severity: "soft" });
        }
      }

      let legitimacy;
      try {
        legitimacy = checkLegitimacy(job, description);
        updateJobLegitimacy(job.key, legitimacy.tier, JSON.stringify(legitimacy.signals));
      } catch (err) {
        log(`[legitimacy] Error for ${job.key}: ${err.message}`);
        legitimacy = { tier: "high_confidence", topSignal: null, signals: [] };
      }

      return { job, warnings, legitimacy };
    }));
    results.push(...batchResults.filter(Boolean));
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

  const newJobs = getUnnotifiedJobs(filtered);
  const freshJobs = newJobs.filter((job) => jobIsFresh(job, now, config));
  const staleJobs = newJobs.filter((job) => !jobIsFresh(job, now, config));

  if (staleJobs.length > 0) {
    log(`[${batchLabel}] Suppressed ${staleJobs.length} stale jobs.`);
  }

  // Upsert BEFORE notifying — prevents duplicate notifications if the next batch
  // cycle runs before notifications finish sending
  if (!flags.dryRun) {
    upsertJobs(filtered, now);
  }

  if (freshJobs.length > 0) {
    // Apply personal bot filter — only SWE entry/mid (legacy behavior)
    const personalFiltered = freshJobs.filter((job) => filterJobForUser(job, PERSONAL_PROFILE).pass);
    const jobsToNotify = personalFiltered.slice(0, config.maxNewJobsPerNotify);
    const filteredJobs = await fetchDescriptionsAndFilter(jobsToNotify);

    for (const { job, warnings } of filteredJobs) {
      const flag = warnings.length > 0 ? ` [FLAGGED: ${warnings.map((w) => w.text).join("; ")}]` : "";
      log(`${job.sourceLabel}: ${job.title} | ${job.location || "Location not mentioned"}${flag}`);
    }

    const notifiableJobs = filteredJobs.filter((r) => r.legitimacy?.tier !== "suspicious");
    const suppressed = filteredJobs.length - notifiableJobs.length;
    if (suppressed > 0) log(`[legitimacy] Suppressed ${suppressed} suspicious job(s)`);

    const legitimacyMap = new Map();
    for (const { job, legitimacy } of notifiableJobs) {
      if (legitimacy) legitimacyMap.set(job.key, legitimacy);
    }

    await sendNotifications(config, notifiableJobs.map((r) => r.job), notifiableJobs, { dryRun: flags.dryRun, legitimacyMap });
  }
}

// --- Batch Collection ---

async function collectBatch(config, entries) {
  const COLLECTOR_TIMEOUT_MS = 30_000;
  let errorCount = 0;
  const results = await Promise.all(
    entries.map(async (entry) => {
      try {
        return await Promise.race([
          entry.collect(config),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Collector timed out after 30s')), COLLECTOR_TIMEOUT_MS)
          ),
        ]);
      } catch (error) {
        errorCount += 1;
        log(`[${entry.key}] Collection error: ${error.message}`);
        return [];
      }
    })
  );
  return {
    jobs: dedupeJobs(results.flat()),
    totalCount: entries.length,
    errorCount,
  };
}

// --- Main Loop: Rolling Window with Batching ---

async function runBatchLoop(config, flags, registry) {
  const fastEntries = registry.filter((e) => e.lane === "fast");
  const normalEntries = registry.filter((e) => e.lane === "normal");
  const slowEntries = registry.filter((e) => e.lane === "slow");

  const batchSize = config.batchSize;
  const batchDelayMs = config.batchDelayMs;
  const fastTrackIntervalMs = Math.max(0, config.fastTrackIntervalSeconds || 0) * 1000;
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
    const { jobs: allJobs } = await collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries]);
    log(`Collected ${allJobs.length} total candidate jobs for seeding.`);
    await processBatchResults(config, flags, allJobs, "seed");
    return;
  }

  // First-run detection
  if (!hasSeenJobs() && !flags.notifyExisting) {
    log("First run detected. Seeding all sources without notifications...");
    const { jobs: allJobs } = await collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries]);
    log(`Seeded ${allJobs.length} jobs.`);
    if (!flags.dryRun) {
      upsertJobs(allJobs.filter((j) => jobMatchesCountryFilter(j, config.countryFilter)), timestamp());
    }
    if (!flags.watch) return;
    log("Seeding complete. Starting batch rotation...");
  }

  let batchIndex = 0;
  let lastSlowRun = 0;
  let lastFastRun = 0;
  const lastPlaywrightSourceRuns = new Map();
  let rotationCount = 0;
  let lastSavedExpiry = 0;
  // pruneState does unindexed-ish range scans + a synchronous fs sweep; the
  // retention boundary only moves once a day, so run it hourly rather than on
  // every ~minute rotation. (The initial prune already ran above at startup.)
  let lastPruneAt = Date.now();
  const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

  function advanceBatchIndex() {
    batchIndex = (batchIndex + 1) % totalBatches;
    return batchIndex === 0;
  }

  async function finishRotation() {
    rotationCount++;
    if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
      lastPruneAt = Date.now();
      try {
        pruneState(config.retentionDays);
      } catch (error) {
        if (isSqliteBusy(error)) {
          await backoffAfterDbBusy(config, "prune", error);
        } else {
          throw error;
        }
      }
    }
    if (rotationCount % 10 === 0) {
      log(`Completed ${rotationCount} full rotations.`);
    }
  }

  while (true) {
    const cycleStart = Date.now();

    try {
      // --- Fast lane: runs on its own short interval ---
      if (fastEntries.length > 0 && (lastFastRun === 0 || (Date.now() - lastFastRun) >= fastTrackIntervalMs)) {
        lastFastRun = Date.now();
        try {
          const { jobs: fastJobs } = await collectBatch(config, fastEntries);
          await processBatchResults(config, flags, fastJobs, "fast");
        } catch (fastError) {
          if (isSqliteBusy(fastError)) {
            await backoffAfterDbBusy(config, "fast lane", fastError);
          } else {
            log(`[fast lane] Error: ${fastError.message}`);
          }
        }
      }

      // --- Normal lane: current batch ---
      if (batches.length > 0) {
        const currentBatch = batches[batchIndex];
        const batchLabel = `batch ${batchIndex + 1}/${totalBatches}`;
        try {
          log(`[${batchLabel}] Running ${currentBatch.length} companies: ${currentBatch.map((e) => e.key).join(", ")}`);
          const batchResult = await collectBatch(config, currentBatch);
          await processBatchResults(config, flags, batchResult.jobs, batchLabel);

          if (batchResult.totalCount > 0 && batchResult.errorCount === batchResult.totalCount) {
            void pingFail(config.heartbeat.micro, `all ${batchResult.totalCount} collectors in ${batchLabel} failed`);
          } else {
            void ping(config.heartbeat.micro);
          }

          if (advanceBatchIndex()) {
            await finishRotation();
          }
        } catch (batchError) {
          if (!isSqliteBusy(batchError)) throw batchError;
          advanceBatchIndex();
          await backoffAfterDbBusy(config, batchLabel, batchError);
        }
      }

      // --- Slow lane: runs on its own timer ---
      if (slowEntries.length > 0 && (Date.now() - lastSlowRun) >= slowCycleMs) {
        log(`Running slow lane (${slowEntries.length} sources)...`);
        // Run slow entries sequentially with a 60-second timeout each
        for (const entry of slowEntries) {
          if (entry.usesPlaywright) {
            const schedule = shouldRunScheduledPlaywrightSource(config);
            if (!schedule.ok) {
              log(`[slow:${entry.key}] Skipped Playwright source: ${schedule.reason}`);
              continue;
            }

            const minIntervalMs = Math.max(1, config.playwrightNightRunIntervalMinutes) * 60 * 1000;
            const lastRunAt = lastPlaywrightSourceRuns.get(entry.key) || 0;
            if ((Date.now() - lastRunAt) < minIntervalMs) {
              continue;
            }
            lastPlaywrightSourceRuns.set(entry.key, Date.now());
          }

          try {
            const entryConfig = entry.usesPlaywright
              ? { ...config, maxPostAgeMinutes: config.nightlyPlaywrightMaxPostAgeMinutes }
              : config;
            const jobs = await Promise.race([
              entry.collect(entryConfig),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 60s")), 60000))
            ]);
            await processBatchResults(entryConfig, flags, jobs, `slow:${entry.key}`);
          } catch (error) {
            if (isSqliteBusy(error)) {
              await backoffAfterDbBusy(config, `slow:${entry.key}`, error);
            } else {
              log(`[slow:${entry.key}] Error: ${error.message}`);
            }
          }
        }
        lastSlowRun = Date.now();
      }

      // Hourly: expire saved job_posts older than 7 days
      if (Date.now() - lastSavedExpiry >= 60 * 60 * 1000) {
        lastSavedExpiry = Date.now();
        try {
          const expired = expireSavedJobPosts();
          if (expired > 0) log(`Expired ${expired} saved job posts`);
        } catch (error) {
          if (isSqliteBusy(error)) {
            await backoffAfterDbBusy(config, "saved-expiry", error);
          } else {
            throw error;
          }
        }
      }
    } catch (cycleError) {
      log(`[cycle] Unhandled error: ${cycleError.message}`);
      void pingFail(config.heartbeat.micro, cycleError.message);
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
  const { jobs: allJobs } = await collectBatch(config, allEntries);
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
const INCOMPLETE_LOCK_GRACE_MS = 10_000;
let lockFd = null;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockOwner(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return { incomplete: true };
    try {
      const owner = JSON.parse(raw);
      const pid = Number.parseInt(String(owner.pid ?? ""), 10);
      return Number.isFinite(pid) && pid > 0 ? { ...owner, pid } : { invalid: true };
    } catch {
      const pid = Number.parseInt(raw, 10);
      return Number.isFinite(pid) && pid > 0 ? { pid } : { invalid: true };
    }
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    return null;
  }
}

function readPidFile(file) {
  return readLockOwner(file)?.pid ?? null;
}

function processIsRunning(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function procCommand(pid) {
  if (process.platform !== "linux") return "";
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return "";
  }
}

function processLooksLikeBot(pid) {
  const command = procCommand(pid);
  if (!command) return true;
  return /\bnode(?:\.exe)?\b/i.test(command) &&
    (command.includes("src/index.js") ||
      command.includes("job-alert-bot") ||
      command.includes("Job-Pulse"));
}

function lockOwnerIsLive(owner) {
  return Boolean(owner?.pid && processIsRunning(owner.pid) && processLooksLikeBot(owner.pid));
}

function fileIsFresh(file, maxAgeMs) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

function clearStaleLockFiles() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

function writeLockMetadata(fd) {
  const owner = {
    pid: process.pid,
    hostname: os.hostname(),
    startedAt: new Date().toISOString(),
    argv: process.argv,
  };
  fs.writeSync(fd, JSON.stringify(owner));
  fs.fsyncSync(fd);
}

function acquireLock() {
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    const existingOwner = readLockOwner(LOCK_FILE) || readLockOwner(PID_FILE);
    if (lockOwnerIsLive(existingOwner)) {
      console.error(`[startup] Existing bot process ${existingOwner.pid} is still running.`);
      return false;
    }
    if (existingOwner?.pid) {
      console.warn(`[startup] Removing stale bot lock for dead process ${existingOwner.pid}.`);
      clearStaleLockFiles();
    } else if ((existingOwner?.incomplete || existingOwner?.invalid) && fileIsFresh(LOCK_FILE, INCOMPLETE_LOCK_GRACE_MS)) {
      sleepSync(100);
      continue;
    } else if (existingOwner?.incomplete || existingOwner?.invalid) {
      console.warn("[startup] Removing stale bot lock with unreadable owner metadata.");
      clearStaleLockFiles();
    }

    try {
      lockFd = fs.openSync(LOCK_FILE, "wx");
      writeLockMetadata(lockFd);
      return true;
    } catch (err) {
      if (err?.code !== "EEXIST") {
        console.error(`[startup] Failed to create lock file: ${err.message}`);
        return false;
      }

      const lockOwner = readLockOwner(LOCK_FILE);
      if (lockOwnerIsLive(lockOwner)) {
        console.error(`[startup] Existing bot process ${lockOwner.pid} owns the lock.`);
        return false;
      }

      if ((lockOwner?.incomplete || lockOwner?.invalid) && fileIsFresh(LOCK_FILE, INCOMPLETE_LOCK_GRACE_MS)) {
        sleepSync(100);
        continue;
      }

      console.warn("[startup] Removing stale bot lock with no live owner.");
      clearStaleLockFiles();
    }
  }

  console.error("[startup] Failed to acquire lock after retries.");
  return false;
}

function writePidFile() {
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), { flag: "wx" });
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    const owner = readLockOwner(PID_FILE);
    if (lockOwnerIsLive(owner)) {
      throw new Error(`PID file is owned by live process ${owner.pid}`);
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
    fs.writeFileSync(PID_FILE, String(process.pid), { flag: "wx" });
  }
}

function releaseLock() {
  if (lockFd !== null) {
    try { fs.closeSync(lockFd); } catch {}
    lockFd = null;
  }
  const lockPid = readPidFile(LOCK_FILE);
  if (!lockPid || lockPid === process.pid) {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  }
}

function releasePidFile() {
  const pid = readPidFile(PID_FILE);
  if (!pid || pid === process.pid) {
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
}

// --- Main ---

process.title = "job-alert-bot";

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  // Heartbeat: fire a fail-ping on any uncaught error before the process dies.
  // We resolve the URL lazily inside the handler so getConfig() has already run by then.
  const heartbeatUrl = () => {
    try { return getConfig().heartbeat.micro; } catch { return ""; }
  };
  process.on("uncaughtException", (err) => {
    log(`[heartbeat] uncaughtException: ${err?.message}`);
    pingFail(heartbeatUrl(), `uncaughtException: ${err?.message}`).finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    log(`[heartbeat] unhandledRejection: ${reason?.message ?? reason}`);
    pingFail(heartbeatUrl(), `unhandledRejection: ${reason?.message ?? reason}`).finally(() => process.exit(1));
  });

  if (flags.watch && !acquireLock()) {
    console.error(`[${timestamp()}] Another bot instance is already running. Exiting.`);
    process.exitCode = 1;
    return;
  }

  if (flags.watch) {
    try {
      writePidFile();
    } catch (err) {
      releaseLock();
      console.error(`[${timestamp()}] Failed to write PID file: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const cleanup = () => { releasePidFile(); releaseLock(); };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { stopDiscordBot(); closeDb(); cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { stopDiscordBot(); closeDb(); cleanup(); process.exit(0); });
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
