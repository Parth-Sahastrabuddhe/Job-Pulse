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

function isSalesforceSwe(title) {
  const t = title.trim();
  // Salesforce uses MTS (Member of Technical Staff) and AMTS as SWE titles
  if (/\b(MTS|AMTS|Member of Technical Staff|Associate Member of Technical Staff)\b/i.test(t)) {
    // Reject senior levels
    if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished|SMTS|PMTS)\b/i.test(t)) {
      return false;
    }
    return true;
  }
  return isEntryMidLevelSwe(t);
}

const TITLE_FILTERS = {
  salesforce: isSalesforceSwe
};

function parseRelativeDate(postedOn) {
  if (!postedOn) return { postedText: "", postedAt: "", postedPrecision: "" };

  const text = postedOn.trim();
  const now = Date.now();

  if (/today/i.test(text)) {
    return { postedText: text, postedAt: new Date(now).toISOString(), postedPrecision: "date" };
  }

  if (/yesterday/i.test(text)) {
    return { postedText: text, postedAt: new Date(now - 86400000).toISOString(), postedPrecision: "date" };
  }

  const daysMatch = text.match(/(\d+)\+?\s*day/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    return { postedText: text, postedAt: new Date(now - days * 86400000).toISOString(), postedPrecision: "date" };
  }

  const hoursMatch = text.match(/(\d+)\s*hour/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    return { postedText: text, postedAt: new Date(now - hours * 3600000).toISOString(), postedPrecision: "exact" };
  }

  return { postedText: text, postedAt: "", postedPrecision: "" };
}

function inferCountry(locationsText) {
  if (!locationsText) return "";
  if (/\bUS\b|\bUnited States\b/i.test(locationsText)) return "US";
  const US_STATES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATES.test(locationsText)) return "US";
  return "";
}

function parseWorkdayJob(raw, companyConfig) {
  const title = raw.title?.trim();
  const titleFilter = TITLE_FILTERS[companyConfig.sourceKey] || isEntryMidLevelSwe;
  if (!title || !titleFilter(title)) return null;

  const id = raw.bulletFields?.[0] || "";
  const location = raw.locationsText || raw.bulletFields?.[1] || "";
  const countryCode = inferCountry(location);
  const posted = parseRelativeDate(raw.postedOn);
  const url = `${companyConfig.baseUrl}${raw.externalPath}`;

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: posted.postedText,
    postedAt: posted.postedAt,
    postedPrecision: posted.postedPrecision,
    url,
    countryCode
  });
}

export async function collectWorkdayJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  try {
    const searchText = companyConfig.searchText || "software engineer";
    const response = await fetch(companyConfig.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appliedFacets: {},
        limit: 20,
        offset: 0,
        searchText
      })
    });

    if (!response.ok) {
      log(`${companyConfig.sourceLabel} API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawJobs = data.jobPostings ?? [];

    const jobs = rawJobs.map((raw) => parseWorkdayJob(raw, companyConfig)).filter(Boolean);

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
