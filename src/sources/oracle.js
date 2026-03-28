import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parseOracleJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const countryCode = raw.PrimaryLocationCountry === "US" ? "US" : "";

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

export async function collectOracleJobs(_unused, config, log) {
  try {
    const apiUrl = "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions" +
      "?onlyData=true" +
      "&expand=requisitionList.secondaryLocations" +
      "&finder=findReqs;siteNumber=CX_45001" +
      ",facetsList=LOCATIONS" +
      ",limit=25" +
      ",keyword=software+engineer" +
      ",locationId=300000000149325" +
      ",selectedLocationsFacet=300000000149325" +
      ",sortBy=POSTING_DATES_DESC";

    const response = await fetch(apiUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Oracle API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data?.items?.[0]?.requisitionList || [];

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
