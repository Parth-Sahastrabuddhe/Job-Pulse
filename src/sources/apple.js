import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function inferCountry(locations) {
  if (!Array.isArray(locations)) return "";
  for (const loc of locations) {
    if (loc.countryID === "iso-country-USA" || /United States/i.test(loc.countryName || "")) {
      return "US";
    }
  }
  return "";
}

function parseAppleJob(raw) {
  const title = raw.postingTitle?.trim();
  if (!title || !isTargetRole(title)) return null;

  const id = String(raw.id || raw.positionId || "");
  const locations = raw.locations || [];
  const locationNames = locations.map((l) => l.name).filter(Boolean);
  const location = locationNames.join(" | ");
  const countryCode = inferCountry(locations);

  const slug = raw.transformedPostingTitle || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = `https://jobs.apple.com/en-us/details/${id}/${slug}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.postDateInGMT) {
    postedAt = raw.postDateInGMT;
    postedPrecision = "exact";
  }

  return finalizeJob({
    sourceKey: "apple",
    sourceLabel: "Apple",
    id,
    title,
    location,
    postedText: raw.postingDate || "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

// Search terms covering all supported role categories
const APPLE_SEARCH_TERMS = [
  "software+engineer",
  "data+analyst",
  "data+scientist",
  "machine+learning",
  "data+engineer",
  "product+manager",
];

async function fetchAppleSearchResults(term, log) {
  const searchUrl = `https://jobs.apple.com/en-us/search?search=${term}&sort=newest&location=united-states-USA`;
  try {
    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Apple [${term}]: returned status ${response.status}`);
      return [];
    }

    const html = await response.text();

    const match = html.match(/__staticRouterHydrationData\s*=\s*JSON\.parse\("(.+?)"\);/);
    if (!match) {
      log(`Apple [${term}]: could not find hydration data`);
      return [];
    }

    let data;
    try {
      const raw = match[1].replace(/\\\\"/g, '\\"').replace(/\\"/g, '"');
      data = JSON.parse(raw);
    } catch {
      try {
        const raw = match[1]
          .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        data = JSON.parse(raw);
      } catch (e2) {
        log(`Apple [${term}]: failed to parse hydration data: ${e2.message}`);
        return [];
      }
    }

    const searchData = data?.loaderData?.search;
    if (!searchData?.searchResults) return [];

    return searchData.searchResults;
  } catch (err) {
    log(`Apple [${term}]: fetch error: ${err.message}`);
    return [];
  }
}

export async function collectAppleJobs(_unused, config, log) {
  try {
    const allRaw = [];
    for (const term of APPLE_SEARCH_TERMS) {
      const results = await fetchAppleSearchResults(term, log);
      allRaw.push(...results);
      // Small delay to avoid hammering Apple's servers
      await new Promise((r) => setTimeout(r, 300));
    }

    const jobs = allRaw
      .map((raw) => parseAppleJob(raw))
      .filter(Boolean);

    const deduped = dedupeJobs(jobs);
    log(`Apple returned ${allRaw.length} raw results across ${APPLE_SEARCH_TERMS.length} queries, ${deduped.length} unique matched.`);
    return deduped.slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Apple API error: ${error.message}`);
    return [];
  }
}
