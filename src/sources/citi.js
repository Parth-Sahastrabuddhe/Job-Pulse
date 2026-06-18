import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

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

    if (!isTargetRole(title)) continue;

    // Find location near this job ID. The live markup uses class `sr-job-location`
    // (not `sr-job-item__location`); the wrong class silently blanked every Citi
    // location, which then country-inferred to "" and passed the no-location grace
    // rule — leaking Citi Canada jobs past a US-only filter and hiding the location.
    const locPattern = new RegExp(`job-${id}"[\\s\\S]{0,500}?sr-job-location[^>]*>([^<]+)`, 'i');
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
      countryCode: ""
    }));
  }

  return jobs;
}

export async function collectCitiJobs(_unused, config, log) {
  // fl=6252001 = United States, fl=6251999 = Canada (GeoNames country ids); org 287 = Citi
  const urls = [
    "https://jobs.citi.com/search-jobs/software%20engineer/287/1?fl=6252001",
    "https://jobs.citi.com/search-jobs/software%20engineer/287/1?fl=6251999",
  ];

  try {
    const htmls = await Promise.all(urls.map((u) =>
      fetchWithTimeout(u, {
        headers: { "accept": "text/html", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      }).then((r) => (r.ok ? r.text() : "")).catch(() => "")
    ));

    const jobs = htmls.flatMap((html) => parseCitiJobs(html));
    const totalIds = new Set(htmls.flatMap((html) => (html.match(/data-job-id="(\d+)"/g) || []).map((m) => m.match(/(\d+)/)?.[1])));
    log(`Citi returned ${totalIds.size} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Citi API error: ${error.message}`);
    return [];
  }
}
