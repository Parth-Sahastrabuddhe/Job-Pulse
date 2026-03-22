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

function inferCountry(locationName) {
  if (!locationName) return "";
  if (/\bUS\b|\bUnited States\b/i.test(locationName)) return "US";
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  if (US_STATES.test(locationName)) return "US";
  const US_STATE_NAMES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATE_NAMES.test(locationName)) return "US";
  return "";
}

function parseGreenhouseJob(raw, companyConfig) {
  const title = raw.title?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.id || "");
  const location = raw.location?.name || "";
  const countryCode = inferCountry(location);

  let postedAt = "";
  let postedPrecision = "";
  const postedText = "";

  if (raw.first_published) {
    postedAt = new Date(raw.first_published).toISOString();
    postedPrecision = "exact";
  } else if (raw.updated_at) {
    postedAt = new Date(raw.updated_at).toISOString();
    postedPrecision = "exact";
  }

  const url = raw.absolute_url || `${companyConfig.jobUrlBase}${id}`;

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
