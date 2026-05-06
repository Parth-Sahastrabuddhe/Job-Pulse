import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parsePcsxJob(raw, companyConfig) {
  const title = raw.name?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id ?? raw.displayJobId ?? "");

  const baseUrl = companyConfig.baseUrl || "";
  const positionUrl = raw.positionUrl
    ? `${baseUrl}${raw.positionUrl}`
    : raw.publicUrl || `${baseUrl}/careers/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";

  if (raw.postedTs && Number.isFinite(raw.postedTs)) {
    const ms = raw.postedTs > 1_000_000_000_000 ? raw.postedTs : raw.postedTs * 1000;
    postedAt = new Date(ms).toISOString();
    // Eightfold/PCSX postedTs is the start-of-day UTC timestamp, not an
    // exact post time. Mark as "date" so the freshness gate uses the
    // day-granular path (maxDateOnlyAgeDays) instead of the minute one.
    postedPrecision = "date";
  }

  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const location = locations.join(" | ");

  const stdLocs = Array.isArray(raw.standardizedLocations) ? raw.standardizedLocations : [];
  let countryCode = "";
  for (const loc of stdLocs) {
    if (/\bUS\b/.test(loc)) {
      countryCode = "US";
      break;
    }
  }

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
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

const PCSX_PAGE_SIZE = 10; // server hard-caps page size at 10 regardless of pg_size value
const PCSX_PAGE_CONCURRENCY = 5;
const PCSX_MAX_PAGES = 100;

function setStartParam(apiUrl, start) {
  return apiUrl.replace(/([?&])start=\d+/, `$1start=${start}`);
}

async function fetchPcsxPage(apiUrl, start) {
  const response = await fetch(setStartParam(apiUrl, start), {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) {
    const err = new Error(`status ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

export async function collectPcsxJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  try {
    const firstPage = await fetchPcsxPage(companyConfig.apiUrl, 0);
    const firstPositions = firstPage.data?.positions ?? [];
    const total = firstPage.data?.count ?? firstPositions.length;

    let rawJobs = [...firstPositions];

    if (companyConfig.paginate && total > PCSX_PAGE_SIZE) {
      const lastPageStart = Math.min(total, PCSX_MAX_PAGES * PCSX_PAGE_SIZE) - PCSX_PAGE_SIZE;
      const offsets = [];
      for (let s = PCSX_PAGE_SIZE; s <= lastPageStart; s += PCSX_PAGE_SIZE) offsets.push(s);

      for (let i = 0; i < offsets.length; i += PCSX_PAGE_CONCURRENCY) {
        const batch = offsets.slice(i, i + PCSX_PAGE_CONCURRENCY);
        const pages = await Promise.all(
          batch.map((s) => fetchPcsxPage(companyConfig.apiUrl, s).catch(() => ({ data: { positions: [] } })))
        );
        for (const p of pages) rawJobs.push(...(p.data?.positions ?? []));
      }
    }

    const jobs = rawJobs
      .map((raw) => parsePcsxJob(raw, companyConfig))
      .filter(Boolean);

    // Server-side ordering is relevance, not date. Sort by postedAt DESC so the
    // maxJobsPerSource cap preserves the freshest postings.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results (of ${total}), ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
