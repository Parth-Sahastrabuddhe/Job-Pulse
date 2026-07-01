import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

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
    if (!title || title === "Apply" || title === "Save" || !isTargetRole(title)) continue;

    // Extract location from list-item-location span
    const locationMatch = section.match(/list-item-location[^>]*>([^<]+)/);
    const location = locationMatch ? locationMatch[1].trim() : "";

    // Fail closed on a blank location: this search is GLOBAL (no country scope
    // in the URL), so a blank location would ride the country gate's
    // "no location = probably remote US" grace straight to users — the same
    // blanked-location class that leaked Citi Canada jobs. If Avature renames
    // the location markup this drops everything (visible in the log counts)
    // instead of leaking London/Tokyo/Pune postings.
    if (!location) continue;

    const url = `https://bloomberg.avature.net/careers/JobDetail/${slug}/${id}`;

    const job = finalizeJob({
      sourceKey: "bloomberg",
      sourceLabel: "Bloomberg",
      id,
      title,
      location,
      postedText: "",
      postedAt: "",
      postedPrecision: "",
      url,
      countryCode: ""
    });

    // Drop confirmed-foreign rows at the source so they can't crowd US/CA
    // jobs out of the per-source cap (the gate would reject them anyway).
    if (job.countryCode === "NON-US") continue;

    jobs.push(job);
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
    const response = await fetchWithTimeout(searchUrl, {
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
