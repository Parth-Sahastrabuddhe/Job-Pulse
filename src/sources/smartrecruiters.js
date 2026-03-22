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
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  if (US_STATES.test(location)) return "US";
  if (/United States/i.test(location)) return "US";
  const US_STATE_NAMES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATE_NAMES.test(location)) return "US";
  return "";
}

function parseSmartRecruitersJob(raw, companyConfig) {
  const title = raw.name?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.uuid || raw.id || "");
  const loc = raw.location || {};
  const locationParts = [loc.city, loc.region, loc.country].filter(Boolean);
  const location = locationParts.join(", ");
  const countryCode = loc.country === "United States" || loc.countryCode === "us"
    ? "US"
    : inferCountry(location);

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
