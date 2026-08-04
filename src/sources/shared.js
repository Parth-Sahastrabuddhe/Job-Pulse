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
// The role taxonomy (category patterns, sections, archetypes, seniority and
// the cross-company level rules) lives in src/role-taxonomy.js. Re-exported
// here so collectors, tests, and scripts keep their existing import paths.
import {
  isTargetRole,
  detectRoleCategories,
  detectSeniority,
  detectArchetype,
} from "../role-taxonomy.js";

export {
  isTargetRole,
  detectRoleCategories,
  detectSeniority,
  detectArchetype,
  resolveLevel,
  formatLevelLine,
  ROLE_CATEGORY_PATTERNS,
  ROLE_SECTIONS,
} from "../role-taxonomy.js";

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

/**
 * Canonical form used only when an ATS does not expose a stable posting ID.
 * Identity never includes mutable title/location/date metadata when a stable ID
 * or URL exists.
 */
export function canonicalizeJobUrl(rawUrl) {
  try {
    const url = new URL(normalizeWhitespace(rawUrl));
    if (url.protocol !== "https:") return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|referrer|source|src|tracking|gh_src)$/i.test(name)) {
        url.searchParams.delete(name);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function jobIdentity(sourceKey, id, url, title, location) {
  if (sourceKey && id) return `id|${sourceKey}|${id}`;
  const canonicalUrl = canonicalizeJobUrl(url);
  if (sourceKey && canonicalUrl) return `url|${sourceKey}|${canonicalUrl}`;
  return ["meta", sourceKey, normalizeForMatch(title), normalizeForMatch(location)]
    .filter(Boolean)
    .join("|");
}

export function finalizeJob(job) {
  const normalizedJob = {
    sourceKey: normalizeWhitespace(job.sourceKey ?? ""),
    sourceLabel: normalizeWhitespace(job.sourceLabel ?? ""),
    id: normalizeWhitespace(job.id ?? ""),
    title: normalizeWhitespace(job.title ?? ""),
    location: normalizeWhitespace(job.location ?? ""),
    postedText: normalizeWhitespace(job.postedText ?? ""),
    postedAt: normalizeWhitespace(job.postedAt ?? ""),
    postedPrecision: normalizeWhitespace(job.postedPrecision ?? ""),
    url: normalizeWhitespace(job.url ?? ""),
    countryCode: normalizeCountryCode(job.countryCode ?? "") || inferCountryCodeFromLocation(job.location ?? "")
  };

  const identity = jobIdentity(
    normalizedJob.sourceKey,
    normalizedJob.id,
    normalizedJob.url,
    normalizedJob.title,
    normalizedJob.location
  );

  return {
    ...normalizedJob,
    key: createHash("sha1").update(identity).digest("hex"),
    seniorityLevel: detectSeniority(normalizedJob.title, normalizedJob.sourceKey),
    roleCategories: detectRoleCategories(normalizedJob.title),
    archetype: detectArchetype(normalizedJob.title)
  };
}

export function dedupeJobs(jobs) {
  // First collapse the strongest identity: source + stable ATS ID.
  const bySourceId = new Map();
  const withoutStableId = [];
  for (const job of jobs) {
    const sourceKey = normalizeWhitespace(job?.sourceKey);
    const id = normalizeWhitespace(job?.id);
    if (!sourceKey || !id) {
      withoutStableId.push(job);
      continue;
    }
    const identity = `${sourceKey}\0${id}`;
    bySourceId.set(identity, bySourceId.has(identity)
      ? mergeRicherJob(bySourceId.get(identity), job)
      : job);
  }

  // Then collapse canonical URLs, including URL-only observations that later
  // acquire a stable ID. A stable-ID record always owns the resulting key.
  const byUrl = new Map();
  const byFallbackKey = new Map();
  const output = [];
  for (const job of [...bySourceId.values(), ...withoutStableId]) {
    const canonicalUrl = canonicalizeJobUrl(job?.url);
    if (!canonicalUrl) {
      const fallbackKey = normalizeWhitespace(job?.key);
      if (fallbackKey && byFallbackKey.has(fallbackKey)) {
        const index = byFallbackKey.get(fallbackKey);
        output[index] = mergeRicherJob(output[index], job);
        continue;
      }
      if (fallbackKey) byFallbackKey.set(fallbackKey, output.length);
      output.push(job);
      continue;
    }
    const existingIndex = byUrl.get(canonicalUrl);
    if (existingIndex === undefined) {
      byUrl.set(canonicalUrl, output.length);
      output.push(job);
      continue;
    }
    output[existingIndex] = mergeRicherJob(output[existingIndex], job);
  }
  return output;
}

function valueRichness(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return normalizeWhitespace(value).length;
  if (typeof value === "object") return Object.keys(value).length;
  return 1;
}

function mergeRicherJob(left, right) {
  const leftStable = Boolean(normalizeWhitespace(left?.sourceKey) && normalizeWhitespace(left?.id));
  const rightStable = Boolean(normalizeWhitespace(right?.sourceKey) && normalizeWhitespace(right?.id));
  const primary = !leftStable && rightStable ? right : left;
  const secondary = primary === left ? right : left;
  const merged = { ...secondary, ...primary };

  for (const key of new Set([...Object.keys(left || {}), ...Object.keys(right || {})])) {
    if (key === "key" || key === "sourceKey" || key === "id") continue;
    const primaryValue = primary?.[key];
    const secondaryValue = secondary?.[key];
    if (Array.isArray(primaryValue) && Array.isArray(secondaryValue)) {
      merged[key] = [...new Set([...primaryValue, ...secondaryValue])];
    } else if (valueRichness(secondaryValue) > valueRichness(primaryValue)) {
      merged[key] = secondaryValue;
    }
  }

  // The deterministic stable-ID key wins if one observation has it. Otherwise
  // preserve the first record's already-issued key.
  merged.key = leftStable ? left.key : rightStable ? right.key : left.key || right.key;
  return merged;
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

export class CollectorError extends Error {
  constructor(sourceKey, cause) {
    const message = cause instanceof Error ? cause.message : String(cause || "unknown collector failure");
    super(`${sourceKey}: ${message}`, cause instanceof Error ? { cause } : undefined);
    this.name = "CollectorError";
    this.code = "COLLECTOR_FAILED";
    this.sourceKey = sourceKey;
    // Preserve structured transport metadata so schedulers can respond to an
    // upstream rate limit without parsing an error message. The original cause
    // remains attached for diagnostics.
    if (Number.isInteger(cause?.status)) this.status = cause.status;
    if (Number.isFinite(cause?.retryAfterMs) && cause.retryAfterMs >= 0) {
      this.retryAfterMs = cause.retryAfterMs;
    }
    if (cause instanceof Error && !this.cause) this.cause = cause;
  }
}

export function asCollectorError(sourceKey, error) {
  if (error?.name === "AbortError" || ["ABORT_ERR", "COLLECTOR_TIMEOUT"].includes(error?.code)) return error;
  if (error instanceof CollectorError) return error;
  return new CollectorError(sourceKey, error);
}

// Ashby's largest current board is roughly 11 MiB, so keep a bounded margin
// without allowing an endpoint to stream indefinitely.
const DEFAULT_FETCH_MAX_BODY_BYTES = 16 * 1024 * 1024;
const MAX_FETCH_MAX_BODY_BYTES = 64 * 1024 * 1024;

function configuredFetchBodyLimit(options) {
  const requested = Number(options.maxResponseBytes ?? process.env.FETCH_MAX_BODY_BYTES);
  return Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, MAX_FETCH_MAX_BODY_BYTES)
    : DEFAULT_FETCH_MAX_BODY_BYTES;
}

class CappedFetchResponse {
  constructor(response, controller, timer, maxBytes, detachExternalAbort) {
    this._response = response;
    this._controller = controller;
    this._timer = timer;
    this._maxBytes = maxBytes;
    this._detachExternalAbort = detachExternalAbort;
    this._bufferPromise = null;
    this._finished = false;

    if ([204, 205].includes(response.status)) {
      this._discard();
    } else if (!response.ok) {
      // Most collectors ignore error bodies, while Gemini reads a bounded
      // snippet for diagnostics. Start buffering immediately so an ignored
      // error cannot retain its timer, but preserve the buffered body for a
      // later text()/json() call. The internal deadline still bounds a stalled
      // body; the parent listener can be detached once response headers exist.
      this._detachExternalAbort?.();
      this._detachExternalAbort = null;
      this._readBuffer().catch(() => {});
    }
  }

  get ok() { return this._response.ok; }
  get status() { return this._response.status; }
  get statusText() { return this._response.statusText; }
  get headers() { return this._response.headers; }
  get url() { return this._response.url; }
  get redirected() { return this._response.redirected; }
  get bodyUsed() { return this._response.bodyUsed; }

  _finish() {
    if (this._finished) return;
    this._finished = true;
    clearTimeout(this._timer);
    this._detachExternalAbort?.();
  }

  _discard() {
    this._finish();
    const cancellation = this._response.body?.cancel?.();
    cancellation?.catch?.(() => {});
  }

  async _readBuffer() {
    if (this._bufferPromise) return this._bufferPromise;
    this._bufferPromise = (async () => {
      const declared = Number(this.headers?.get?.("content-length"));
      if (Number.isFinite(declared) && declared > this._maxBytes) {
        this._controller.abort();
        throw new Error(`Response body exceeds ${this._maxBytes} bytes`);
      }

      if (!this._response.body?.getReader) {
        // Test doubles and older runtimes may not expose a stream. Preserve
        // their response methods, then enforce the cap on the resulting value.
        if (typeof this._response.text === "function") {
          const text = await this._response.text();
          const buffer = Buffer.from(text);
          if (buffer.byteLength > this._maxBytes) throw new Error(`Response body exceeds ${this._maxBytes} bytes`);
          return buffer;
        }
        throw new Error("Response body is unavailable");
      }

      const reader = this._response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > this._maxBytes) {
            this._controller.abort();
            throw new Error(`Response body exceeds ${this._maxBytes} bytes`);
          }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks, total);
      } finally {
        reader.releaseLock?.();
      }
    })().finally(() => this._finish());
    return this._bufferPromise;
  }

  async text() {
    return (await this._readBuffer()).toString("utf8");
  }

  async json() {
    // Preserve lightweight test doubles that only implement json(). Production
    // fetch Responses always expose a stream and take the capped path above.
    if (!this._response.body?.getReader && typeof this._response.json === "function") {
      try {
        const value = await this._response.json();
        if (Buffer.byteLength(JSON.stringify(value)) > this._maxBytes) {
          throw new Error(`Response body exceeds ${this._maxBytes} bytes`);
        }
        return value;
      } finally {
        this._finish();
      }
    }
    return JSON.parse(await this.text());
  }

  async arrayBuffer() {
    const buffer = await this._readBuffer();
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  // The timer must remain armed across the body read (resp.json() / resp.text()),
  // not only the headers — otherwise a server that streams headers fast and then
  // stalls the body will hang the caller forever. unref() so a pending timer
  // doesn't keep the event loop alive after the response is consumed.
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  const { maxResponseBytes: _ignoredLimit, ...fetchOptions } = options;
  try {
    // Source endpoints are expected to be canonical. Refusing implicit
    // redirects prevents a compromised ATS from bouncing a trusted fixed URL
    // into an internal service; arbitrary job-page redirects use safeFetch,
    // which validates every hop explicitly.
    const response = await fetch(url, {
      ...fetchOptions,
      // This security control is intentionally after caller options so a
      // collector cannot accidentally (or deliberately) override it.
      redirect: "error",
      signal: controller.signal,
    });
    return new CappedFetchResponse(
      response,
      controller,
      timer,
      configuredFetchBodyLimit(options),
      () => externalSignal?.removeEventListener("abort", onExternalAbort)
    );
  } catch (error) {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    throw error;
  }
}
