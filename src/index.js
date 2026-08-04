import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig, PROJECT_ROOT } from "./private-config.js";
import { sendDiscordBotNotification, startDiscordBot, stopDiscordBot, isDiscordBotConnected } from "./discord-bot.js";
import { sendDiscordNotification } from "./notifiers/discord.js";
import { sendTelegramNotification } from "./notifiers/telegram.js";
import { delay, jobIsFresh, jobMatchesCountryFilter } from "./sources/shared.js";
import { filterJobForUser } from "./filter.js";
import { PERSONAL_PROFILE } from "./personal-profile.js";
import {
  initDb, closeDb, migrateFromJson,
  getUnnotifiedJobs, upsertJobs, pruneState, hasSeenJobs, expireSavedJobPosts,
  updateJobLegitimacy, recordExternalDelivery, getRepostCount,
  claimPersonalDelivery, releasePersonalDeliveryClaim
} from "./state.js";
import { ping, pingFail } from "./heartbeat.js";
import {
  allWindowCollectorsFailed,
  collectorFailureReason,
  createCollectorHealthWindow,
} from "./collector-health.js";
import { shouldRunScheduledPlaywrightSource } from "./playwright-guard.js";
import { allCollectorsFailed, buildCollectorRegistry, collectBatch, inspectJobs } from "./pipeline.js";

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

async function backoffAfterDbBusy(config, label, error, { notify = true } = {}) {
  const backoffMs = Math.max(0, Number(config.dbBusyBackoffMs) || 0);
  log(`[${label}] Database busy: ${error.message}. Backing off ${backoffMs}ms.`);
  if (notify) void pingFail(config.heartbeat.micro, `${label}: ${error.message}`);
  if (backoffMs > 0) await delay(backoffMs);
}

function pingCollectionHealth(config, collection, label) {
  if (!collection || collection.totalCount <= 0) return Promise.resolve();
  if (allWindowCollectorsFailed(collection)) {
    return pingFail(
      config.heartbeat.micro,
      collectorFailureReason(collection, label),
    );
  }
  return ping(config.heartbeat.micro);
}

