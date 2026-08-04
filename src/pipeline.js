/**
 * Public collection and processing pipeline.
 *
 * Persistence, user accounts, web UI, and notification delivery deliberately
 * live outside this module. Private runtimes compose those concerns through
 * the callbacks accepted here; the scraper/processor itself stays reusable.
 */

import { collectAmazonJobs } from "./sources/amazon.js";
import { collectGoogleJobs } from "./sources/google.js";
import { collectGreenhouseJobs } from "./sources/greenhouse.js";
import { collectLeverJobs } from "./sources/lever.js";
import { collectMetaJobs } from "./sources/meta.js";
import { collectMicrosoftJobs } from "./sources/microsoft.js";
import { collectPcsxJobs } from "./sources/pcsx.js";
import { collectWorkdayJobs } from "./sources/workday.js";
import { collectAshbyJobs } from "./sources/ashby.js";
import { collectOracleJobs } from "./sources/oracle.js";
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
import { collectNetflixJobs } from "./sources/netflix.js";
import { collectAuroraJobs } from "./sources/aurora.js";
import { COMPANIES } from "./companies.js";
import {
  dedupeJobs,
  jobIsFresh,
  jobMatchesCountryFilter,
} from "./sources/shared.js";
import { filterJobForUser } from "./filter.js";
import {
  fetchJobDescription,
  jobDirId,
  saveJobData,
} from "./job-description.js";
import {
  checkJobDescription,
  extractExperienceTiers,
  pickTierYearsForUser,
} from "./jd-filter.js";
import { checkLegitimacy } from "./legitimacy.js";
import { isJobUrlLive } from "./liveness.js";

const DEFAULT_COLLECTOR_TIMEOUT_MS = 30_000;
const DEFAULT_COLLECTOR_CONCURRENCY = 10;
const MAX_COLLECTOR_CONCURRENCY = 50;

function noop() {}

/**
 * Build the canonical collector registry used by both public and private runtimes.
 *
 * `options.extraCollectors` is the extension point for collectors this module
 * deliberately does not import. Anything excluded from the open-core manifest
 * must be injected here by the runtime that owns it, so the public import graph
 * never reaches it and the exporter's closure check stays meaningful. Each entry
 * is `{ key, collect, lane, options }` where `collect` has the standard
 * `(browser, config, logger)` collector signature.
 */
export function buildCollectorRegistry(config = {}, logger = noop, options = {}) {
  const registry = [];

  const solo = (key, fn, lane, options = {}) => {
    registry.push({
      key,
      collect: (collectorConfig) => fn(null, collectorConfig, logger),
      lane,
      ...options,
    });
  };
  const parameterized = (key, fn, lane) => {
    registry.push({
      key,
      collect: (collectorConfig) => fn(null, collectorConfig, logger, key),
      lane,
    });
  };

  solo("microsoft", collectMicrosoftJobs, "fast");
  solo("amazon", collectAmazonJobs, "fast");

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
  solo("netflix", collectNetflixJobs, "normal");
  solo("aurora", collectAuroraJobs, "normal");

  solo("apple", collectAppleJobs, "slow");
  solo("uber", collectUberJobs, "slow", { usesPlaywright: true });
  solo("confluent", collectConfluentJobs, "slow", { usesPlaywright: true });
  solo("intuit", collectIntuitJobs, "slow");
  solo("bloomberg", collectBloombergJobs, "slow");

  const atsCollectors = {
    workday: collectWorkdayJobs,
    greenhouse: collectGreenhouseJobs,
    pcsx: collectPcsxJobs,
    lever: collectLeverJobs,
    ashby: collectAshbyJobs,
    smartrecruiters: collectSmartRecruitersJobs,
  };

  for (const company of COMPANIES) {
    // A disabled company keeps its registry entry (so its urlPattern still
    // resolves links we already delivered) but is not collected. Without this,
    // a board that has moved or shut down burns a request every cycle and logs
    // an error forever, which trains the operator to ignore collector errors.
    if (company.disabled) {
      logger(`[${company.key}] skipped: ${company.disabled}`);
      continue;
    }
    if (company.ats !== "solo" && atsCollectors[company.ats]) {
      parameterized(company.key, atsCollectors[company.ats], company.lane);
    }
  }

  const registeredKeys = new Set(registry.map((entry) => entry.key));
  for (const extra of options.extraCollectors || []) {
    if (!extra || typeof extra.key !== "string" || !extra.key) {
      throw new Error("extraCollectors entries require a non-empty string key");
    }
    if (typeof extra.collect !== "function") {
      throw new Error(`extraCollectors entry ${extra.key} requires a collect function`);
    }
    if (registeredKeys.has(extra.key)) {
      throw new Error(`extraCollectors entry duplicates a built-in collector: ${extra.key}`);
    }
    registeredKeys.add(extra.key);
    solo(extra.key, extra.collect, extra.lane || "slow", extra.options || {});
  }

  const fastTrack = new Set(config.fastTrackCompanies || []);
  for (const entry of registry) {
    if (fastTrack.has(entry.key) && entry.lane !== "fast") entry.lane = "fast";
  }

  return registry;
}

