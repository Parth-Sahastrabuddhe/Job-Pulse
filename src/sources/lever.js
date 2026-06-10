import { dedupeJobs, finalizeJob, inferCountryCodeFromLocation, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseLeverJob(raw, companyConfig) {
  const title = raw.text?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || "");
  const location = raw.categories?.location || "";
  const countryCode = inferCountryCodeFromLocation(location);

  // Only include jobs with confirmed US location
  if (countryCode !== "US") {
    return null;
  }

  let postedAt = "";
  let postedPrecision = "";

  if (raw.createdAt) {
    postedAt = new Date(raw.createdAt).toISOString();
    postedPrecision = "exact";
  }

  const url = raw.hostedUrl || raw.applyUrl || "";

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

// Cache the parsed result per board. Lever boards return an ETag, so a
// conditional GET returns 304 when nothing changed and we skip re-downloading
// and re-parsing the multi-MB payload (Palantir's board is ~4 MB). Bounded by
// the fixed number of Lever companies.
const leverBoardCache = new Map(); // companyKey -> { etag, jobs }

export async function collectLeverJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  const cached = leverBoardCache.get(companyKey);
  try {
    const headers = { accept: "application/json" };
    if (cached?.etag) headers["if-none-match"] = cached.etag;

    const response = await fetchWithTimeout(companyConfig.apiUrl, { headers });

    if (response.status === 304 && cached) {
      return [...cached.jobs];
    }

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const rawJobs = await response.json();

    const jobs = rawJobs
      .map((raw) => parseLeverJob(raw, companyConfig))
      .filter(Boolean);

    // Board API orders by relevance, not date. Sort by postedAt DESC so the
    // maxJobsPerSource cap keeps the freshest postings rather than truncating them.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    const result = dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
    leverBoardCache.set(companyKey, { etag: response.headers.get("etag"), jobs: result });

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return result;
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
