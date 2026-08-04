import {
  asCollectorError,
  dedupeJobs,
  delay,
  fetchWithTimeout,
  finalizeJob,
  inferCountryCodeFromLocation,
  isTargetRole,
  parseRowsSafely,
  safeText,
  toIsoOrEmpty,
} from "./shared.js";

// Netflix left Workday. Their careers site is Eightfold AI on a custom domain
// (explore.jobs.netflix.net), and the old netflix.wd1.myworkdayjobs.com CXS
// endpoint now answers HTTP 422 for every site name (probed 2026-08-04).
//
// The Eightfold apply API is a plain GET returning JSON, so this collector
// needs no browser. `count` is the total for the query and `start`/`num` page
// through it; the API caps `num`, so we page rather than asking for everything
// at once.
const NETFLIX_API = "https://explore.jobs.netflix.net/api/apply/v2/jobs";
const NETFLIX_JOB_BASE = "https://explore.jobs.netflix.net/careers/job";
// The API hard-caps a page at 10 regardless of `num` (verified 2026-08-04:
// num=10/20/50/100 all return exactly 10). Asking for more and then treating a
// short page as "end of results" would stop after the first page and silently
// collect a tenth of the board, so page size is pinned to the real cap and the
// loop terminates on `count` instead.
//
// 6 pages x 2 queries = 12 requests, roughly 9s. The per-source cap is 60 and
// this already yields ~93 matches, so more pages buy nothing and only eat into
// the 30s collector timeout.
const PAGE_SIZE = 10;
const MAX_PAGES = 6;
const PAGE_DELAY_MS = 250;
// Eightfold ranks by relevance against a free-text query, so query the same
// role vocabulary the rest of the pipeline targets rather than pulling the
// whole board (481 postings at last probe, most of them non-engineering).
const QUERIES = ["software engineer", "software developer"];

function buildUrl(query, start) {
  const params = new URLSearchParams({
    domain: "netflix.com",
    start: String(start),
    num: String(PAGE_SIZE),
    query,
    sort_by: "relevance",
  });
  return `${NETFLIX_API}?${params.toString()}`;
}

function parseNetflixJob(raw) {
  const title = safeText(raw.name || raw.posting_name);
  if (!title || !isTargetRole(title)) return null;

  const id = safeText(raw.id || raw.display_job_id || raw.ats_job_id);
  if (!id) return null;

  // `locations` is the authoritative list; `location` is a display string.
  const locations = Array.isArray(raw.locations) && raw.locations.length
    ? raw.locations.map(safeText).filter(Boolean)
    : [safeText(raw.location)].filter(Boolean);
  const location = locations.join(" | ");

  // Netflix writes "USA - Remote", "Los Gatos, California, United States of
  // America", "Amsterdam, Netherlands". Delegate to the shared inference so the
  // US/CA disambiguation (and any future country) lives in exactly one place.
  const countryCodes = locations.map((l) => inferCountryCodeFromLocation(l));
  const countryCode = countryCodes.includes("US")
    ? "US"
    : countryCodes.includes("CA") ? "CA" : "";
  if (countryCode !== "US" && countryCode !== "CA") return null;

  // t_update is unix SECONDS; toIsoOrEmpty expects milliseconds.
  const updatedSeconds = Number(raw.t_update);
  const postedAt = Number.isFinite(updatedSeconds) && updatedSeconds > 0
    ? toIsoOrEmpty(updatedSeconds * 1000)
    : "";

  const canonical = safeText(raw.canonicalPositionUrl);
  const url = canonical.startsWith("https://") ? canonical : `${NETFLIX_JOB_BASE}/${id}`;

  return finalizeJob({
    sourceKey: "netflix",
    sourceLabel: "Netflix",
    id,
    title,
    location,
    postedAt,
    postedPrecision: postedAt ? "date" : "",
    url,
    countryCode,
  });
}

export async function collectNetflixJobs(_unused, config, log) {
  try {
    const collected = [];
    let totalSeen = 0;

    for (const query of QUERIES) {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await fetchWithTimeout(buildUrl(query, page * PAGE_SIZE), {
          headers: {
            accept: "application/json",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: config.signal,
        });

        if (!response.ok) {
          const err = new Error(`HTTP ${response.status}`);
          // Preserve the status so the scheduler's rate-limit backoff can see a
          // 429 without parsing the message.
          err.status = response.status;
          log(`Netflix API returned status ${response.status}`);
          throw err;
        }

        const data = await response.json();
        const positions = data?.positions;
        if (!Array.isArray(positions)) {
          throw new Error("response did not contain a positions array");
        }

        totalSeen += positions.length;
        collected.push(...parseRowsSafely(positions, parseNetflixJob));

        // An empty page is the only reliable end-of-results signal, since a
        // full page always equals the server-side cap. `count` bounds it too.
        if (positions.length === 0) break;
        const count = Number(data?.count);
        if (Number.isFinite(count) && (page + 1) * PAGE_SIZE >= count) break;
        if (page + 1 < MAX_PAGES) await delay(PAGE_DELAY_MS);
      }
    }

    const jobs = dedupeJobs(collected);
    log(`Netflix API returned ${totalSeen} results, ${jobs.length} matched filters.`);
    return jobs.slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Netflix API error: ${error.message}`);
    throw asCollectorError("netflix", error);
  }
}
