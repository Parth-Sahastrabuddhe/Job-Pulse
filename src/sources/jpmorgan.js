import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseJPMorganJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const cc = raw.PrimaryLocationCountry;
  const countryCode = cc === "US" ? "US" : cc === "CA" ? "CA" : "";

  const url = `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.PostedDate) {
    postedAt = new Date(raw.PostedDate).toISOString();
    postedPrecision = "day";
  }

  return finalizeJob({
    sourceKey: "jpmorgan",
    sourceLabel: "JPMorgan Chase",
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

// JPMorgan's careers API locks results to a location facet id. The US id is known
// (300000000289738). To enable Canada, discover this tenant's Canada LOCATIONS
// facet id on EC2 (see docs plan Task 13) and set CA_LOCATION_ID. Empty = US-only.
const JPMC_US_LOCATION_ID = "300000000289738";
const JPMC_CA_LOCATION_ID = "";

function buildJPMorganUrl(locationId) {
  return "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions" +
    "?onlyData=true" +
    "&expand=requisitionList.secondaryLocations" +
    "&finder=findReqs;siteNumber=CX_1001" +
    ",facetsList=LOCATIONS" +
    ",limit=25" +
    ",keyword=software+engineer" +
    `,locationId=${locationId}` +
    `,selectedLocationsFacet=${locationId}` +
    ",sortBy=POSTING_DATES_DESC";
}

export async function collectJPMorganJobs(_unused, config, log) {
  const locationIds = JPMC_CA_LOCATION_ID
    ? [JPMC_US_LOCATION_ID, JPMC_CA_LOCATION_ID]
    : [JPMC_US_LOCATION_ID];

  try {
    const responses = await Promise.all(locationIds.map((locId) =>
      fetchWithTimeout(buildJPMorganUrl(locId), {
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ));

    const rawJobs = responses.flatMap((data) => data?.items?.[0]?.requisitionList || []);
    const jobs = rawJobs
      .map((raw) => parseJPMorganJob(raw))
      .filter(Boolean);

    log(`JPMorgan Chase API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`JPMorgan Chase API error: ${error.message}`);
    return [];
  }
}
