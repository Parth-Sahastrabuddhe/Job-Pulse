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

function inferCountry(location) {
  if (!location) return "";
  if (/\bUnited States\b/i.test(location)) return "US";
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  if (US_STATES.test(location)) return "US";
  const US_STATE_NAMES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATE_NAMES.test(location)) return "US";
  return "";
}

function parseLeverJob(raw, companyConfig) {
  const title = raw.text?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.id || "");
  const location = raw.categories?.location || "";
  const countryCode = inferCountry(location);

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
