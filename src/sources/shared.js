import { createHash } from "node:crypto";

const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN",
  "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ",
  "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA",
  "WI", "WV", "WY"
];

const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
  "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
  "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"
];

const US_CITY_STATE_CODE_PATTERN = new RegExp(
  `\\b[A-Za-z][A-Za-z .'-]+,\\s*(?:${US_STATE_CODES.join("|")})(?:\\b|\\s*,|\\s*\\|)`,
  "i"
);

const US_STATE_NAME_PATTERN = new RegExp(`\\b(?:${US_STATE_NAMES.join("|")})\\b`, "i");

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForMatch(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCountryCode(value) {
  const normalized = normalizeForMatch(value);

  if (!normalized) {
    return "";
  }

  if (
    normalized === "us" ||
    normalized === "usa" ||
    normalized === "u s" ||
    normalized === "u s a" ||
    normalized === "united states" ||
    normalized === "united states of america"
  ) {
    return "US";
  }

  if (/^[a-z]{2}$/i.test(normalized)) {
    return normalized.toUpperCase();
  }

  return normalized.toUpperCase();
}

// --- Role category patterns (one per supported category) ---
const ROLE_CATEGORY_PATTERNS = {
  software_engineer: /(?:(?:software|backend|back[\s-]?end|full[\s-]?stack|systems|cloud)\s+(?:engineer|develop)|application\s+(?:software\s+)?develop|\b(?:MTS|AMTS|SDE|SWE)\b|member\s+of\s+technical\s+staff)/i,
  data_engineer: /(?:data\s+(?:engineer|platform|infrastructure)|analytics\s+engineer|\bETL\b)/i,
  data_analyst: /(?:data\s+analyst|business\s+(?:intelligence\s+)?analyst|\bBI\s+analyst\b|analytics\s+analyst|product\s+analyst)/i,
  data_scientist: /(?:data\s+scientist|applied\s+scientist|research\s+scientist)/i,
  ml_engineer: /(?:machine\s+learning|(?:ML|AI)\s+engineer|deep\s+learning|\bNLP\b|computer\s+vision|\bGenAI\b|generative\s+AI|LLM\s+engineer|prompt\s+engineer|foundation\s+model)/i,
  frontend: /(?:front[\s-]?end|UI\s+engineer|web\s+develop)/i,
  backend: /(?:back[\s-]?end|server\s+engineer|API\s+engineer)/i,
  devops_sre: /(?:\bdevops\b|\bSRE\b|site\s+reliability|(?:infrastructure|cloud)\s+engineer)/i,
  mobile: /(?:(?:iOS|Android|mobile)\s+(?:engineer|develop)|React\s+Native|Flutter)/i,
  product_manager: /(?:product\s+manager|program\s+manager|\bTPM\b|technical\s+program)/i,
};

const BROAD_ROLE_PATTERN = new RegExp(
  Object.values(ROLE_CATEGORY_PATTERNS).map((r) => r.source).join("|"),
  "i"
);

const PLATFORM_ENGINEER_PATTERN = /\bplatform\s+engineer/i;

// Centralized title filter — now matches all tech/PM roles at any seniority
export function isTargetRole(title) {
  if (!title) return false;
  const t = title.trim();
  return BROAD_ROLE_PATTERN.test(t) || PLATFORM_ENGINEER_PATTERN.test(t);
}

export function detectRoleCategories(title) {
  if (!title) return [];
  const t = title.trim();
  const categories = [];
  for (const [category, pattern] of Object.entries(ROLE_CATEGORY_PATTERNS)) {
    if (pattern.test(t)) {
      categories.push(category);
    }
  }
  if (PLATFORM_ENGINEER_PATTERN.test(t) && !categories.includes("software_engineer")) {
    categories.push("software_engineer");
  }
  return categories;
}

// Priority order: most specific archetype wins
const ARCHETYPE_PRIORITY = [
  ["data_scientist", "DS"],
  ["data_analyst", "DA"],
  ["ml_engineer", "ML/AI"],
  ["data_engineer", "Data"],
  ["mobile", "Mobile"],
  ["devops_sre", "DevOps"],
  ["frontend", "Frontend"],
  ["backend", "Backend"],
  ["product_manager", "PM"],
];

export function detectArchetype(title) {
  if (!title) return null;
  const categories = detectRoleCategories(title);
  if (categories.length === 0) return null;

  if (PLATFORM_ENGINEER_PATTERN.test(title.trim())) return "Platform";

  for (const [cat, label] of ARCHETYPE_PRIORITY) {
    if (categories.includes(cat)) return label;
  }

  // Fallback: generic software_engineer → "Fullstack"
  if (categories.includes("software_engineer")) return "Fullstack";
  return null;
}

export function detectSeniority(title) {
  if (!title) return "mid";
  const t = title.trim();
  if (!t) return "mid";

  // Director / Chief — always blocked (checked first)
  if (/\b(director|chief)\b/i.test(t)) return "director";
  if (/\bMD\b/.test(t)) return "director";

  // Staff / Principal (check before senior — most specific)
  if (/\b((?<!technical\s)staff|princ\w*|distinguished|fellow)\b/i.test(t)) return "staff";
  if (/\barchitect\b/i.test(t) && !/\bsolution/i.test(t)) return "staff";
  if (/\bSVP\b/.test(t)) return "staff";

  // Intern
  if (/\b(intern|internship|co[\s-]?op)\b/i.test(t)) return "intern";

  // Senior
  if (/\b(senior|sr\.?)\b/i.test(t)) return "senior";
  if (/\blead\w*\b/i.test(t)) return "senior";
  if (/\bvice\s+president\b|\bVP\b/i.test(t)) return "senior";
  if (/\bAVP\b/.test(t)) return "senior";
  if (/\bmanager\b/i.test(t)) return "senior";

  // Entry+Mid composite — SWE I / SDE I / Engineer 1 / Roman numeral I (no II/III suffix)
  if (/\b(?:SWE|SDE)\s*I\b/.test(t) && !/\b(?:SWE|SDE)\s*II\b/.test(t)) return "entry_mid";
  if (/\bengineer\s+1\b/i.test(t) && !/\bengineer\s+[23]\b/i.test(t)) return "entry_mid";
  if (/\bI\b/.test(t) && !/\bII\b/.test(t) && !/\bIII\b/.test(t)) return "entry_mid";

  // Entry only — new grad, early career, junior
  if (/\b(new\s+grad|early[\s-]?career|entry[\s-]?level|junior|jr\.?)\b/i.test(t)) return "entry";

  // Plain Software Engineer / Software Development Engineer / Software Engineering titles
  // without explicit level markers (II/III, 2/3) → entry_mid so entry-only users also match.
  // I / 1 is already handled by the entry_mid rules above.
  if (/\b(software\s+(?:development\s+)?engineer|software\s+engineering)\b/i.test(t)
      && !/\b(?:II|III)\b/.test(t)
      && !/\bengineer\s+[23]\b/i.test(t)) {
    return "entry_mid";
  }

  // Mid — default (includes SWE II/III, SDE II/III, Engineer 2/3)
  return "mid";
}

export function normalizeUrl(baseUrl, rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

export function finalizeJob(job) {
  const normalizedJob = {
    sourceKey: job.sourceKey,
    sourceLabel: job.sourceLabel,
    id: normalizeWhitespace(job.id ?? ""),
    title: normalizeWhitespace(job.title ?? ""),
    location: normalizeWhitespace(job.location ?? ""),
    postedText: normalizeWhitespace(job.postedText ?? ""),
    postedAt: normalizeWhitespace(job.postedAt ?? ""),
    postedPrecision: normalizeWhitespace(job.postedPrecision ?? ""),
    url: normalizeWhitespace(job.url ?? ""),
    countryCode: normalizeCountryCode(job.countryCode ?? "") || inferCountryCodeFromLocation(job.location ?? "")
  };

  const identity = [
    normalizedJob.sourceKey,
    normalizedJob.id,
    normalizedJob.url,
    normalizeForMatch(normalizedJob.title),
    normalizeForMatch(normalizedJob.location)
  ]
    .filter(Boolean)
    .join("|");

  return {
    ...normalizedJob,
    key: createHash("sha1").update(identity).digest("hex"),
    seniorityLevel: detectSeniority(normalizedJob.title),
    roleCategories: detectRoleCategories(normalizedJob.title),
    archetype: detectArchetype(normalizedJob.title)
  };
}

export function dedupeJobs(jobs) {
  const uniqueJobs = new Map();

  for (const job of jobs) {
    const key = job.key || job.url || `${job.sourceKey}:${job.id}:${job.title}`;

    if (!uniqueJobs.has(key)) {
      uniqueJobs.set(key, job);
    }
  }

  return [...uniqueJobs.values()];
}

export function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

const NON_US_CITIES = /\b(Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Chennai|Delhi|Gurgaon|Gurugram|Noida|Kolkata|Ahmedabad|Jaipur|Lucknow|Chandigarh|Thiruvananthapuram|Kochi|Coimbatore|Indore|Nagpur|Visakhapatnam|Bhubaneswar|Mangalore|Mysore|Vadodara|Surat|Amsterdam|London|Berlin|Munich|Frankfurt|Paris|Dublin|Tokyo|Singapore|Toronto|Vancouver|Montreal|Sydney|Melbourne|Shanghai|Beijing|Shenzhen|Seoul|Zurich|Stockholm|Warsaw|Prague|Lisbon|Madrid|Milan|Rome|Barcelona|Brussels|Vienna|Copenhagen|Oslo|Helsinki|Bucharest|Budapest|Krakow|Tel Aviv|Sao Paulo|Mexico City|Bogota|Manila|Kuala Lumpur|Jakarta|Bangkok|Ho Chi Minh|Cairo|Lagos|Nairobi|Johannesburg|Cape Town|Dubai|Riyadh|Hong Kong|Luxembourg|Zagreb|Belgrade|Tallinn|Riga|Vilnius|Kyiv|Minsk|Moscow|Istanbul|Karachi|Lahore|Dhaka|Colombo|Auckland|Wellington|Oxford|Cambridge|Edinburgh|Manchester|Birmingham UK|Bristol|Leeds|Glasgow|Hamburg|Cologne|Stuttgart|Lyon|Marseille|Toulouse|Osaka|Nagoya|Taipei|Hsinchu|Mississauga|Ottawa|Calgary|Edmonton|Brisbane|Perth|Adelaide|Guelph|Waterloo ON|Belfast|Cork|Limerick|Gothenburg|Malmo|Rotterdam|The Hague|Eindhoven|Shinjuku|Minato|Chiyoda|Chuo|Shibuya)\b/i;

export function inferCountryCodeFromLocation(location) {
  const text = normalizeWhitespace(location);

  if (!text) {
    return "";
  }

  // Check NON-US FIRST — prevents false positives like "INDIA, in" matching as "City, IN" (Indiana)
  if (NON_US_COUNTRIES.test(text) || NON_US_CITIES.test(text)) {
    return "NON-US";
  }

  if (
    /\bunited states\b/i.test(text) ||
    /\busa\b/i.test(text) ||
    /\bu\.s\.a?\b/i.test(text) ||
    /\bus only\b/i.test(text) ||
    /\bUS\b/.test(text)
  ) {
    return "US";
  }

  if (US_CITY_STATE_CODE_PATTERN.test(text) || US_STATE_NAME_PATTERN.test(text)) {
    return "US";
  }

  return "";
}

const NON_US_COUNTRIES = /\b(Netherlands|Germany|United Kingdom|UK|England|Scotland|Wales|Canada|India|Japan|China|France|Australia|Singapore|Ireland|Israel|South Korea|Brazil|Mexico|Sweden|Switzerland|Spain|Italy|Poland|Belgium|Austria|Denmark|Norway|Finland|Czech Republic|Czechia|Portugal|Romania|Taiwan|Philippines|Malaysia|Indonesia|Vietnam|Thailand|Colombia|Argentina|Chile|Costa Rica|Egypt|Nigeria|Kenya|South Africa|Saudi Arabia|UAE|United Arab Emirates|Hong Kong|Luxembourg|Hungary|Greece|Croatia|Serbia|Estonia|Latvia|Lithuania|Ukraine|Belarus|Russia|Turkey|Pakistan|Bangladesh|Sri Lanka|New Zealand|INDIA|CANADA|JAPAN|CHINA|FRANCE|GERMANY|AUSTRALIA|SINGAPORE)\b/;

export function looksExplicitlyNonUsLocation(location) {
  const text = normalizeWhitespace(location);

  if (!text) {
    return false;
  }

  if (inferCountryCodeFromLocation(text) === "US") {
    return false;
  }

  // Check for known non-US country names
  if (NON_US_COUNTRIES.test(text)) {
    return true;
  }

  // Check for "Virtual <Country>" pattern (common in Workday)
  if (/\bvirtual\s+\w+/i.test(text) && !/(virtual\s+(?:US|United States|America))/i.test(text)) {
    // If "Virtual <something>" and it's not US, likely non-US
    if (NON_US_COUNTRIES.test(text.replace(/virtual\s+/i, ""))) {
      return true;
    }
  }

  if (/\b(remote|hybrid|on[\s-]?site|onsite|multiple locations|various locations)\b/i.test(text)) {
    return false;
  }

  return /,|\|/.test(text);
}

export function jobMatchesCountryFilter(job, countryFilter) {
  const filter = normalizeCountryCode(countryFilter);

  if (!filter || filter === "ALL") {
    return true;
  }

  const jobCountry = normalizeCountryCode(job.countryCode) || inferCountryCodeFromLocation(job.location);

  // Whitelist approach: job MUST be confirmed US to pass through.
  // If country is unknown (empty), reject it — "guilty until proven innocent."
  // This prevents non-US jobs with ambiguous locations from leaking through.
  // The only exception: jobs with no location at all (empty string) — these are
  // typically remote roles where the API didn't specify a location.
  if (!jobCountry) {
    const loc = normalizeWhitespace(job.location);
    // No location at all — let it through (might be remote US)
    if (!loc) return true;
    // Generic remote/hybrid/multiple with no country specified — let through
    if (/^(remote|hybrid|multiple locations|various locations)$/i.test(loc)) return true;
    // Has location text but couldn't determine country — reject
    return false;
  }

  return jobCountry === filter;
}

function getUtcDateStamp(dateLike) {
  const parsedMs = typeof dateLike === "number" ? dateLike : Date.parse(dateLike);
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  const date = new Date(parsedMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getDateStampForTz(dateLike, tz) {
  const parsedMs = typeof dateLike === "number" ? dateLike : Date.parse(dateLike);
  if (!Number.isFinite(parsedMs)) return null;

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(parsedMs));

    const y = +parts.find((p) => p.type === "year").value;
    const m = +parts.find((p) => p.type === "month").value - 1;
    const d = +parts.find((p) => p.type === "day").value;
    return Date.UTC(y, m, d);
  } catch {
    return getUtcDateStamp(parsedMs);
  }
}

export function jobIsFresh(job, referenceTime, config) {
  const referenceMs = typeof referenceTime === "number" ? referenceTime : Date.parse(referenceTime);
  if (!Number.isFinite(referenceMs)) {
    return true;
  }

  const postedMs = Date.parse(job.postedAt ?? "");

  // When no posted date is available, trust the date-sorted page ordering
  // combined with state-based deduplication: if the job is new to state and
  // appeared on a "most recent" page, it is likely genuinely new.
  if (!Number.isFinite(postedMs)) {
    return true;
  }

  if (job.postedPrecision === "date" || job.postedPrecision === "day") {
    const stamp = config.timezone
      ? (v) => getDateStampForTz(v, config.timezone)
      : getUtcDateStamp;
    const jobDateStamp = stamp(job.postedAt);
    const referenceDateStamp = stamp(referenceMs);

    if (jobDateStamp === null || referenceDateStamp === null) {
      return true;
    }

    const ageDays = Math.floor((referenceDateStamp - jobDateStamp) / (24 * 60 * 60 * 1000));
    return ageDays <= config.maxDateOnlyAgeDays;
  }

  const ageMinutes = (referenceMs - postedMs) / (60 * 1000);
  // Allow up to 5 minutes of clock skew (future-dated jobs from ATS servers)
  return ageMinutes >= -5 && ageMinutes <= config.maxPostAgeMinutes;
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  // The timer must remain armed across the body read (resp.json() / resp.text()),
  // not only the headers — otherwise a server that streams headers fast and then
  // stalls the body will hang the caller forever. unref() so a pending timer
  // doesn't keep the event loop alive after the response is consumed.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  return fetch(url, { ...options, signal: controller.signal });
}

