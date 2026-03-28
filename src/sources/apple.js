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

export async function collectAppleJobs(_unused, config, log) {
  try {
    const searchUrl = "https://jobs.apple.com/en-us/search?search=software+engineer&sort=newest&location=united-states-USA";

    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Apple careers returned status ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Extract hydration data from SSR page
    const match = html.match(/__staticRouterHydrationData\s*=\s*JSON\.parse\("(.+?)"\);/);
    if (!match) {
      log("Apple: could not find hydration data in page");
      return [];
    }

    let data;
    try {
      // Decode the escaped JSON string
      const raw = match[1].replace(/\\"/g, '"').replace(/\\\\"/g, '\\"');
      data = JSON.parse(raw);
    } catch {
      // Fallback: try with unicode_escape-style decoding
      try {
        const raw = match[1]
          .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        data = JSON.parse(raw);
      } catch (e2) {
        log(`Apple: failed to parse hydration data: ${e2.message}`);
        return [];
      }
    }

    const searchData = data?.loaderData?.search;
    if (!searchData?.searchResults) {
      log("Apple: no searchResults in hydration data");
      return [];
    }

    const rawJobs = searchData.searchResults;
    const jobs = rawJobs
      .map((raw) => parseAppleJob(raw))
      .filter(Boolean);

    log(`Apple returned ${rawJobs.length} results (${searchData.totalRecords} total), ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Apple API error: ${error.message}`);
    return [];
  }
}
