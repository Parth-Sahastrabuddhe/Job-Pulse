import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function parseMercedesBenzJob(raw) {
  const desc = raw.MatchedObjectDescriptor;
  if (!desc) return null;

  const title = desc.PositionTitle?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(desc.ID || "");
  const loc = desc.PositionLocation?.[0] || {};
  const countryCode = loc.CountryCode === "US" ? "US" : "";

  if (countryCode !== "US") return null;

  const city = loc.CityName || "";
  const state = loc.CountrySubDivisionName || "";
  const location = [city, state].filter(Boolean).join(", ");

  const url = `https://jobs.mercedes-benz.com/?ac=jobad&id=${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (desc.PublicationStartDate) {
    postedAt = new Date(desc.PublicationStartDate).toISOString();
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

async function fetchPage(apiUrl, offset) {
  const response = await fetch(apiUrl, {
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
    })
  });
  if (!response.ok) return [];
  const data = await response.json();
  return data?.SearchResult?.SearchResultItems || [];
}

export async function collectMercedesBenzJobs(_unused, config, log) {
  try {
    const apiUrl = "https://mercedes-benz-beesite-production-gjb-intranet.app.beesite.de/search";
    const PAGE_SIZE = 10;
    const PAGES = 5;

    const allRaw = [];
    for (let page = 0; page < PAGES; page++) {
      const items = await fetchPage(apiUrl, page * PAGE_SIZE);
      allRaw.push(...items);
      if (items.length < PAGE_SIZE) break;
    }

    const jobs = allRaw
      .map((raw) => parseMercedesBenzJob(raw))
      .filter(Boolean);

    log(`Mercedes-Benz API returned ${allRaw.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Mercedes-Benz API error: ${error.message}`);
    return [];
  }
}
