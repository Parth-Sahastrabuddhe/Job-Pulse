import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parseDynatraceJob(result) {
  const raw = result.raw || {};
  const title = (raw.title || result.title || "").trim();
  if (!title || !isTargetRole(title)) return null;

  const countries = raw.country || [];
  if (!countries.includes("United States")) return null;

  const id = String(raw.job_id || "");
  const locations = raw.office_locations || [];
  const location = locations.join(", ");

  // Extract numeric ID from clickUri (e.g. /careers/jobs/1362636200)
  const clickId = result.clickUri?.match(/\/(\d+)\/?$/)?.[1] || id;
  const url = `https://www.dynatrace.com/careers/jobs/${clickId}`;

  return finalizeJob({
    sourceKey: "dynatrace",
    sourceLabel: "Dynatrace",
    id: clickId,
    title,
    location,
    url,
    countryCode: "US"
  });
}

export async function collectDynatraceJobs(_unused, config, log) {
  try {
    const apiUrl = "https://www.dynatrace.com/api/coveo/search/";

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://www.dynatrace.com",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      body: JSON.stringify({ numberOfResults: 100 })
    });

    if (!response.ok) {
      log(`Dynatrace API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawResults = data?.results || [];

    const jobs = rawResults
      .map((r) => parseDynatraceJob(r))
      .filter(Boolean);

    log(`Dynatrace API returned ${rawResults.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Dynatrace API error: ${error.message}`);
    return [];
  }
}
