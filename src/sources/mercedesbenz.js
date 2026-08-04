import {
  asCollectorError,
  dedupeJobs,
  fetchWithTimeout,
  finalizeJob,
  isTargetRole,
  parseRowsSafely,
  safeText,
  toIsoOrEmpty,
} from "./shared.js";

function parseMercedesBenzJob(raw) {
  const desc = raw.MatchedObjectDescriptor;
  if (!desc) return null;

  const title = safeText(desc.PositionTitle);
  if (!title || !isTargetRole(title)) return null;

  const id = String(desc.ID || "");
  const loc = desc.PositionLocation?.[0] || {};
  const rawCc = loc.CountryCode;
  const countryCode = rawCc === "US" ? "US" : rawCc === "CA" ? "CA" : "NON-US";

  if (countryCode === "NON-US") return null;

  const city = loc.CityName || "";
  const state = loc.CountrySubDivisionName || "";
  const location = [city, state].filter(Boolean).join(", ");

  const url = `https://jobs.mercedes-benz.com/?ac=jobad&id=${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (desc.PublicationStartDate) {
    postedAt = toIsoOrEmpty(desc.PublicationStartDate);
    postedPrecision = "day";
  }

  return finalizeJob({
    sourceKey: "mercedesbenz",
    sourceLabel: "Mercedes-Benz",
    id,
    title,
    location,
    postedText: desc.PublicationStartDate || "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

async function fetchPage(apiUrl, offset, signal) {
  const response = await fetchWithTimeout(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://jobs.mercedes-benz.com",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    },
    body: JSON.stringify({
      criteria: {},
      parameters: { offset },
      languageCodes: ["en"]
    }),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const items = data?.SearchResult?.SearchResultItems;
  if (!Array.isArray(items)) throw new Error("response did not contain search result items");
  return items;
}

export async function collectMercedesBenzJobs(_unused, config, log) {
  try {
    const apiUrl = "https://mercedes-benz-beesite-production-gjb-intranet.app.beesite.de/search";
    const PAGE_SIZE = 10;
    const PAGES = 5;

    const allRaw = [];
    for (let page = 0; page < PAGES; page++) {
      const items = await fetchPage(apiUrl, page * PAGE_SIZE, config.signal);
      allRaw.push(...items);
      if (items.length < PAGE_SIZE) break;
    }

    const jobs = parseRowsSafely(allRaw, (raw) => parseMercedesBenzJob(raw));

    log(`Mercedes-Benz API returned ${allRaw.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Mercedes-Benz API error: ${error.message}`);
    throw asCollectorError("mercedesbenz", error);
  }
}
