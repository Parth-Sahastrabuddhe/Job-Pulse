import { dedupeJobs, finalizeJob } from "./shared.js";

function isEntryMidLevelSwe(title) {
  const t = title.trim();
  if (!/software\s+(engineer|develop)/i.test(t)) {
    return false;
  }
  // Standard filter + banking titles (VP/SVP are senior at banks)
  if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished|vice\s+president|VP|SVP|AVP|managing\s+director|MD)\b/i.test(t)) {
    return false;
  }
  return true;
}

function parseJPMorganJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const countryCode = raw.PrimaryLocationCountry === "US" ? "US" : "";

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

export async function collectJPMorganJobs(_unused, config, log) {
  // locationId 300000000289738 = United States
  const apiUrl = "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions" +
    "?onlyData=true" +
    "&expand=requisitionList.secondaryLocations" +
    "&finder=findReqs;siteNumber=CX_1001" +
    ",facetsList=LOCATIONS" +
    ",limit=25" +
    ",keyword=software+engineer" +
    ",locationId=300000000289738" +
    ",selectedLocationsFacet=300000000289738" +
    ",sortBy=POSTING_DATES_DESC";

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`JPMorgan Chase API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data?.items?.[0]?.requisitionList || [];

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
