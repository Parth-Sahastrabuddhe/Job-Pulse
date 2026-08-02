import { asCollectorError, dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseSmartRecruitersJob(raw, companyConfig) {
  const title = raw.name?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.uuid || raw.id || "");
  const loc = raw.location || {};
  const locationParts = [loc.city, loc.region, loc.country].filter(Boolean);
  const location = loc.fullLocation ?? locationParts.join(", ");
  // SmartRecruiters API returns 2-letter ISO codes (e.g. "us", "in", "br"), not full names
  const rawCountry = (loc.country || loc.countryCode || "").toLowerCase();
  const countryCode = rawCountry === "us" ? "US" : rawCountry === "ca" ? "CA" : rawCountry ? "NON-US" : "";

  // Drop confirmed-foreign rows at the source (match ford/hexaware): these
  // boards are global (Bosch/Sanofi/Experian), and keeping NON-US rows let
  // them crowd fresh US/CA jobs out of the maxJobsPerSource cap.
  if (countryCode === "NON-US") return null;

  const url = `https://jobs.smartrecruiters.com/${companyConfig.companySlug}/${raw.id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.releasedDate) {
    postedAt = new Date(raw.releasedDate).toISOString();
    postedPrecision = "exact";
  }

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: raw.releasedDate ? new Date(raw.releasedDate).toLocaleString() : "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectSmartRecruitersJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) throw asCollectorError(companyKey, new Error("missing company configuration"));

  try {
    const apiUrl = `https://api.smartrecruiters.com/v1/companies/${companyConfig.companySlug}/postings?q=software+engineer&limit=100`;

    const response = await fetchWithTimeout(apiUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      signal: config.signal,
    });

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data?.content)) throw new Error("response did not contain a content array");
    const rawJobs = data.content;

    const jobs = rawJobs
      .map((raw) => parseSmartRecruitersJob(raw, companyConfig))
      .filter(Boolean);

    // API ordering is not date-based. Sort by postedAt DESC so the
    // maxJobsPerSource cap keeps the freshest postings (same as lever.js).
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    throw asCollectorError(companyKey, error);
  }
}
