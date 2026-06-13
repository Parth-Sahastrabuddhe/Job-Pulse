import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

function parseLinkedInCards(html) {
  const jobs = [];
  const cards = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1);

  for (const card of cards) {
    const idMatch = card.match(/^(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    const titleMatch = card.match(/base-search-card__title[^>]*>\s*(.+?)\s*</);
    const title = titleMatch ? titleMatch[1].trim() : "";
    if (!title || !isTargetRole(title)) continue;

    const locationMatch = card.match(/job-search-card__location[^>]*>\s*(.+?)\s*</);
    const location = locationMatch ? locationMatch[1].trim() : "";

    const dateMatch = card.match(/<time[^>]*datetime="([^"]+)"/);
    const postedDate = dateMatch ? dateMatch[1] : "";

    let postedAt = "";
    let postedPrecision = "";
    if (postedDate) {
      postedAt = new Date(postedDate).toISOString();
      // Guest cards expose a date-only datetime (e.g. "2026-06-03"), which parses to
      // UTC midnight. Marking it "exact" makes the 180-min freshness gate treat the
      // job as stale for ~21h/day, so treat date-only values as "date" precision.
      postedPrecision = /^\d{4}-\d{2}-\d{2}$/.test(postedDate) ? "date" : "exact";
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
      countryCode: ""
    }));
  }

  return jobs;
}

export async function collectLinkedInJobs(_unused, config, log) {
  // f_C=1337 is LinkedIn's own company ID. Fetch US and Canada, tag by inference.
  const base = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software+engineer&f_C=1337&sortBy=DD&start=0";
  const urls = [`${base}&location=United+States`, `${base}&location=Canada`];

  try {
    const htmls = await Promise.all(urls.map((u) =>
      fetchWithTimeout(u, {
        headers: { "accept": "text/html", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      }).then((r) => (r.ok ? r.text() : "")).catch(() => "")
    ));

    const jobs = htmls.flatMap((html) => parseLinkedInCards(html));
    const totalCards = htmls.reduce((n, html) => n + (html.match(/data-entity-urn="urn:li:jobPosting:/g) || []).length, 0);
    log(`LinkedIn returned ${totalCards} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`LinkedIn API error: ${error.message}`);
    return [];
  }
}
