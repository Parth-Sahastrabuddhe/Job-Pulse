import { chromium } from "playwright";
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

function inferCountry(locations) {
  if (!Array.isArray(locations)) return "";
  for (const loc of locations) {
    if (/United States|USA/i.test(loc.country || loc)) return "US";
  }
  return "";
}

function parseUberJob(raw) {
  const title = raw.title?.trim();
  if (!title || !isEntryMidLevelSwe(title)) return null;

  const id = String(raw.id || "");
  const allLocations = raw.allLocations || [];
  const location = allLocations
    .filter((l) => /United States|USA/i.test(l.country || ""))
    .map((l) => [l.city, l.state].filter(Boolean).join(", "))
    .join(" | ");
  const countryCode = inferCountry(allLocations);

  const url = `https://www.uber.com/us/en/careers/list/${id}/`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.creationDate) {
    postedAt = new Date(raw.creationDate).toISOString();
    postedPrecision = "exact";
  }

  return finalizeJob({
    sourceKey: "uber",
    sourceLabel: "Uber",
    id,
    title,
    location,
    postedText: raw.creationDate ? new Date(raw.creationDate).toLocaleString() : "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectUberJobs(_unused, config, log) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    let jobsData = null;
    page.on("response", async (response) => {
      if (response.url().includes("loadSearchJobsResults")) {
        try {
          jobsData = await response.json();
        } catch {}
      }
    });

    await page.goto("https://www.uber.com/us/en/careers/list/", {
      waitUntil: "networkidle",
      timeout: 30000
    });
    await page.waitForTimeout(3000);

    if (!jobsData?.data?.results) {
      log("Uber: no job data captured from API");
      return [];
    }

    const rawJobs = jobsData.data.results;
    const jobs = rawJobs
      .map((raw) => parseUberJob(raw))
      .filter(Boolean);

    const total = jobsData.data.totalResults?.low || rawJobs.length;
    log(`Uber returned ${rawJobs.length} results (${total} total), ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Uber scraper error: ${error.message}`);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}
