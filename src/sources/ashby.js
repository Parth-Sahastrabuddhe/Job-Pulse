import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parseAshbyJob(raw, companyConfig) {
  const title = raw.title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || "");
  const location = raw.location || "";
  const countryCode = "";

  let postedAt = "";
  let postedPrecision = "";

  if (raw.publishedAt) {
    postedAt = new Date(raw.publishedAt).toISOString();
    postedPrecision = "exact";
  } else if (raw.updatedAt) {
    postedAt = new Date(raw.updatedAt).toISOString();
    postedPrecision = "exact";
  }

  const url = raw.jobUrl || `https://jobs.ashbyhq.com/${companyConfig.boardSlug}/${id}`;

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

export async function collectAshbyJobs(_unused, config, log, companyKey) {
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

    const data = await response.json();
    const rawJobs = data.jobs ?? [];

    const jobs = rawJobs.map((raw) => parseAshbyJob(raw, companyConfig)).filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
