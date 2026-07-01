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

/**
 * Parse a stored user country preference into an uppercased array.
 * Accepts a JSON array string ('["US","CA"]'), a legacy scalar ("US", "ALL"),
 * or empty/null. Always returns a non-empty array; falls back to ["US"].
 */
export function parseUserCountries(value) {
  let list;
  try {
    if (typeof value === "string" && value.trim().startsWith("[")) {
      list = JSON.parse(value);
    } else if (value !== undefined && value !== null && value !== "") {
      list = [value];
    } else {
      list = ["US"];
    }
  } catch {
    list = ["US"];
  }
  const normalized = (Array.isArray(list) ? list : ["US"])
    .map((c) => String(c).toUpperCase())
    .filter(Boolean);
  return normalized.length ? normalized : ["US"];
}

// --- Role category patterns (one per supported category) ---
const ROLE_CATEGORY_PATTERNS = {
  software_engineer: /(?:(?:software|backend|back[\s-]?end|full[\s-]?stack|systems|cloud)\s+(?:engineer|develop)|\bSW\s+(?:engineer|develop)|applications?\s+(?:software\s+)?develop|\b(?:MTS|AMTS|SDE|SWE)\b|member\s+of\s+technical\s+staff)/i,
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
  // Roman-numeral level I must follow a role noun ("Engineer I", "Developer I"),
  // not match any stray "I" elsewhere in the title.
  if (/\b(?:engineer|developer|analyst|scientist|architect|programmer)\s+I\b/i.test(t)
      && !/\bII\b/.test(t) && !/\bIII\b/.test(t)) return "entry_mid";

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

const NON_US_CITIES = /\b(Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Chennai|Delhi|Gurgaon|Gurugram|Noida|Kolkata|Ahmedabad|Jaipur|Lucknow|Chandigarh|Thiruvananthapuram|Kochi|Coimbatore|Indore|Nagpur|Visakhapatnam|Bhubaneswar|Mangalore|Mysore|Vadodara|Surat|Amsterdam|London|Berlin|Munich|Frankfurt|Paris|Dublin|Tokyo|Singapore|Sydney|Melbourne|Shanghai|Beijing|Shenzhen|Seoul|Zurich|Stockholm|Warsaw|Prague|Lisbon|Madrid|Milan|Rome|Barcelona|Brussels|Vienna|Copenhagen|Oslo|Helsinki|Bucharest|Budapest|Krakow|Tel Aviv|Sao Paulo|Mexico City|Bogota|Manila|Kuala Lumpur|Jakarta|Bangkok|Ho Chi Minh|Cairo|Lagos|Nairobi|Johannesburg|Cape Town|Dubai|Riyadh|Hong Kong|Luxembourg|Zagreb|Belgrade|Tallinn|Riga|Vilnius|Kyiv|Minsk|Moscow|Istanbul|Tbilisi|Batumi|Karachi|Lahore|Dhaka|Colombo|Auckland|Wellington|Oxford|Cambridge|Edinburgh|Manchester|Birmingham UK|Bristol|Leeds|Glasgow|Hamburg|Cologne|Stuttgart|Lyon|Marseille|Toulouse|Osaka|Nagoya|Taipei|Hsinchu|Brisbane|Perth|Adelaide|Belfast|Cork|Limerick|Gothenburg|Malmo|Rotterdam|The Hague|Eindhoven|Shinjuku|Minato|Chiyoda|Chuo|Shibuya|Dusseldorf|Dortmund|Leipzig|Nantes|Lille|Bordeaux|Grenoble|Wroclaw|Gdansk|Poznan|Galway|Sao Jose dos Campos|Campinas)\b/i;

// Canada province two-letter codes (comma-anchored, mirrors US_CITY_STATE_CODE_PATTERN).
// Deliberately excludes "CA" so "San Francisco, CA" stays US (CA = California).
// No overlap with US_STATE_CODES, so this can be evaluated before the US patterns.
const CA_PROVINCE_CODES = ["ON", "BC", "QC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU"];
const CA_CITY_PROVINCE_CODE_PATTERN = new RegExp(
  `\\b[A-Za-z][A-Za-z .'-]+,\\s*(?:${CA_PROVINCE_CODES.join("|")})(?:\\b|\\s*,|\\s*\\|)`,
  "i"
);
const CA_PROVINCE_NAME_PATTERN = /\b(Ontario|British Columbia|Quebec|Qu[eé]bec|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland(?: and Labrador)?|Prince Edward Island|Yukon|Northwest Territories|Nunavut)\b/i;
const CA_CITIES = /\b(Toronto|Vancouver|Montreal|Montr[eé]al|Mississauga|Ottawa|Calgary|Edmonton|Guelph|Waterloo ON|Kitchener|Burnaby|Brampton|Hamilton ON|Halifax|Winnipeg|Victoria BC|Markham|Richmond Hill|North York|Scarborough|Etobicoke|Quebec City)\b/i;
const CA_EXPLICIT = /\bCanada\b/i;
const CA_CODE = /\bCAN\b/; // case-sensitive 3-letter ISO; avoids matching "can"

// US state codes collide with ISO2 country codes (IN=India/Indiana,
// DE=Germany/Delaware, IL=Israel/Illinois) and "Georgia" is both a US state and
// a country, so "Pune, IN" / "Berlin, DE" / "Tbilisi, Georgia" would hit the US
// patterns below and be stamped US — a live leak, since the downstream gate
// trusts the tag. A foreign city name alone must NOT flip the result (Berlin NH,
// Warsaw IN, Cambridge MA are real US towns), so each check requires the city
// AND its country's code/name to appear together. Codes are case-sensitive
// uppercase to avoid matching prose ("...in the region").
const FOREIGN_CITY_COUNTRY_PAIRS = [
  { city: /\b(?:Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Chennai|Delhi|Gurgaon|Gurugram|Noida|Kolkata|Ahmedabad|Jaipur|Lucknow|Chandigarh|Thiruvananthapuram|Kochi|Coimbatore|Indore|Nagpur|Visakhapatnam|Bhubaneswar|Mangalore|Mysore|Vadodara|Surat)\b/i, country: /,\s*IN\b/ },
  { city: /\b(?:Berlin|Munich|Frankfurt|Hamburg|Cologne|Stuttgart|Dusseldorf|Dortmund|Leipzig)\b/i, country: /,\s*DE\b/ },
  { city: /\b(?:Tel Aviv|Haifa|Jerusalem|Herzliya)\b/i, country: /,\s*IL\b/ },
  { city: /\bJakarta\b/i, country: /,\s*ID\b/ },
  { city: /\bBogota\b/i, country: /,\s*CO\b/ },
  { city: /\b(?:Tbilisi|Batumi)\b/i, country: /\bGeorgia\b|,\s*GE\b/i },
];

export function inferCountryCodeFromLocation(location) {
  // Fold diacritics so accented forms ("São Paulo", "Düsseldorf", "Bogotá",
  // "Kraków", "Zürich") match the ASCII city/country allowlists below. The CA
  // province/city patterns keep their accented alternatives, which still match
  // post-fold (e.g. "Québec" → "Quebec" matches "Qu[eé]bec").
  const text = normalizeWhitespace(location).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (!text) {
    return "";
  }

  // 1. Explicit US words (strongest signal; US-biased for mixed strings).
  //    The dotted form uses (?![a-z]) instead of a trailing \b because \b after
  //    a period never matches end-of-string, which made plain "U.S." dead.
  if (
    /\bunited states\b/i.test(text) ||
    /\busa\b/i.test(text) ||
    /\bu\.s\.(?:a\.?)?(?![a-z])/i.test(text) ||
    /\bus only\b/i.test(text) ||
    /\bUS\b/.test(text)
  ) {
    return "US";
  }

  // 2. Explicit Canada words.
  if (CA_EXPLICIT.test(text) || CA_CODE.test(text)) {
    return "CA";
  }

  // 2.5. Paired foreign city + country code/name — must run BEFORE the US
  //      state-code/name patterns (step 5) to close the ISO2/state-code
  //      collision leak. See FOREIGN_CITY_COUNTRY_PAIRS for why pairing is
  //      required rather than city names alone.
  for (const pair of FOREIGN_CITY_COUNTRY_PAIRS) {
    if (pair.city.test(text) && pair.country.test(text)) {
      return "NON-US";
    }
  }

  // 3. Other non-US countries (and macro-region labels) — BEFORE state/province
  //    codes so "INDIA, IN" can't false-match as "City, IN" (Indiana). Canada was
  //    removed from this set. Region labels ("Asia", "Europe") run here too, after
  //    the US/Canada signals above so a US-inclusive string still resolves US.
  if (NON_US_COUNTRIES.test(text) || NON_US_REGIONS.test(text)) {
    return "NON-US";
  }

  // 4. Canada province codes (comma-anchored) — before US codes; the sets are disjoint.
  if (CA_CITY_PROVINCE_CODE_PATTERN.test(text)) {
    return "CA";
  }

  // 5. US city+state-code / state-name. Ordered after CA province codes; this is
  //    what makes "Vancouver, WA" resolve US (fixes a prior NON-US false positive)
  //    and "Ontario, CA" resolve US (California).
  if (US_CITY_STATE_CODE_PATTERN.test(text) || US_STATE_NAME_PATTERN.test(text)) {
    return "US";
  }

  // 6. Canada province full names.
  if (CA_PROVINCE_NAME_PATTERN.test(text)) {
    return "CA";
  }

  // 7. Canada city names (bare).
  if (CA_CITIES.test(text)) {
    return "CA";
  }

  // 8. Remaining non-US cities (Canadian entries removed from this set).
  if (NON_US_CITIES.test(text)) {
    return "NON-US";
  }

  return "";
}

const NON_US_COUNTRIES = /\b(Netherlands|Germany|United Kingdom|UK|Great Britain|Britain|England|Scotland|Wales|India|Japan|China|France|Australia|Singapore|Ireland|Israel|South Korea|Brazil|Mexico|Sweden|Switzerland|Spain|Italy|Poland|Belgium|Austria|Denmark|Norway|Finland|Czech Republic|Czechia|Portugal|Romania|Taiwan|Philippines|Malaysia|Indonesia|Vietnam|Thailand|Colombia|Argentina|Chile|Costa Rica|Egypt|Nigeria|Kenya|South Africa|Saudi Arabia|UAE|United Arab Emirates|Hong Kong|Luxembourg|Hungary|Greece|Croatia|Serbia|Estonia|Latvia|Lithuania|Ukraine|Belarus|Russia|Turkey|Pakistan|Bangladesh|Sri Lanka|New Zealand|INDIA|JAPAN|CHINA|FRANCE|GERMANY|AUSTRALIA|SINGAPORE)\b/;

// Continent / macro-region labels some boards use as the only location string
// (e.g. Binance "Asia", "Europe"). All are unambiguously outside the US.
// "Global", "Worldwide", "Remote" are intentionally excluded — they can include
// the US, and the US/Canada signals in inferCountryCodeFromLocation run first.
const NON_US_REGIONS = /\b(Asia(?:[\s-]?Pacific)?|APAC|EMEA|Europe|Africa|Middle East|Latin America|LATAM|Oceania|Southeast Asia)\b/i;

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

export function parseCountryFilter(countryFilter) {
  const parts = String(countryFilter ?? "")
    .split(",")
    .map((p) => normalizeCountryCode(p))
    .filter(Boolean);
  return new Set(parts);
}

export function jobMatchesCountryFilter(job, countryFilter) {
  const filters = parseCountryFilter(countryFilter);

  // Empty filter or "ALL" anywhere → pass everything.
  if (filters.size === 0 || filters.has("ALL")) {
    return true;
  }

  const jobCountry = normalizeCountryCode(job.countryCode) || inferCountryCodeFromLocation(job.location);

  // Whitelist approach: a job with a known country MUST be in the allowed set.
  // If country is unknown (empty), keep the existing grace rules: jobs with no
  // location at all (likely remote) and bare remote/hybrid/multiple pass; any
  // other location text is rejected ("guilty until proven innocent").
  if (!jobCountry) {
    const loc = normalizeWhitespace(job.location);
    // No location at all — let it through (might be remote US)
    if (!loc) return true;
    // Generic remote/hybrid/multiple with no country specified — let through
    if (/^(remote|hybrid|multiple locations|various locations)$/i.test(loc)) return true;
    // Has location text but couldn't determine country — reject
    return false;
  }

  return filters.has(jobCountry);
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

