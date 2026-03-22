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
  const US_STATES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATES.test(location)) return "US";
  return "";
}

function parseIntuitJobs(html) {
  const jobs = [];
  const cards = html.split(/data-job-id="/).slice(1);

  for (const card of cards) {
    const idMatch = card.match(/^(\d+)"/);
    if (!idMatch) continue;

    // Skip duplicates — TalentBrew has two job IDs per card (internal + external)
    // The one in the <a> tag is the internal ID, use it
    const hrefMatch = card.match(/href="([^"]+)"/);
    if (!hrefMatch) continue;

    const href = hrefMatch[1];
    // Only process the first occurrence per href (the <a> tag, not the save button)
    if (!card.includes('<h2>')) continue;

    const titleMatch = card.match(/<h2>([^<]+)<\/h2>/);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title || !isEntryMidLevelSwe(title)) continue;

    const locationMatch = card.match(/job-location[^>]*>([^<]+)/);
    const location = locationMatch ? locationMatch[1].trim() : "";

    // Extract job ID from URL path
    const urlIdMatch = href.match(/\/(\d+)$/);
    const id = urlIdMatch ? urlIdMatch[1] : idMatch[1];

    const url = `https://jobs.intuit.com${href}`;

    jobs.push(finalizeJob({
      sourceKey: "intuit",
      sourceLabel: "Intuit",
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

  return jobs;
}

export async function collectIntuitJobs(_unused, config, log) {
  // fl=6252001 is the GeoNames ID for United States
  const searchUrl = "https://jobs.intuit.com/search-jobs/software%20engineer/27595/1?fl=6252001";

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Intuit returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const jobs = parseIntuitJobs(html);

    const totalCards = (html.match(/data-job-id="/g) || []).length;
    log(`Intuit returned ${totalCards} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Intuit API error: ${error.message}`);
    return [];
  }
}
