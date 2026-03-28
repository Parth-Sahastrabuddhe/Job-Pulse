import {
  dedupeJobs,
  finalizeJob,
  isTargetRole,
  normalizeUrl
} from "./shared.js";

const AMAZON_BASE_URL = "https://www.amazon.jobs";

// Direct API endpoint — append .json to the search URL
const AMAZON_API_URL =
  "https://www.amazon.jobs/en/search.json?category%5B%5D=Software+Development&normalized_country_code%5B%5D=USA&sort=recent&result_limit=20&offset=0";

function normalizeAmazonUrl(rawPath, fallbackId) {
  if (rawPath) {
    const normalized = normalizeUrl(AMAZON_BASE_URL, rawPath);
    if (normalized && /amazon\.jobs\/(?:[a-z]{2}\/)?jobs\/\d+/i.test(normalized)) {
      return normalized;
    }
  }

  if (fallbackId) {
    return `${AMAZON_BASE_URL}/en/jobs/${fallbackId}`;
  }

  return null;
}

function parseAmazonJob(raw, config) {
  const title = raw.title?.trim();
  if (!title || !isTargetRole(title)) {
    return null;
  }

  const id = String(raw.id_icims ?? raw.id ?? "");
  const url = normalizeAmazonUrl(raw.job_path, id);
  if (!url) {
    return null;
  }

  const postedText = raw.posted_date ?? "";
  const updatedTime = raw.updated_time ?? "";

  // updated_time is an ISO string if present; posted_date is human-readable
  let postedAt = "";
  let postedPrecision = "";

  if (updatedTime && !Number.isNaN(Date.parse(updatedTime))) {
    postedAt = new Date(updatedTime).toISOString();
    postedPrecision = "exact";
  } else if (postedText && !Number.isNaN(Date.parse(postedText))) {
    postedAt = new Date(postedText).toISOString();
    postedPrecision = /^\d{4}-\d{2}-\d{2}T/.test(postedText) ? "exact" : "date";
  }

  const location = raw.normalized_location ?? raw.location ?? "";
  const countryCode = raw.country_code?.toUpperCase() ?? "";

  return finalizeJob({
    sourceKey: config.amazon.sourceKey,
    sourceLabel: config.amazon.sourceLabel,
    id,
    title,
    location,
    postedText,
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectAmazonJobs(_browserUnused, config, log) {
  const apiUrl = config.amazon.apiUrl || AMAZON_API_URL;

  try {
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
      log(`Amazon API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.jobs ?? [];

    const jobs = rawJobs
      .map((raw) => parseAmazonJob(raw, config))
      .filter(Boolean);

    log(`Amazon API returned ${rawJobs.length} results, ${jobs.length} matched keywords.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Amazon API error: ${error.message}`);
    return [];
  }
}