function logCollectionFailures(collection, label) {
  if (!collection || collection.errorCount <= 0) return;
  const keys = (collection.errors || [])
    .map((failure) => String(failure?.key || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const suffix = keys.length > 0 ? `: ${keys.join(", ")}` : "";
  log(`[${label}] ${collection.errorCount}/${collection.totalCount} collector attempts failed${suffix}`);
}

const FAST_RATE_LIMIT_BACKOFF_MIN_MS = 60_000;
const FAST_RATE_LIMIT_BACKOFF_MAX_MS = 60 * 60_000;

function rateLimitMetadata(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (Number(current.status) === 429) {
      const retryAfterMs = Number(current.retryAfterMs);
      return {
        retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs >= 0
          ? retryAfterMs
          : 0,
      };
    }
    current = current.cause;
  }
  return null;
}

function nextFastRateLimitBackoff(previousAttempts, fastTrackIntervalMs, retryAfterMs) {
  const attempts = Math.max(0, Number(previousAttempts) || 0) + 1;
  // A one-interval retry would preserve the request rate that triggered the
  // limit. Start at twice the normal interval, then double on consecutive 429s.
  const baseMs = Math.max(FAST_RATE_LIMIT_BACKOFF_MIN_MS, fastTrackIntervalMs * 2);
  const exponentialMs = Math.min(
    FAST_RATE_LIMIT_BACKOFF_MAX_MS,
    baseMs * (2 ** Math.min(attempts - 1, 10)),
  );
  // Retry-After is authoritative when it asks us to wait longer than the local
  // exponential schedule. Fixed Microsoft endpoints are trusted input here.
  const delayMs = Math.max(exponentialMs, retryAfterMs || 0);
  return { attempts, delayMs };
}

// --- Notifications ---

export async function sendNotifications(config, jobs, filteredResults, options = {}) {
  const adapters = {
    isDiscordBotConnected,
    sendDiscordBotNotification,
    sendDiscordNotification,
    sendTelegramNotification,
    ...options.deliveryAdapters,
  };
  const notifierOptions = { ...options };
  delete notifierOptions.deliveryAdapters;
  const warningsMap = new Map();
  if (filteredResults) {
    for (const { job, warnings } of filteredResults) {
      if (warnings.length > 0) {
        warningsMap.set(job.key, warnings);
      }
    }
  }

  const botConfigured = config.notifications.discordBotToken && config.notifications.discordChannelId;
  const botAvailable = Boolean(botConfigured && adapters.isDiscordBotConnected());
  if (botConfigured && !botAvailable) {
    log("[notify] Discord bot not connected; using webhook fallback if configured.");
  }
  const telegramEnabled = process.env.TELEGRAM_ENABLED === "1";
  const telegramAvailable = Boolean(
    telegramEnabled &&
    config.notifications.telegramBotToken &&
    config.notifications.telegramChatId
  );
  const summary = { delivered: [], uncertain: [], failed: [], alreadyClaimed: [] };

  function hasOutcome(result, field, job) {
    return Boolean(result?.[field]?.some((candidate) => candidate.key === job.key));
  }

  function logOutcomeErrors(label, result) {
    for (const error of result?.errors || []) {
      log(`[notify] ${label}: ${error.message}`);
    }
  }

  // Claim and deliver one job at a time. Claiming an entire batch up front
  // strands the unsent tail if the process exits midway. The persistent
  // sentinel also resolves concurrent collector processes atomically.
  for (const job of jobs) {
    let claimToken = null;
    let claimed = options.dryRun;
    if (!options.dryRun) {
      try {
        claimToken = claimPersonalDelivery(job.key, config.notifications.discordChannelId);
        claimed = Boolean(claimToken);
      } catch (error) {
        log(`[notify] Could not claim ${job.key}: ${error.message}`);
        summary.failed.push(job);
        continue;
      }
    }
    if (!claimed) {
      summary.alreadyClaimed.push(job);
      continue;
    }

    let delivered = false;
    let uncertain = false;

    // Discord bot is primary because a successful post stores its real message
    // id for the personal Saved/Applied controls.
    if (botAvailable) {
      try {
        const result = await adapters.sendDiscordBotNotification([job], warningsMap, {
          ...notifierOptions,
          claimTokens: new Map([[job.key, claimToken]]),
        });
        delivered = hasOutcome(result, "deliveredJobs", job);
        uncertain = hasOutcome(result, "uncertainJobs", job);
        logOutcomeErrors("Discord bot", result);
      } catch (error) {
        // Formatting/channel lookup failures happen before channel.send and are
        // therefore known failures that may safely use the fallback.
        log(`[notify] Discord bot: ${error.message}`);
      }
    }

    // A known bot failure falls through to the webhook. The per-chunk callback
    // commits the ledger immediately; if that commit fails, the notifier marks
    // the result uncertain and the durable claim prevents a duplicate retry.
    if (!delivered && !uncertain && config.notifications.discordWebhookUrl) {
      try {
        const result = await adapters.sendDiscordNotification(
          config.notifications.discordWebhookUrl,
          [job],
          {
            ...notifierOptions,
            async onChunkDelivered(deliveredJobs) {
              if (options.dryRun) return;
              for (const deliveredJob of deliveredJobs) {
                const finalized = recordExternalDelivery(
                  deliveredJob.key,
                  config.notifications.discordChannelId,
                  claimToken,
                );
                if (!finalized) throw new Error(`Delivery claim ownership was lost for ${deliveredJob.key}`);
              }
            },
          }
        );
        delivered = hasOutcome(result, "deliveredJobs", job);
        uncertain = hasOutcome(result, "uncertainJobs", job);
        logOutcomeErrors("Discord webhook", result);
      } catch (error) {
        log(`[notify] Discord webhook: ${error.message}`);
      }
    }

    // Telegram is intentionally a dormant fallback, not a second mirrored
    // channel. A shared single-channel ledger cannot safely retry one mirror
    // without duplicating another.
    if (!delivered && !uncertain && telegramAvailable) {
      try {
        const result = await adapters.sendTelegramNotification(
          config.notifications.telegramBotToken,
          config.notifications.telegramChatId,
          [job],
          {
            ...notifierOptions,
            async onChunkDelivered(deliveredJobs) {
              if (options.dryRun) return;
              for (const deliveredJob of deliveredJobs) {
                const finalized = recordExternalDelivery(deliveredJob.key, "telegram", claimToken);
                if (!finalized) throw new Error(`Delivery claim ownership was lost for ${deliveredJob.key}`);
              }
            },
          }
        );
        delivered = hasOutcome(result, "deliveredJobs", job);
        uncertain = hasOutcome(result, "uncertainJobs", job);
        logOutcomeErrors("Telegram", result);
      } catch (error) {
        log(`[notify] Telegram: ${error.message}`);
      }
    }

    if (delivered) {
      summary.delivered.push(job);
    } else if (uncertain) {
      summary.uncertain.push(job);
    } else {
      summary.failed.push(job);
      if (!options.dryRun) {
        try {
          const released = releasePersonalDeliveryClaim(job.key, claimToken);
          if (!released) log(`[notify] Claim for ${job.key} was retained because ownership changed.`);
        } catch (error) {
          log(`[notify] Failed to release claim for ${job.key}: ${error.message}`);
        }
      }
    }
  }

  return summary;
}

// --- Description Fetching & Filtering ---

async function fetchDescriptionsAndFilter(jobs) {
  return inspectJobs(jobs, {
    profile: PERSONAL_PROFILE,
    logger: log,
    persistDescriptions: true,
    getRepostCount,
    recordLegitimacy(job, legitimacy) {
      updateJobLegitimacy(job.key, legitimacy.tier, JSON.stringify(legitimacy.signals));
    },
  });
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

  // Canonicalize/remap persisted jobs before consulting the notification
  // ledger. A source can change title, location, or URL for the same posting;
  // state.upsertJobs migrates legacy mutable keys to the stable incoming key.
  // Looking at job_posts first would misclassify that edit as a new job.
  if (!flags.dryRun) {
    upsertJobs(filtered, now);
  }

  const newJobs = getUnnotifiedJobs(filtered);
  const freshJobs = newJobs.filter((job) => jobIsFresh(job, now, config));
  const staleJobs = newJobs.filter((job) => !jobIsFresh(job, now, config));

  if (staleJobs.length > 0) {
    log(`[${batchLabel}] Suppressed ${staleJobs.length} stale jobs.`);
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

// --- Main Loop: Rolling Window with Batching ---

export async function runBatchLoop(config, flags, registry, runtimeOptions = {}) {
  const services = {
    collectBatch,
    delay,
    expireSavedJobPosts,
    hasSeenJobs,
    ping,
    pingFail,
    processBatchResults,
    pruneState,
    upsertJobs,
    ...(runtimeOptions.services || {}),
  };
  const maxCycles = runtimeOptions.maxCycles ?? Number.POSITIVE_INFINITY;
  if (!(maxCycles === Number.POSITIVE_INFINITY ||
      (Number.isInteger(maxCycles) && maxCycles > 0))) {
    throw new TypeError("maxCycles must be a positive integer");
  }

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
  services.pruneState(config.retentionDays);

  // Seed mode: run everything once
  if (flags.seedOnly) {
    log("Seed-only mode. Collecting all sources...");
    const seedResult = await services.collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries], { logger: log });
    const allJobs = seedResult.jobs;
    if (allJobs.length === 0 || seedResult.errorCount === seedResult.totalCount) {
      throw new Error(`Seed aborted: collected no jobs (${seedResult.errorCount}/${seedResult.totalCount} collectors failed)`);
    }
    log(`Collected ${allJobs.length} total candidate jobs for seeding.`);
    await services.processBatchResults(config, flags, allJobs, "seed");
    return;
  }

  // First-run detection
  if (!services.hasSeenJobs() && !flags.notifyExisting) {
    log("First run detected. Seeding all sources without notifications...");
    const seedResult = await services.collectBatch(config, [...fastEntries, ...normalEntries, ...slowEntries], { logger: log });
    const allJobs = seedResult.jobs;
    if (allJobs.length === 0 || seedResult.errorCount === seedResult.totalCount) {
      await services.pingFail(config.heartbeat.micro, `initial seed failed: ${seedResult.errorCount}/${seedResult.totalCount} collectors failed and no jobs were collected`);
      // Exit instead of entering the notification loop with an empty baseline.
      // A process supervisor can retry safely; otherwise the first recovered
      // scrape would alert the entire corpus as if every posting were new.
      throw new Error("Initial seed failed; refusing to start notification rotation without a baseline");
    }
    log(`Seeded ${allJobs.length} jobs.`);
    if (!flags.dryRun) {
      services.upsertJobs(allJobs.filter((j) => jobMatchesCountryFilter(j, config.countryFilter)), timestamp());
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
  const normalRotationHealth = createCollectorHealthWindow();
  let fastCollectorsUnhealthy = false;
  let fastCollectorFailureMessage = "";
  const fastRateLimitBackoffs = new Map();
  let normalCollectorsUnhealthy = false;
  let normalCollectorFailureMessage = "";
  let slowCollectorsUnhealthy = false;
  let slowCollectorFailureMessage = "";
  let completedCycles = 0;
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
    const collection = normalRotationHealth.take();
    let maintenanceError = null;

    if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
      try {
        services.pruneState(config.retentionDays);
        lastPruneAt = Date.now();
      } catch (error) {
        maintenanceError = `prune: ${error.message}`;
        if (isSqliteBusy(error)) {
          await backoffAfterDbBusy(config, "prune", error, { notify: false });
        } else {
          log(`[prune] Error: ${error.message}`);
        }
      }
    }
    logCollectionFailures(collection, "normal rotation");
    if (rotationCount % 10 === 0) {
      log(`Completed ${rotationCount} full rotations.`);
    }
    return { collection, maintenanceError };
  }

  while (true) {
    const cycleStart = Date.now();
    let cycleFailureReason = null;

    try {
      // --- Fast lane: runs on its own short interval ---
      if (fastEntries.length > 0 && (lastFastRun === 0 || (Date.now() - lastFastRun) >= fastTrackIntervalMs)) {
        const fastRunAt = Date.now();
        lastFastRun = fastRunAt;
        const eligibleFastEntries = fastEntries.filter((entry) => {
          const backoff = fastRateLimitBackoffs.get(entry.key);
          return !backoff || backoff.retryAt <= fastRunAt;
        });
        const deferredFastEntries = fastEntries.length - eligibleFastEntries.length;
        if (deferredFastEntries > 0) {
          log(`[fast lane] Deferred ${deferredFastEntries} rate-limited source(s); running ${eligibleFastEntries.length}.`);
        }
        try {
          if (eligibleFastEntries.length > 0) {
            const fastResult = await services.collectBatch(config, eligibleFastEntries, { logger: log });
            const failedKeys = new Set();
            for (const failure of fastResult.errors || []) {
              failedKeys.add(failure.key);
              const rateLimit = rateLimitMetadata(failure.error);
              if (!rateLimit) {
                fastRateLimitBackoffs.delete(failure.key);
                continue;
              }

              const previous = fastRateLimitBackoffs.get(failure.key);
              const backoff = nextFastRateLimitBackoff(
                previous?.attempts,
                fastTrackIntervalMs,
                rateLimit.retryAfterMs,
              );
              const retryAt = Date.now() + backoff.delayMs;
              fastRateLimitBackoffs.set(failure.key, { ...backoff, retryAt });
              log(
                `[fast:${failure.key}] HTTP 429; backing off for ${Math.ceil(backoff.delayMs / 1000)}s ` +
                `(attempt ${backoff.attempts}).`,
              );
            }
            for (const entry of eligibleFastEntries) {
              if (!failedKeys.has(entry.key)) fastRateLimitBackoffs.delete(entry.key);
            }
            logCollectionFailures(fastResult, "fast lane");
            if (fastResult.totalCount > 0) {
              fastCollectorsUnhealthy = allWindowCollectorsFailed(fastResult);
              fastCollectorFailureMessage = fastCollectorsUnhealthy
                ? collectorFailureReason(fastResult, "fast lane")
                : "";
            }
            await services.processBatchResults(config, flags, fastResult.jobs, "fast");
          }
        } catch (fastError) {
          cycleFailureReason ||= `fast lane: ${fastError.message}`;
          if (isSqliteBusy(fastError)) {
            await backoffAfterDbBusy(config, "fast lane", fastError, { notify: false });
          } else {
            log(`[fast lane] Error: ${fastError.message}`);
          }
        }
      }

      // --- Normal lane: current batch ---
      if (batches.length > 0) {
        const currentBatch = batches[batchIndex];
        const batchLabel = `batch ${batchIndex + 1}/${totalBatches}`;
        let batchResult = null;
        try {
          log(`[${batchLabel}] Running ${currentBatch.length} companies: ${currentBatch.map((e) => e.key).join(", ")}`);
          batchResult = await services.collectBatch(config, currentBatch, { logger: log });
          normalRotationHealth.record(batchResult);
          logCollectionFailures(batchResult, batchLabel);
          await services.processBatchResults(config, flags, batchResult.jobs, batchLabel);
        } catch (batchError) {
          if (!batchResult) {
            normalRotationHealth.record({
              totalCount: currentBatch.length,
              errorCount: currentBatch.length,
              errors: currentBatch.map((entry) => ({ key: entry.key, error: batchError })),
            });
          }
          cycleFailureReason ||= `${batchLabel}: ${batchError.message}`;
          // Advance rotation on EVERY error. Previously only SQLITE_BUSY
          // advanced; any other persistent per-batch failure kept batchIndex
          // frozen, silently starving all later batches while the heartbeat
          // stayed green on the fast lane.
          if (isSqliteBusy(batchError)) {
            await backoffAfterDbBusy(config, batchLabel, batchError, { notify: false });
          } else {
            log(`[${batchLabel}] Error: ${batchError.message}`);
          }
        }

        // Advance exactly once even when collection or processing fails. If the
        // final batch errors, still close/reset the window and run rotation
        // maintenance instead of carrying stale counts into the next rotation.
        if (advanceBatchIndex()) {
          const completion = await finishRotation();
          if (completion.maintenanceError) {
            cycleFailureReason ||= completion.maintenanceError;
          }
          if (completion.collection.totalCount > 0) {
            if (allWindowCollectorsFailed(completion.collection)) {
              normalCollectorsUnhealthy = true;
              normalCollectorFailureMessage = collectorFailureReason(
                completion.collection,
                "normal rotation",
              );
            } else {
              normalCollectorsUnhealthy = false;
              normalCollectorFailureMessage = "";
            }
          }
        }
      }

      // --- Slow lane: runs on its own timer ---
      if (slowEntries.length > 0 && (Date.now() - lastSlowRun) >= slowCycleMs) {
        log(`Running slow lane (${slowEntries.length} sources)...`);
        // Run slow entries sequentially with a 60-second timeout each
        const slowHealth = createCollectorHealthWindow();
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

          let entryResult = null;
          try {
            const entryConfig = entry.usesPlaywright
              ? { ...config, maxPostAgeMinutes: config.nightlyPlaywrightMaxPostAgeMinutes }
              : config;
            entryResult = await services.collectBatch(entryConfig, [entry], {
              logger: log,
              timeoutMs: 60_000,
            });
            slowHealth.record(entryResult);
            await services.processBatchResults(entryConfig, flags, entryResult.jobs, `slow:${entry.key}`);
          } catch (error) {
            if (!entryResult) {
              slowHealth.record({
                totalCount: 1,
                errorCount: 1,
                errors: [{ key: entry.key, error }],
              });
            }
            cycleFailureReason ||= `slow lane: ${error.message}`;
            if (isSqliteBusy(error)) {
              await backoffAfterDbBusy(config, `slow:${entry.key}`, error, { notify: false });
            } else {
              log(`[slow:${entry.key}] Error: ${error.message}`);
            }
          }
        }
        const slowCollection = slowHealth.take();
        logCollectionFailures(slowCollection, "slow lane");
        if (slowCollection.totalCount > 0) {
          slowCollectorsUnhealthy = allWindowCollectorsFailed(slowCollection);
          slowCollectorFailureMessage = slowCollectorsUnhealthy
            ? collectorFailureReason(slowCollection, "slow lane")
            : "";
        }
        lastSlowRun = Date.now();
      }

      // Hourly: expire saved job_posts older than 7 days
      if (Date.now() - lastSavedExpiry >= 60 * 60 * 1000) {
        try {
          const expired = services.expireSavedJobPosts();
          lastSavedExpiry = Date.now();
          if (expired > 0) log(`Expired ${expired} saved job posts`);
        } catch (error) {
          if (isSqliteBusy(error)) {
            cycleFailureReason ||= `saved-expiry: ${error.message}`;
            await backoffAfterDbBusy(config, "saved-expiry", error, { notify: false });
          } else {
            throw error;
          }
        }
      }
    } catch (cycleError) {
      log(`[cycle] Unhandled error: ${cycleError.message}`);
      cycleFailureReason ||= `cycle: ${cycleError.message}`;
    }

    // Emit one ordered state transition per cycle. Individual source failures
    // are logged; a complete fast/slow lane or full normal rotation outage
    // stays red until that scheduling window next succeeds. Runtime/DB failures
    // take precedence.
    if (cycleFailureReason) {
      await services.pingFail(config.heartbeat.micro, cycleFailureReason);
    } else if (normalCollectorsUnhealthy) {
      await services.pingFail(config.heartbeat.micro, normalCollectorFailureMessage);
    } else if (fastCollectorsUnhealthy) {
      await services.pingFail(config.heartbeat.micro, fastCollectorFailureMessage);
    } else if (slowCollectorsUnhealthy) {
      await services.pingFail(config.heartbeat.micro, slowCollectorFailureMessage);
    } else {
      await services.ping(config.heartbeat.micro);
    }

    completedCycles++;
    if (!flags.watch || completedCycles >= maxCycles) break;

    // Wait before next batch
    const elapsed = Date.now() - cycleStart;
    const waitMs = Math.max(500, batchDelayMs - elapsed);
    await services.delay(waitMs);
  }
}

