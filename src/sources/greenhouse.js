import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseGreenhouseJob(raw, companyConfig) {
  const title = raw.title?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || "");
  const location = raw.location?.name || "";
  const countryCode = "";

  let postedAt = "";
  let postedPrecision = "";
  const postedText = "";

  if (raw.updated_at) {
    postedAt = new Date(raw.updated_at).toISOString();
    postedPrecision = "exact";
  }

  // Pinterest's `absolute_url` (`...?gh_jid=<id>`) lands on the generic listing
  // page; only the slugged URL opens the specific posting.
  let url;
  if (companyConfig.sourceKey === "pinterest") {
    url = `https://www.pinterestcareers.com/jobs/${id}/${slugifyTitle(title)}/?gh_jid=${id}`;
  } else {
    url = raw.absolute_url || `${companyConfig.jobUrlBase}${id}`;
  }

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText,
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectGreenhouseJobs(_unused, config, log, companyKey) {
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

    const jobs = rawJobs.map((raw) => parseGreenhouseJob(raw, companyConfig)).filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
