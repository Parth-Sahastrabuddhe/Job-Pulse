import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

const META_CAREERS_URL = "https://www.metacareers.com";
const META_GRAPHQL_URL = "https://www.metacareers.com/graphql";
const META_SEARCH_DOC_ID = "29615178951461218";

// Cache LSD token — reuse for up to 15 minutes
let cachedLsdToken = null;
let cachedLsdTokenAt = 0;
const LSD_TOKEN_TTL_MS = 15 * 60 * 1000;

async function getLsdToken() {
  if (cachedLsdToken && Date.now() - cachedLsdTokenAt < LSD_TOKEN_TTL_MS) {
    return cachedLsdToken;
  }

  const response = await fetchWithTimeout(META_CAREERS_URL, {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  const html = await response.text();

  const match = html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
  if (!match) {
    throw new Error("Could not extract LSD token from Meta careers page");
  }

  cachedLsdToken = match[1];
  cachedLsdTokenAt = Date.now();
  return cachedLsdToken;
}

function parseMetaJob(raw, config) {
  if (!raw || !raw.title) return null;

  const title = raw.title.trim();
  if (!isTargetRole(title)) {
    return null;
  }

  const id = String(raw.id || "");
  const locations = Array.isArray(raw.locations) ? [...raw.locations].sort() : [];
  const location = locations.join(" | ");

  // City, STATE (US) vs City, PROVINCE (CA) detection.
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  const CA_PROVINCES = /\b(ON|BC|QC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU)\b/;
  const hasUsLocation = locations.some((l) =>
    /\bUnited States\b/i.test(l) || /\bRemote, US\b/i.test(l) || US_STATES.test(l)
  );
  const hasCaLocation = locations.some((l) =>
    /\bCanada\b/i.test(l) || CA_PROVINCES.test(l)
  );

  // Drop jobs with neither a US nor a CA location.
  if (!hasUsLocation && !hasCaLocation) {
    return null;
  }

  const url = `${META_CAREERS_URL}/jobs/${id}`;

  return finalizeJob({
    sourceKey: config.meta.sourceKey,
    sourceLabel: config.meta.sourceLabel,
    id,
    title,
    location,
    postedText: "",
    postedAt: "",
    postedPrecision: "",
    url,
    countryCode: hasUsLocation ? "US" : "CA"
  });
}

export async function collectMetaJobs(_unused, config, log) {
  try {
    const variables = JSON.stringify({
      search_input: {
        q: "software engineer",
        divisions: [],
        offices: [],
        roles: [],
        leadership_levels: [],
        saved_jobs: [],
        saved_searches: [],
        sub_teams: [],
        teams: [],
        is_leadership: false,
        is_remote_only: false,
        sort_by_new: true,
        results_per_page: null
      }
    });

    // Meta rate-limits REUSED LSD tokens (HTTP 200 + errors[].code 1675004,
    // "Rate limit exceeded") while a fresh token succeeds immediately, so a
    // soft-failure clears the cache and retries once with a fresh token
    // instead of returning empty until the 15-min TTL expires.
    let rawJobs = null;
    for (let attempt = 1; attempt <= 2 && rawJobs === null; attempt++) {
      const lsdToken = await getLsdToken();

      const body = new URLSearchParams({
        lsd: lsdToken,
        fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery",
        doc_id: META_SEARCH_DOC_ID,
        variables
      });

      const response = await fetchWithTimeout(META_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-fb-lsd": lsdToken,
          "user-agent": "Mozilla/5.0"
        },
        body: body.toString()
      });

      if (!response.ok) {
        // Token might be stale — clear cache and retry next cycle
        cachedLsdToken = null;
        log(`Meta API returned status ${response.status}`);
        return [];
      }

      const data = await response.json();
      const jobs = data?.data?.job_search_with_featured_jobs?.all_jobs;
      if (Array.isArray(jobs)) {
        rawJobs = jobs;
        break;
      }

      cachedLsdToken = null;
      const why = data?.errors?.[0]?.message || "missing all_jobs payload";
      log(`Meta API soft-failure (${why}), ${attempt < 2 ? "retrying with a fresh token" : "giving up this cycle"}`);
    }

    if (rawJobs === null) return [];

    const jobs = rawJobs
      .map((raw) => parseMetaJob(raw, config))
      .filter(Boolean);

    log(`Meta API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    cachedLsdToken = null; // Clear stale token on error
    log(`Meta API error: ${error.message}`);
    return [];
  }
}
