import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parseSmartRecruitersJob(raw, companyConfig) {
  const title = raw.name?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.uuid || raw.id || "");
  const loc = raw.location || {};
  const locationParts = [loc.city, loc.region, loc.country].filter(Boolean);
  const location = locationParts.join(", ");
  const countryCode = loc.country === "United States" || loc.countryCode?.toUpperCase() === "US"
    ? "US"
    : "";

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
  if (!companyConfig) return [];

  try {
    const apiUrl = `https://api.smartrecruiters.com/v1/companies/${companyConfig.companySlug}/postings?q=software+engineer&limit=100`;

    const response = await fetch(apiUrl, {
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.content || [];

    const jobs = rawJobs
      .map((raw) => parseSmartRecruitersJob(raw, companyConfig))
      .filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