// --- Single-run mode (non-watch) ---

async function runOnce(config, flags, registry) {
  const allEntries = registry;

  pruneState(config.retentionDays);

  log("Single run: collecting all sources...");
  const collection = await collectBatch(config, allEntries, { logger: log });
  if (allCollectorsFailed(collection)) {
    await pingCollectionHealth(config, collection, "single run");
    throw new Error(`Single run failed: all ${collection.totalCount} collectors failed`);
  }
  log(`Collected ${collection.jobs.length} total candidate jobs.`);
  await processBatchResults(config, flags, collection.jobs, "all");
  await pingCollectionHealth(config, collection, "single run");
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
  const registry = buildCollectorRegistry(config, log);
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

export function isEntrypoint(moduleUrl, options = {}) {
  const argvPath = options.argvPath ?? process.argv[1];
  // PM2 starts a wrapper process and imports the configured script, so
  // process.argv[1] is not guaranteed to identify this module. PM2 exposes the
  // exact configured script as pm_exec_path; require an exact file-URL match so
  // ordinary test/library imports still remain side-effect free.
  const pmExecPath = options.pmExecPath ?? process.env.pm_exec_path;
  return [argvPath, pmExecPath]
    .filter(Boolean)
    .some((candidate) => {
      try {
        return pathToFileURL(path.resolve(candidate)).href === moduleUrl;
      } catch {
        return false;
      }
    });
}

if (isEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[${timestamp()}] ${error.message}`);
    process.exitCode = 1;
  });
}