function linkedAbortController(parentSignal) {
  const controller = new AbortController();
  let unlink = noop;

  if (parentSignal) {
    const abort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) abort();
    else {
      parentSignal.addEventListener("abort", abort, { once: true });
      unlink = () => parentSignal.removeEventListener("abort", abort);
    }
  }

  return { controller, unlink };
}

/**
 * Run collectors concurrently with real cancellation and per-source errors.
 * Empty results remain distinguishable from failed collectors in the metrics.
 */
export async function collectBatch(config, entries, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const requestedConcurrency = Number(
    options.concurrency ?? config?.collectorConcurrency ?? DEFAULT_COLLECTOR_CONCURRENCY,
  );
  if (!Number.isInteger(requestedConcurrency) ||
      requestedConcurrency < 1 ||
      requestedConcurrency > MAX_COLLECTOR_CONCURRENCY) {
    throw new TypeError(`collector concurrency must be an integer between 1 and ${MAX_COLLECTOR_CONCURRENCY}`);
  }
  const logger = options.logger || noop;
  const errors = [];
  const results = Array(entries.length);
  let nextIndex = 0;

  const runEntry = async (entry) => {
    const { controller, unlink } = linkedAbortController(config?.signal);
    let timer;
    try {
      if (controller.signal.aborted) {
        throw controller.signal.reason || new Error("Collection aborted");
      }
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Collector timed out after ${timeoutMs}ms`);
          error.code = "COLLECTOR_TIMEOUT";
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      });
      const collected = await Promise.race([
        entry.collect({ ...config, signal: controller.signal }),
        timeout,
      ]);
      if (!Array.isArray(collected) || collected.some((job) => !job || typeof job !== "object")) {
        throw new Error("Collector returned an invalid job list");
      }
      return collected;
    } catch (error) {
      errors.push({ key: entry.key, error });
      logger(`[${entry.key}] Collection error: ${error.message}`);
      return [];
    } finally {
      clearTimeout(timer);
      unlink();
    }
  };

  const workerCount = Math.min(requestedConcurrency, entries.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;
      results[index] = await runEntry(entries[index]);
    }
  }));

  return {
    jobs: dedupeJobs(results.flat()),
    totalCount: entries.length,
    errorCount: errors.length,
    errors,
  };
}

/** True only when work was attempted and every collector failed. */
export function allCollectorsFailed(collection) {
  const totalCount = Number(collection?.totalCount) || 0;
  const errorCount = Number(collection?.errorCount) || 0;
  return totalCount > 0 && errorCount === totalCount;
}

/**
 * Fetch, inspect, and score descriptions without knowing anything about the
 * caller's database or notification system.
 */
export async function inspectJobs(jobs, options = {}) {
  const {
    profile = null,
    concurrency = 5,
    signal,
    logger = noop,
    persistDescriptions = false,
    isLive = isJobUrlLive,
    fetchDescription = fetchJobDescription,
    persistDescription = saveJobData,
    getRepostCount = () => 0,
    recordLegitimacy = noop,
  } = options;

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new Error("inspectJobs concurrency must be an integer between 1 and 50");
  }

  const results = [];
  for (let index = 0; index < jobs.length; index += concurrency) {
    if (signal?.aborted) throw signal.reason || new Error("Pipeline aborted");
    const batch = jobs.slice(index, index + concurrency);
    const inspected = await Promise.all(batch.map(async (job) => {
      const live = await isLive(job.url, { signal });
      if (!live) {
        logger(`[liveness] Dead link: ${job.sourceLabel} — ${job.title} (${job.url})`);
        return null;
      }

      const dirId = jobDirId(job);
      let description = null;
      try {
        description = await fetchDescription(job, undefined, { signal });
        if (persistDescriptions) await persistDescription(job, description || "");
      } catch (error) {
        if (signal?.aborted) throw error;
        logger(`Failed to fetch description for ${dirId}: ${error.message}`);
      }

      const rawWarnings = checkJobDescription(description);
      const warnings = profile?.education_level
        ? rawWarnings.filter((warning) => !/^\d+\+ years required/.test(warning.text))
        : rawWarnings;

      if (description && profile?.education_level) {
        const tierInfo = extractExperienceTiers(description);
        const yearsForUser = pickTierYearsForUser(
          tierInfo.tiers,
          tierInfo.fallbackMax,
          profile.education_level,
        );
        if (yearsForUser >= 5) {
          warnings.push({ text: `${yearsForUser}+ years required`, severity: "soft" });
        }
      }

      let legitimacy;
      try {
        legitimacy = checkLegitimacy(job, description, { getRepostCountFn: getRepostCount });
        await recordLegitimacy(job, legitimacy);
      } catch (error) {
        logger(`[legitimacy] Error for ${job.key}: ${error.message}`);
        legitimacy = { tier: "high_confidence", topSignal: null, signals: [] };
      }

      return { job, description, warnings, legitimacy };
    }));
    results.push(...inspected.filter(Boolean));
  }

  return results;
}

/** A one-shot, delivery-agnostic pipeline suitable for CLI or library users. */
export async function runPipelineOnce(config, options = {}) {
  const logger = options.logger || noop;
  const registry = options.registry || buildCollectorRegistry(config, logger);
  const lanes = options.lanes?.length ? new Set(options.lanes) : null;
  const sourceKeys = options.sourceKeys?.length ? new Set(options.sourceKeys) : null;
  const entries = registry.filter((entry) =>
    (!lanes || lanes.has(entry.lane)) && (!sourceKeys || sourceKeys.has(entry.key))
  );
  if ((lanes || sourceKeys) && entries.length === 0) {
    throw new Error("No collectors matched the requested source/lane filters");
  }

  const collection = await collectBatch(config, entries, {
    timeoutMs: options.collectorTimeoutMs,
    logger,
  });
  const now = options.now || new Date().toISOString();
  let jobs = collection.jobs
    .filter((job) => jobMatchesCountryFilter(job, config.countryFilter))
    .filter((job) => options.includeStale || jobIsFresh(job, now, config));

  if (options.profile) {
    jobs = jobs.filter((job) => filterJobForUser(job, options.profile).pass);
  }
  if (Number.isInteger(options.limit) && options.limit >= 0) jobs = jobs.slice(0, options.limit);

  const inspected = options.inspectDescriptions
    ? await inspectJobs(jobs, {
        ...options.inspection,
        profile: options.profile,
        signal: config.signal,
        logger,
      })
    : jobs.map((job) => ({ job, description: null, warnings: [], legitimacy: null }));

  return { ...collection, jobs, inspected };
}
