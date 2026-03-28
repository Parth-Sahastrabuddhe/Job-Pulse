import { dedupeJobs, finalizeJob, inferCountryCodeFromLocation, isTargetRole } from "./shared.js";

function parseLeverJob(raw, companyConfig) {
  const title = raw.text?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || "");
  const location = raw.categories?.location || "";
  const countryCode = inferCountryCodeFromLocation(location);

  // Only include jobs with confirmed US location
  if (countryCode !== "US") {
    return null;
  }

  let postedAt = "";
  let postedPrecision = "";

  if (raw.createdAt) {
    postedAt = new Date(raw.createdAt).toISOString();
    postedPrecision = "exact";
  }

  const url = raw.hostedUrl || raw.applyUrl || "";

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectLeverJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  try {
    const response = await fetch(companyConfig.apiUrl, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const rawJobs = await response.json();

    const jobs = rawJobs
      .map((raw) => parseLeverJob(raw, companyConfig))
      .filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
