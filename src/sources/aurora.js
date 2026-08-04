import {
  asCollectorError,
  dedupeJobs,
  fetchWithTimeout,
  finalizeJob,
  inferCountryCodeFromLocation,
  isTargetRole,
  parseRowsSafely,
  safeText,
  toIsoOrEmpty,
} from "./shared.js";

// Aurora's Greenhouse board ("aurorainnovation") 404s and no Greenhouse, Ashby
// or Lever slug resolves (probed 2026-08-04). They run Ashby behind a private
// board on their own domain — `applyLink` is aurora.tech/careers?ashby_jid=...
// — and expose a first-party JSON index that the careers page itself fetches.
// That index is the supported public surface here, and it needs no browser.
const AURORA_API = "https://aurora.tech/api/jobs-index";

function parseAuroraJob(raw) {
  const title = safeText(raw.title);
  if (!title || !isTargetRole(title)) return null;

  // `id` is the ashby_jid used by applyLink and is stable per posting.
  const id = safeText(raw.id || raw.jobId);
  if (!id) return null;

  const locations = Array.isArray(raw.locations)
    ? raw.locations.map(safeText).filter(Boolean)
    : [safeText(raw.locations)].filter(Boolean);
  const location = locations.join(" | ");

  const countryCodes = locations.map((l) => inferCountryCodeFromLocation(l));
  const countryCode = countryCodes.includes("US")
    ? "US"
    : countryCodes.includes("CA") ? "CA" : "";
  if (countryCode !== "US" && countryCode !== "CA") return null;

  // publishedDate is date-only ("2026-08-04"); updatedAt is a full ISO stamp.
  // Prefer the precise one and record the precision so the freshness gate can
  // treat a date-only value with the right tolerance.
  const updatedAt = toIsoOrEmpty(raw.updatedAt);
  const publishedAt = toIsoOrEmpty(raw.publishedDate);
  const postedAt = updatedAt || publishedAt;
  const postedPrecision = updatedAt ? "exact" : publishedAt ? "date" : "";

  const applyLink = safeText(raw.applyLink);
  const url = applyLink.startsWith("https://")
    ? applyLink
    : `https://aurora.tech/careers?ashby_jid=${encodeURIComponent(id)}`;

  return finalizeJob({
    sourceKey: "aurora",
    sourceLabel: "Aurora",
    id,
    title,
    location,
    postedAt,
    postedPrecision,
    url,
    countryCode,
  });
}

export async function collectAuroraJobs(_unused, config, log) {
  try {
    const response = await fetchWithTimeout(AURORA_API, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: config.signal,
    });

    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      log(`Aurora API returned status ${response.status}`);
      throw err;
    }

    const data = await response.json();
    if (!Array.isArray(data?.jobs)) throw new Error("response did not contain a jobs array");
    const rawJobs = data.jobs;

    const jobs = parseRowsSafely(rawJobs, parseAuroraJob);
    log(`Aurora API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Aurora API error: ${error.message}`);
    throw asCollectorError("aurora", error);
  }
}
