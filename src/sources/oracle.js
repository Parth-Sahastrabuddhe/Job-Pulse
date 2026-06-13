import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseOracleJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const cc = raw.PrimaryLocationCountry;
  const countryCode = cc === "US" ? "US" : cc === "CA" ? "CA" : "";

  const url = `https://careers.oracle.com/jobs/#en/sites/jobsearch/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.PostedDate) {
    // PostedDate is like "2026-03-20"
    postedAt = new Date(raw.PostedDate).toISOString();
    postedPrecision = "day";
  }

  return finalizeJob({
    sourceKey: "oracle",
    sourceLabel: "Oracle",
    id,
    title,
    location,
    postedText: raw.PostedDate || "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

// Oracle's careers API locks results to a location facet id. The US id is known.
// To enable Canada, discover this tenant's Canada LOCATIONS facet id on EC2 (see
// docs plan Task 13) and set CA_LOCATION_ID below. Empty = US-only (unchanged).
const ORACLE_US_LOCATION_ID = "300000000149325";
const ORACLE_CA_LOCATION_ID = "";

function buildOracleUrl(locationId) {
  return "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions" +
    "?onlyData=true" +
    "&expand=requisitionList.secondaryLocations" +
    "&finder=findReqs;siteNumber=CX_45001" +
    ",facetsList=LOCATIONS" +
    ",limit=25" +
    ",keyword=software+engineer" +
    `,locationId=${locationId}` +
    `,selectedLocationsFacet=${locationId}` +
    ",sortBy=POSTING_DATES_DESC";
}

export async function collectOracleJobs(_unused, config, log) {
  const locationIds = ORACLE_CA_LOCATION_ID
    ? [ORACLE_US_LOCATION_ID, ORACLE_CA_LOCATION_ID]
    : [ORACLE_US_LOCATION_ID];

  try {
    const responses = await Promise.all(locationIds.map((locId) =>
      fetchWithTimeout(buildOracleUrl(locId), {
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ));

    const rawJobs = responses.flatMap((data) => data?.items?.[0]?.requisitionList || []);
    const jobs = rawJobs
      .map((raw) => parseOracleJob(raw))
      .filter(Boolean);

    log(`Oracle API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Oracle API error: ${error.message}`);
    return [];
  }
}
