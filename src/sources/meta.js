import {
  asCollectorError,
  dedupeJobs,
  fetchWithTimeout,
  finalizeJob,
  inferCountryCodeFromLocation,
  isTargetRole,
  parseRowsSafely,
} from "./shared.js";

const META_CAREERS_URL = "https://www.metacareers.com";
const META_GRAPHQL_URL = "https://www.metacareers.com/graphql";
const META_SEARCH_DOC_ID = "29615178951461218";

// Meta's GraphQL endpoint enforces an IP-scoped quota (HTTP 200 with
// errors[].code 1675004 "Rate limit exceeded"). Measured 2026-07-10..12: the
// batch loop's one-call-per-2.5-min pressure (~576/day) got ~140 successes/day,
// degrading to ~55/day; the identical request from a fresh IP succeeds, and
// metacareers.com sets no cookies, so the budget is per-IP and the only lever
// is call rate. The collector therefore throttles itself: at most one attempt
// per BASE_POLL_MS, doubling the wait after every failed attempt (up to
// MAX_BACKOFF_MS) and resetting on success. Throttled cycles return []
// without touching the network. Retrying within a cycle only burns quota
// faster — never do that here.
const BASE_POLL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 4 * 60 * 60 * 1000;

let nextAttemptAt = 0;
let backoffMs = 0; // 0 = healthy cadence, otherwise the last applied wait

export function _resetMetaThrottleForTests() {
  nextAttemptAt = 0;
  backoffMs = 0;
}

function noteFailure() {
  backoffMs = backoffMs === 0 ? BASE_POLL_MS : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
  nextAttemptAt = Date.now() + backoffMs;
  return Math.round(backoffMs / 60000);
}

function noteSuccess() {
  backoffMs = 0;
  nextAttemptAt = Date.now() + BASE_POLL_MS;
}

// Attempts are >= 15 min apart, so a cached token would expire before its
// next use anyway — fetch a fresh one per attempt.
async function getLsdToken(signal) {
  const response = await fetchWithTimeout(META_CAREERS_URL, {
    headers: { "user-agent": "Mozilla/5.0" },
    signal,
  });
  if (!response.ok) throw new Error(`LSD token request returned HTTP ${response.status}`);
  const html = await response.text();

  const match = html.match(/"LSD",\[\],\{"token":"([^"]+)"\}/);
  if (!match) {
    throw new Error("Could not extract LSD token from Meta careers page");
  }
  return match[1];
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

  // Country detection is delegated to shared.js rather than reimplemented here.
  // The previous local US_STATES regex was an un-anchored two-letter match, so
  // the state codes DE, IN and IL collided with Germany, India and Israel and
  // stamped countryCode "US" on Meta's Berlin, Bengaluru/Hyderabad/Gurgaon and
  // Tel Aviv postings — which then sailed through the US-only country gate into
  // users' DMs. shared.js carries the disambiguation (FOREIGN_CITY_COUNTRY_PAIRS)
  // that closes exactly this class, and keeping one implementation means a future
  // country (India is planned) only has to be taught in one place.
  const countryCodes = locations.map((l) => inferCountryCodeFromLocation(l));
  const hasUsLocation = countryCodes.includes("US");
  const hasCaLocation = countryCodes.includes("CA");

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
  if (Date.now() < nextAttemptAt) return [];

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

    const lsdToken = await getLsdToken(config.signal);

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
      body: body.toString(),
      signal: config.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        const waitMin = noteFailure();
        log(`Meta API returned status ${response.status}; next attempt in ${waitMin} min`);
        return [];
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawJobs = data?.data?.job_search_with_featured_jobs?.all_jobs;
    if (!Array.isArray(rawJobs)) {
      const waitMin = noteFailure();
      const providerError = data?.errors?.[0];
      const why = providerError?.message || "missing all_jobs payload";
      if (providerError?.code === 1675004 || /rate limit|throttl/i.test(why)) {
        log(`Meta API throttled (${why}); next attempt in ${waitMin} min`);
        return [];
      }
      throw new Error(`unparseable Meta response: ${why}`);
    }

    noteSuccess();
    const jobs = parseRowsSafely(rawJobs, (raw) => parseMetaJob(raw, config));

    log(`Meta API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    const waitMin = noteFailure();
    log(`Meta API error: ${error.message}; next attempt in ${waitMin} min`);
    throw asCollectorError("meta", error);
  }
}
