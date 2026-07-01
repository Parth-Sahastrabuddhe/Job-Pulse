import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseHexawareJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const rawCountry = raw.PrimaryLocationCountry;
  const countryCode = rawCountry === "US" ? "US" : rawCountry === "CA" ? "CA" : "NON-US";

  if (countryCode === "NON-US") return null;

  const url = `https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.PostedDate) {
    postedAt = new Date(raw.PostedDate).toISOString();
    postedPrecision = "day";
  }

  return finalizeJob({
    sourceKey: "hexaware",
    sourceLabel: "Hexaware",
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

export async function collectHexawareJobs(_unused, config, log) {
  try {
    // keyword narrows the corpus server-side (same param as ford.js on this
    // API). Without it this fetched the latest 25 reqs company-wide across all
    // roles and countries — Hexaware's volume is India-dominated, so a US SWE
    // req often never appeared in the response at all.
    const apiUrl = "https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions" +
      "?onlyData=true" +
      "&expand=requisitionList.secondaryLocations" +
      "&finder=findReqs;siteNumber=CX_1" +
      ",keyword=software+engineer" +
      ",limit=25" +
      ",sortBy=POSTING_DATES_DESC";

    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "accept": "application/json",
        "accept-encoding": "identity",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Hexaware API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data?.items?.[0]?.requisitionList || [];

    const jobs = rawJobs
      .map((raw) => parseHexawareJob(raw))
      .filter(Boolean);

    log(`Hexaware API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Hexaware API error: ${error.message}`);
    return [];
  }
}
