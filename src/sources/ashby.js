import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseAshbyJob(raw, companyConfig) {
  const title = raw.title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || "");
  const location = raw.location || "";
  const countryCode = "";

  let postedAt = "";
  let postedPrecision = "";

  if (raw.publishedAt) {
    postedAt = new Date(raw.publishedAt).toISOString();
    postedPrecision = "exact";
  } else if (raw.updatedAt) {
    postedAt = new Date(raw.updatedAt).toISOString();
    postedPrecision = "exact";
  }

  const url = raw.jobUrl || `https://jobs.ashbyhq.com/${companyConfig.boardSlug}/${id}`;

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

// Cache the parsed result per board. Ashby boards honor Last-Modified, so a
// conditional GET returns 304 when nothing changed and we skip re-downloading
// and re-parsing the multi-MB payload (OpenAI's board is ~11 MB). Bounded by the
// fixed number of Ashby companies.
const ashbyBoardCache = new Map(); // companyKey -> { lastModified, jobs }

export async function collectAshbyJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  const cached = ashbyBoardCache.get(companyKey);
  try {
    const headers = { accept: "application/json" };
    if (cached?.lastModified) headers["if-modified-since"] = cached.lastModified;

    const response = await fetchWithTimeout(companyConfig.apiUrl, { headers });

    if (response.status === 304 && cached) {
      return [...cached.jobs];
    }

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.jobs ?? [];

    const jobs = rawJobs.map((raw) => parseAshbyJob(raw, companyConfig)).filter(Boolean);

    // Board API orders by relevance, not date. Sort by postedAt DESC so the
    // maxJobsPerSource cap keeps the freshest postings rather than truncating them.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    const result = dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
    ashbyBoardCache.set(companyKey, { lastModified: response.headers.get("last-modified"), jobs: result });

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return result;
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
