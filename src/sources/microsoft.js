import {
  dedupeJobs,
  finalizeJob,
  isTargetRole
} from "./shared.js";

const MICROSOFT_BASE_URL = "https://apply.careers.microsoft.com";

// Direct API endpoint — sorted by most recent
const MICROSOFT_API_URL =
  "https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query=&location=&start=0&sort_by=Most+recent&filter_profession=software+engineering&pg_size=20";

function parseMicrosoftJob(raw, config) {
  const title = raw.name?.trim();
  if (!title || !isTargetRole(title)) {
    return null;
  }

  const id = String(raw.id ?? raw.displayJobId ?? "");
  const positionUrl = raw.positionUrl
    ? `${MICROSOFT_BASE_URL}${raw.positionUrl}`
    : `${MICROSOFT_BASE_URL}/careers/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";

  if (raw.postedTs && Number.isFinite(raw.postedTs)) {
    const ms = raw.postedTs > 1_000_000_000_000 ? raw.postedTs : raw.postedTs * 1000;
    postedAt = new Date(ms).toISOString();
    postedPrecision = "exact";
  }

  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const location = locations.join(" | ");

  // Infer country from standardizedLocations (e.g., "Redmond, WA, US")
  const stdLocs = Array.isArray(raw.standardizedLocations) ? raw.standardizedLocations : [];
  let countryCode = "";
  for (const loc of stdLocs) {
    if (/\bUS\b/.test(loc)) {
      countryCode = "US";
      break;
    }
  }

  return finalizeJob({
    sourceKey: config.microsoft.sourceKey,
    sourceLabel: config.microsoft.sourceLabel,
    id,
    title,
    location,
    postedText: postedAt ? new Date(postedAt).toLocaleString() : "",
    postedAt,
    postedPrecision,
    url: positionUrl,
    countryCode
  });
}

export async function collectMicrosoftJobs(_browserUnused, config, log) {
  const apiUrl = config.microsoft.apiUrl || MICROSOFT_API_URL;

  try {
    const response = await fetch(apiUrl, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
      log(`Microsoft API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.data?.positions ?? [];

    const jobs = rawJobs
      .map((raw) => parseMicrosoftJob(raw, config))
      .filter(Boolean);

    log(`Microsoft API returned ${rawJobs.length} results, ${jobs.length} matched keywords.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Microsoft API error: ${error.message}`);
    return [];
  }
}
