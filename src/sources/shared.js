import { createHash } from "node:crypto";

const TITLE_KEYS = [
  "title",
  "jobTitle",
  "job_title",
  "displayTitle",
  "positionTitle",
  "postingTitle",
  "name",
  "headline"
];

const URL_KEYS = [
  "positionUrl",
  "position_url",
  "url",
  "href",
  "jobUrl",
  "jobURL",
  "job_url",
  "jobPath",
  "job_path",
  "detailUrl",
  "detail_url",
  "absoluteUrl",
  "absolute_url",
  "canonicalUrl",
  "canonical_url",
  "applyUrl",
  "apply_url",
  "jobLink",
  "externalPath"
];

const ID_KEYS = [
  "id",
  "jobId",
  "jobID",
  "job_id",
  "displayJobId",
  "display_job_id",
  "postingId",
  "posting_id",
  "jobNumber",
  "job_number",
  "requisitionId",
  "requisition_id",
  "requisitionIdentifier",
  "externalJobId",
  "external_job_id",
  "atsJobId"
];

const LOCATION_KEYS = [
  "location",
  "locations",
  "primaryLocation",
  "primary_location",
  "jobLocation",
  "job_location",
  "formattedLocation",
  "formatted_location",
  "city",
  "state",
  "country",
  "countryName"
];

const POSTED_KEYS = [
  "postedDate",
  "posted_date",
  "datePosted",
  "date_posted",
  "publicationDate",
  "publishDate",
  "publishedAt",
  "postedOn",
  "posted_on",
  "createdAt",
  "updatedAt",
  "openingDate",
  "postingDate",
  "posting_date",
  "postingPublishDate",
  "startDate",
  "created_at",
  "updated_at",
  "createdDate",
  "created_date",
  "dateCreated",
  "date_created",
  "postedDateUtc",
  "openDate",
  "open_date",
  "jobOpenDate",
  "job_open_date"
];

const POSTED_TIMESTAMP_KEYS = [
  "postedTs",
  "posted_ts",
  "postedTimestamp",
  "posted_timestamp",
  "publicationTs",
  "publication_ts",
  "creationTs",
  "creation_ts"
];

const COUNTRY_KEYS = [
  "countryCode",
  "country_code",
  "country",
  "countryName",
  "country_name",
  "locationCountry",
  "location_country",
  "primaryCountry",
  "primary_country"
];

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

export function titleMatchesKeywords(title, keywords) {
  if (!title) {
    return false;
  }

  if (keywords.length === 0) {
    return true;
  }

  const normalizedTitle = normalizeForMatch(title);
  return keywords.some((keyword) => normalizedTitle.includes(normalizeForMatch(keyword)));
}

function extractLooseText(value, depth = 0) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return normalizeWhitespace(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractLooseText(item, depth + 1))
      .filter(Boolean)
      .slice(0, 4);

    return parts.length > 0 ? parts.join(" | ") : null;
  }

  if (typeof value === "object" && depth < 2) {
    for (const key of ["formatted", "displayName", "name", "label", "text", "value", "city", "state", "country"]) {
      if (key in value) {
        const nested = extractLooseText(value[key], depth + 1);
        if (nested) {
          return nested;
        }
      }
    }
  }

  return null;
}

