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
  const US_STATES = /\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/;
  if (US_STATES.test(location)) return "US";
  if (/United States/i.test(location)) return "US";
  return "";
}

function parseLinkedInCards(html) {
  const jobs = [];
  const cards = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1);

  for (const card of cards) {
    const idMatch = card.match(/^(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    const titleMatch = card.match(/base-search-card__title[^>]*>\s*(.+?)\s*</);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title || !isEntryMidLevelSwe(title)) continue;

    const locationMatch = card.match(/job-search-card__location[^>]*>\s*(.+?)\s*</);
    const location = locationMatch ? locationMatch[1].trim() : "";

    const dateMatch = card.match(/<time[^>]*datetime="([^"]+)"/);
    const postedDate = dateMatch ? dateMatch[1] : "";

    let postedAt = "";
    let postedPrecision = "";
    if (postedDate) {
      postedAt = new Date(postedDate).toISOString();
      postedPrecision = "day";
    }

    const url = `https://www.linkedin.com/jobs/view/${id}`;

    jobs.push(finalizeJob({
      sourceKey: "linkedin",
      sourceLabel: "LinkedIn",
      id,
      title,
      location,
      postedText: postedDate,
      postedAt,
      postedPrecision,
      url,
      countryCode: inferCountry(location)
    }));
  }

  return jobs;
}

export async function collectLinkedInJobs(_unused, config, log) {
  // f_C=1337 is LinkedIn's own company ID
  const apiUrl = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search" +
    "?keywords=software+engineer&location=United+States&f_C=1337&sortBy=DD&start=0";

  try {
    const response = await fetch(apiUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`LinkedIn API returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const jobs = parseLinkedInCards(html);

    const totalCards = (html.match(/data-entity-urn="urn:li:jobPosting:/g) || []).length;
    log(`LinkedIn returned ${totalCards} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`LinkedIn API error: ${error.message}`);
    return [];
  }
}
