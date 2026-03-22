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
  if (/United States of America|United States/i.test(location)) return "US";
  const US_STATES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATES.test(location)) return "US";
  return "";
}

function parseBloombergJobs(html) {
  const jobs = [];
  // Split by JobDetail links
  const sections = html.split(/href="https:\/\/bloomberg\.avature\.net\/careers\/JobDetail\//);

  for (const section of sections.slice(1)) {
    // Extract slug/id from the URL
    const urlMatch = section.match(/^([^/]+)\/(\d+)"/);
    if (!urlMatch) continue;

    const slug = urlMatch[1];
    const id = urlMatch[2];

    // Extract title — it's the text content of the <a> tag
    const titleMatch = section.match(/>\s*([^<]+?)\s*<\/a>/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title || title === "Apply" || title === "Save" || !isEntryMidLevelSwe(title)) continue;

    // Extract location from list-item-location span
    const locationMatch = section.match(/list-item-location[^>]*>([^<]+)/);
    const location = locationMatch ? locationMatch[1].trim() : "";

    const url = `https://bloomberg.avature.net/careers/JobDetail/${slug}/${id}`;

    jobs.push(finalizeJob({
      sourceKey: "bloomberg",
      sourceLabel: "Bloomberg",
      id,
      title,
      location,
      postedText: "",
      postedAt: "",
      postedPrecision: "",
      url,
      countryCode: inferCountry(location)
    }));
  }

  // Dedupe by ID (page has duplicate links per card)
  const seen = new Set();
  return jobs.filter((j) => {
    if (seen.has(j.id)) return false;
    seen.add(j.id);
    return true;
  });
}

export async function collectBloombergJobs(_unused, config, log) {
  const searchUrl = "https://bloomberg.avature.net/careers/SearchJobs?search=software+engineer";

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Bloomberg returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const jobs = parseBloombergJobs(html);

    // Count unique job IDs in the page for logging
    const allIds = new Set((html.match(/JobDetail\/[^/]+\/(\d+)/g) || []).map((m) => m.match(/(\d+)$/)?.[1]));
    log(`Bloomberg returned ${allIds.size} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Bloomberg API error: ${error.message}`);
    return [];
  }
}