function pickField(candidate, keys) {
  for (const key of keys) {
    if (!(key in candidate)) {
      continue;
    }

    const extracted = extractLooseText(candidate[key]);
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

export function extractTitleFromObject(candidate) {
  return pickField(candidate, TITLE_KEYS);
}

export function extractUrlFromObject(candidate) {
  return pickField(candidate, URL_KEYS);
}

export function extractIdFromObject(candidate) {
  return pickField(candidate, ID_KEYS);
}

export function extractLocationFromObject(candidate) {
  const direct = pickField(candidate, LOCATION_KEYS);
  if (direct) {
    return direct;
  }

  const parts = [candidate.city, candidate.state, candidate.country]
    .map((part) => extractLooseText(part))
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

export function extractPostedFromObject(candidate) {
  return pickField(candidate, POSTED_KEYS);
}

function parseEpochTimestamp(value) {
  const numericValue =
    typeof value === "number" ? value : /^\d+$/.test(String(value ?? "").trim()) ? Number.parseInt(String(value), 10) : NaN;

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const milliseconds = numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000;
  const iso = new Date(milliseconds).toISOString();

  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function parsePostedTextToMetadata(postedText) {
  const text = normalizeWhitespace(postedText);
  if (!text) {
    return { postedText: "", postedAt: "", postedPrecision: "" };
  }

  const isoFromEpoch = parseEpochTimestamp(text);
  if (isoFromEpoch) {
    return { postedText: text, postedAt: isoFromEpoch, postedPrecision: "exact" };
  }

  const parsedMs = Date.parse(text);
  if (!Number.isFinite(parsedMs)) {
    return { postedText: text, postedAt: "", postedPrecision: "" };
  }

  const looksDateOnly =
    /^\w+\s+\d{1,2},\s+\d{4}$/i.test(text) ||
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text);

  return {
    postedText: text,
    postedAt: new Date(parsedMs).toISOString(),
    postedPrecision: looksDateOnly ? "date" : "exact"
  };
}

export function extractPostedMetadataFromObject(candidate) {
  for (const key of POSTED_TIMESTAMP_KEYS) {
    if (!(key in candidate)) {
      continue;
    }

    const postedAt = parseEpochTimestamp(candidate[key]);
    if (postedAt) {
      return {
        postedText: extractPostedFromObject(candidate) || "",
        postedAt,
        postedPrecision: "exact"
      };
    }
  }

  return parsePostedTextToMetadata(extractPostedFromObject(candidate));
}

export function extractCountryFromObject(candidate) {
  const extracted = pickField(candidate, COUNTRY_KEYS);
  return normalizeCountryCode(extracted);
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

export function extractNumericId(text) {
  const match = String(text ?? "").match(/\b(\d{5,})\b/);
  return match ? match[1] : null;
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
    key: createHash("sha1").update(identity).digest("hex")
  };
}

export function sameLogicalJob(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left.sourceKey !== right.sourceKey) {
    return false;
  }

  if (left.id && right.id) {
    return left.id === right.id;
  }

  return (
    normalizeForMatch(left.title) === normalizeForMatch(right.title) &&
    normalizeForMatch(left.location) === normalizeForMatch(right.location)
  );
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

export function walkObjects(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      walkObjects(entry, visit);
    }
    return;
  }

  if (value && typeof value === "object") {
    visit(value);

    for (const entry of Object.values(value)) {
      walkObjects(entry, visit);
    }
  }
}

export function splitLines(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

export function guessRelevantTitle(text, cardText, keywords) {
  const candidates = [normalizeWhitespace(text), ...splitLines(cardText)];
  return candidates.find((line) => line.length <= 120 && titleMatchesKeywords(line, keywords)) || null;
}

export function guessLocationFromCardText(cardText, title) {
  const titleMatch = normalizeForMatch(title);

  for (const line of splitLines(cardText)) {
    const normalizedLine = normalizeForMatch(line);

    if (!line || normalizedLine === titleMatch) {
      continue;
    }

    if (/apply|save|share|job number|job id|learn more/i.test(line)) {
      continue;
    }

    if (/remote/i.test(line)) {
      return line;
    }

    if (/,[ ]*[A-Z]{2}\b/.test(line) || /,[ ]*[A-Za-z ]+$/.test(line)) {
      return line;
    }
  }

  return null;
}

export function guessPostedFromCardText(cardText) {
  for (const line of splitLines(cardText)) {
    if (
      /(posted|today|yesterday|\d+\s+(minute|hour|day|week|month)s?\s+ago|\b[A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/i.test(
        line
      )
    ) {
      return line;
    }
  }

  return null;
}

const NON_US_CITIES = /\b(Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Chennai|Delhi|Gurgaon|Noida|Kolkata|Amsterdam|London|Berlin|Munich|Frankfurt|Paris|Dublin|Tokyo|Singapore|Toronto|Vancouver|Montreal|Sydney|Melbourne|Shanghai|Beijing|Shenzhen|Seoul|Zurich|Stockholm|Warsaw|Prague|Lisbon|Madrid|Milan|Rome|Barcelona|Brussels|Vienna|Copenhagen|Oslo|Helsinki|Bucharest|Budapest|Krakow|Tel Aviv|Sao Paulo|Mexico City|Bogota|Manila|Kuala Lumpur|Jakarta|Bangkok|Ho Chi Minh|Cairo|Lagos|Nairobi|Johannesburg|Cape Town|Dubai|Riyadh|Hong Kong|Luxembourg|Zagreb|Belgrade|Tallinn|Riga|Vilnius|Kyiv|Minsk|Moscow|Istanbul|Karachi|Lahore|Dhaka|Colombo|Auckland|Wellington|Oxford|Cambridge|Edinburgh|Manchester|Birmingham UK|Bristol|Leeds|Glasgow|Hamburg|Cologne|Stuttgart|Lyon|Marseille|Toulouse|Osaka|Nagoya|Taipei|Hsinchu|Mississauga|Ottawa|Calgary|Edmonton|Brisbane|Perth|Adelaide|Guelph|Waterloo ON|Belfast|Cork|Limerick|Gothenburg|Malmo|Rotterdam|The Hague|Eindhoven)\b/i;

export function inferCountryCodeFromLocation(location) {
  const text = normalizeWhitespace(location);

  if (!text) {
    return "";
  }

  if (
    /\bunited states\b/i.test(text) ||
    /\busa\b/i.test(text) ||
    /\bu\.s\.a?\b/i.test(text) ||
    /\bus only\b/i.test(text)
  ) {
    return "US";
  }

  if (US_CITY_STATE_CODE_PATTERN.test(text) || US_STATE_NAME_PATTERN.test(text)) {
    return "US";
  }

  // Detect known non-US locations
  if (NON_US_COUNTRIES.test(text) || NON_US_CITIES.test(text)) {
    return "NON-US";
  }

  return "";
}

const NON_US_COUNTRIES = /\b(Netherlands|Germany|United Kingdom|UK|Canada|India|Japan|China|France|Australia|Singapore|Ireland|Israel|South Korea|Brazil|Mexico|Sweden|Switzerland|Spain|Italy|Poland|Belgium|Austria|Denmark|Norway|Finland|Czech Republic|Portugal|Romania|Taiwan|Philippines|Malaysia|Indonesia|Vietnam|Thailand|Colombia|Argentina|Chile|Costa Rica|Egypt|Nigeria|Kenya|South Africa|Saudi Arabia|UAE|Hong Kong|Luxembourg|Hungary|Greece|Croatia|Serbia|Estonia|Latvia|Lithuania|Ukraine|Belarus|Russia|Turkey|Pakistan|Bangladesh|Sri Lanka|New Zealand)\b/i;

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
  if (!jobCountry) {
    return !looksExplicitlyNonUsLocation(job.location);
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
    const jobDateStamp = getUtcDateStamp(job.postedAt);
    const referenceDateStamp = getUtcDateStamp(referenceMs);

    if (jobDateStamp === null || referenceDateStamp === null) {
      return true;
    }

    const ageDays = Math.floor((referenceDateStamp - jobDateStamp) / (24 * 60 * 60 * 1000));
    return ageDays <= config.maxDateOnlyAgeDays;
  }

  const ageMinutes = (referenceMs - postedMs) / (60 * 1000);
  return ageMinutes >= 0 && ageMinutes <= config.maxPostAgeMinutes;
}

export function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function captureJsonResponses(page) {
  const payloads = [];
  const pending = new Set();

  const handler = (response) => {
    const requestType = response.request().resourceType();
    if (!["xhr", "fetch"].includes(requestType)) {
      return;
    }

    const contentType = (response.headers()["content-type"] || "").toLowerCase();
    if (!contentType.includes("json")) {
      return;
    }

    const task = (async () => {
      try {
        payloads.push({
          url: response.url(),
          body: await response.json()
        });
      } catch {
        // Ignore unreadable payloads.
      }
    })();

    pending.add(task);
    task.finally(() => pending.delete(task));
  };

  page.on("response", handler);

  return {
    async stop() {
      page.off("response", handler);
      await Promise.allSettled([...pending]);
      return payloads;
    }
  };
}

export async function dismissCommonOverlays(page) {
  const buttonLabels = [/accept/i, /accept all/i, /allow all/i, /i agree/i, /got it/i];

  for (const label of buttonLabels) {
    const locator = page.locator("button, a").filter({ hasText: label }).first();

    if ((await locator.count()) === 0) {
      continue;
    }

    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    await locator.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

export async function clickVisibleButtons(page, patterns, maxClicks) {
  for (let clickCount = 0; clickCount < maxClicks; clickCount += 1) {
    let clicked = false;

    for (const pattern of patterns) {
      const locator = page.locator("button, a").filter({ hasText: pattern }).first();

      if ((await locator.count()) === 0) {
        continue;
      }

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }

      await locator.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1200);
      clicked = true;
      break;
    }

    if (!clicked) {
      break;
    }
  }
}

export async function scrollPage(page, steps) {
  for (let index = 0; index < steps; index += 1) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(1000);
  }
}

export async function extractDomLinkCandidates(page) {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((anchor) => {
      const href = anchor.href || anchor.getAttribute("href") || "";
      const text =
        anchor.textContent?.trim() ||
        anchor.getAttribute("aria-label") ||
        anchor.getAttribute("title") ||
        "";
      const container = anchor.closest("article, li, section, div");
      const cardText = container?.innerText || text;

      return {
        href,
        text,
        cardText
      };
    })
  );
}
