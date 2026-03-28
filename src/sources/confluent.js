import { chromium } from "playwright";
import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

export async function collectConfluentJobs(_unused, config, log) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto("https://careers.confluent.io/jobs/engineering?engineering=engineering", {
      waitUntil: "networkidle",
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    // Extract job data from the rendered DOM
    const rawJobs = await page.evaluate(() => {
      const results = [];
      const links = document.querySelectorAll('a[href*="/jobs/job/"]');
      const seen = new Set();

      for (const link of links) {
        const href = link.href;
        const uuidMatch = href.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        if (!uuidMatch || seen.has(uuidMatch[1])) continue;
        seen.add(uuidMatch[1]);

        const title = link.textContent?.trim() || "";
        if (!title) continue;

        // Get location from the parent container's text
        const parent = link.closest("div") || link.parentElement;
        const fullText = parent?.textContent?.trim() || "";
        // Location follows the title in the text
        const afterTitle = fullText.substring(fullText.indexOf(title) + title.length).trim();
        // Clean up location text
        let location = afterTitle
          .replace(/Available in Multiple Locations/i, "")
          .replace(/Apply/gi, "")
          .trim();
        // Take first meaningful location string
        location = location.split(/\n/)[0]?.trim() || "";

        results.push({
          id: uuidMatch[1],
          title,
          location,
          href
        });
      }
      return results;
    });

    const jobs = rawJobs
      .filter((raw) => isTargetRole(raw.title))
      .map((raw) => {
        const countryCode = /United States|US Remote/i.test(raw.location) ? "US" : "";
        return finalizeJob({
          sourceKey: "confluent",
          sourceLabel: "Confluent",
          id: raw.id,
          title: raw.title,
          location: raw.location,
          postedText: "",
          postedAt: "",
          postedPrecision: "",
          url: `https://careers.confluent.io/jobs/job/${raw.id}`,
          countryCode
        });
      });

    log(`Confluent returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Confluent scraper error: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}
