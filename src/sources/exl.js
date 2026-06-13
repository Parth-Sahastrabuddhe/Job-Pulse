import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

// EXL Service runs on Oracle Cloud HCM (same Fusion SaaS pod family as Hexaware).
// Unlike Hexaware, EXL's board is ~64% India and US is a minority, so we apply the
// US LOCATIONS facet server-side (locationId below) instead of fetching the global
// most-recent feed — otherwise the India flood buries the rare US roles.
// Canada is intentionally NOT enabled here: EXL exposes few/no Canadian SWE roles
// and the same flood concern applies. Revisit if CA demand appears (plan Task 13).
const POD = "https://fa-ewjt-saasfaprod1.fa.ocs.oraclecloud.com";
const SITE = "CX_2";
const US_LOCATION_ID = "300000000467584";

function parseExlJob(raw) {
  const title = raw.Title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.Id || "");
  const location = raw.PrimaryLocation || "";
  const countryCode = raw.PrimaryLocationCountry === "US" ? "US" : "";

  // Defense in depth — the US facet should already constrain this, but a stray
  // multi-country posting can slip through, so drop anything not primarily US.
  if (countryCode !== "US") return null;

  const url = `${POD}/hcmUI/CandidateExperience/en/sites/${SITE}/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.PostedDate) {
    postedAt = new Date(raw.PostedDate).toISOString();
    postedPrecision = "day";
  }

  return finalizeJob({
    sourceKey: "exl",
    sourceLabel: "EXL",
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

export async function collectExlJobs(_unused, config, log) {
  try {
    const apiUrl = `${POD}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      "?onlyData=true" +
      "&expand=requisitionList.secondaryLocations" +
      `&finder=findReqs;siteNumber=${SITE}` +
      ",facetsList=LOCATIONS" +
      ",limit=25" +
      `,locationId=${US_LOCATION_ID}` +
      `,selectedLocationsFacet=${US_LOCATION_ID}` +
      ",sortBy=POSTING_DATES_DESC";

    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "accept": "application/json",
        "accept-encoding": "identity",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`EXL API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data?.items?.[0]?.requisitionList || [];

    const jobs = rawJobs
      .map((raw) => parseExlJob(raw))
      .filter(Boolean);

    log(`EXL API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`EXL API error: ${error.message}`);
    return [];
  }
}
