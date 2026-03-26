import { dedupeJobs, finalizeJob } from "./shared.js";

function isEntryMidLevelSwe(title) {
  const t = title.trim();
  if (!/software\s+(engineer|develop)/i.test(t)) {
    return false;
  }
  if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished)\b/i.test(t)) {
    return false;
  }
  return true;
}

function parsePcsxJob(raw, companyConfig) {
  const title = raw.name?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.id ?? raw.displayJobId ?? "");

  const baseUrl = companyConfig.baseUrl || "";
  const positionUrl = raw.positionUrl
    ? `${baseUrl}${raw.positionUrl}`
    : raw.publicUrl || `${baseUrl}/careers/job/${id}`;

  let postedAt = "";
  let postedPrecision = "";

  if (raw.postedTs && Number.isFinite(raw.postedTs)) {
    const ms = raw.postedTs > 1_000_000_000_000 ? raw.postedTs : raw.postedTs * 1000;
    postedAt = new Date(ms).toISOString();
    postedPrecision = "exact";
  }

  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const location = locations.join(" | ");

  const stdLocs = Array.isArray(raw.standardizedLocations) ? raw.standardizedLocations : [];
  let countryCode = "";
  for (const loc of stdLocs) {
    if (/\bUS\b/.test(loc)) {
      countryCode = "US";
      break;
    }
  }

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: postedAt ? new Date(postedAt).toLocaleString() : "",
    postedAt,
    postedPrecision,
    url: positionUrl,
    countryCode
  });
}

export async function collectPcsxJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  try {
    const response = await fetch(companyConfig.apiUrl, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    });

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.data?.positions ?? [];

    const jobs = rawJobs
      .map((raw) => parsePcsxJob(raw, companyConfig))
      .filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
