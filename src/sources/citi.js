import { dedupeJobs, finalizeJob } from "./shared.js";

function isEntryMidLevelSwe(title) {
  const t = title.trim();
  if (!/software\s+(engineer|develop)/i.test(t)) {
    return false;
  }
  // Standard filter + banking titles (VP/SVP are senior at banks)
  if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished|vice\s+president|VP|SVP|AVP|managing\s+director|MD)\b/i.test(t)) {
    return false;
  }
  return true;
}

function inferCountry(location) {
  if (!location) return "";
  const US_STATE_NAMES = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;
  if (US_STATE_NAMES.test(location)) return "US";
  if (/United States/i.test(location)) return "US";
  return "";
}

function parseCitiJobs(html) {
  const jobs = [];
  const seen = new Set();

  // Find job links: <a class="sr-job-item__link" href="/job/..." data-job-id="...">Title</a>
  const pattern = /<a[^>]*sr-job-item__link[^>]*href="([^"]+)"[^>]*data-job-id="(\d+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [, href, id, title] = match;
    if (seen.has(id)) continue;
    seen.add(id);

    if (!isEntryMidLevelSwe(title)) continue;

    // Find location near this job ID
    const locPattern = new RegExp(`job-${id}"[\\s\\S]{0,500}?sr-job-item__location[^>]*>([^<]+)`, 'i');
    const locMatch = html.match(locPattern);
    const location = locMatch ? locMatch[1].trim() : "";

    const url = `https://jobs.citi.com${href}`;

    jobs.push(finalizeJob({
      sourceKey: "citi",
      sourceLabel: "Citi",
      id,
      title: title.trim(),
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

export async function collectCitiJobs(_unused, config, log) {
  // fl=6252001 is GeoNames ID for United States, org 287 is Citi
  const searchUrl = "https://jobs.citi.com/search-jobs/software%20engineer/287/1?fl=6252001";

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "accept": "text/html",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!response.ok) {
      log(`Citi returned status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const jobs = parseCitiJobs(html);

    const totalIds = new Set((html.match(/data-job-id="(\d+)"/g) || []).map((m) => m.match(/(\d+)/)?.[1]));
    log(`Citi returned ${totalIds.size} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Citi API error: ${error.message}`);
    return [];
  }
}
