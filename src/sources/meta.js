import { dedupeJobs, finalizeJob } from "./shared.js";

const META_CAREERS_URL = "https://www.metacareers.com";
const META_GRAPHQL_URL = "https://www.metacareers.com/graphql";
const META_SEARCH_DOC_ID = "29615178951461218";

// Cache LSD token — reuse for up to 15 minutes
let cachedLsdToken = null;
let cachedLsdTokenAt = 0;
const LSD_TOKEN_TTL_MS = 15 * 60 * 1000;

function isEntryMidLevelSwe(title) {
  const t = title.trim();
  if (!/software\s+engineer/i.test(t)) {
    return false;
  }
  if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished)\b/i.test(t)) {
    return false;
  }
  return true;
}

async function getLsdToken() {
  if (cachedLsdToken && Date.now() - cachedLsdTokenAt < LSD_TOKEN_TTL_MS) {
    return cachedLsdToken;
  }

  const response = await fetch(META_CAREERS_URL, {
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
  if (!isEntryMidLevelSwe(title)) {
    return null;
  }

  const id = String(raw.id || "");
  const locations = Array.isArray(raw.locations) ? [...raw.locations].sort() : [];
  const location = locations.join(" | ");

  // Check if any location is in the US — match "City, STATE" pattern (2-letter US state code)
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  const hasUsLocation = locations.some((l) =>
    /\bUnited States\b/i.test(l) ||
    /\bRemote, US\b/i.test(l) ||
    US_STATES.test(l)
  );

  // Only include jobs with at least one confirmed US location
  if (!hasUsLocation) {
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
    countryCode: "US"
  });
}

export async function collectMetaJobs(_unused, config, log) {
  try {
    const lsdToken = await getLsdToken();

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

    const body = new URLSearchParams({
      lsd: lsdToken,
      fb_api_req_friendly_name: "CareersJobSearchResultsDataQuery",
      doc_id: META_SEARCH_DOC_ID,
      variables
    });

    const response = await fetch(META_GRAPHQL_URL, {
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
    const rawJobs = data?.data?.job_search_with_featured_jobs?.all_jobs ?? [];

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
