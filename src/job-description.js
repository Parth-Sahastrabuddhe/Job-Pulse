import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./config.js";
import {
  GREENHOUSE_BOARDS, ASHBY_BOARDS, SMARTRECRUITERS_SLUGS,
  WORKDAY_KEYS, ASHBY_KEYS, LEVER_KEYS, SMARTRECRUITERS_KEYS
} from "./companies.js";

const JOBS_DIR = path.join(PROJECT_ROOT, "data", "jobs");

function stripHtml(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function jobDirId(job) {
  return `${job.sourceKey}-${job.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function getJobDir(job) {
  return path.join(JOBS_DIR, jobDirId(job));
}

async function fetchMicrosoftDescription(job) {
  const url = `https://apply.careers.microsoft.com/api/pcsx/position_details?position_id=${job.id}&domain=microsoft.com`;
  const resp = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "referer": `https://apply.careers.microsoft.com/careers/job/${job.id}`,
      "origin": "https://apply.careers.microsoft.com"
    }
  });
  if (!resp.ok) return null;

  const data = await resp.json();
  const pos = data?.data;
  if (!pos) return null;

  const parts = [];
  if (pos.name) parts.push(`Title: ${pos.name}`);
  if (pos.department) parts.push(`Department: ${pos.department}`);
  if (Array.isArray(pos.locations)) parts.push(`Locations: ${pos.locations.join(", ")}`);
  // Main job description field
  if (pos.jobDescription) parts.push(`\nDescription:\n${stripHtml(pos.jobDescription)}`);
  // Fallback field names
  if (pos.description) parts.push(`\nDescription:\n${stripHtml(pos.description)}`);
  if (pos.responsibilities) parts.push(`\nResponsibilities:\n${stripHtml(pos.responsibilities)}`);
  if (pos.qualifications) parts.push(`\nQualifications:\n${stripHtml(pos.qualifications)}`);
  if (pos.preferredQualifications) parts.push(`\nPreferred Qualifications:\n${stripHtml(pos.preferredQualifications)}`);

  return parts.join("\n");
}

async function fetchAmazonDescription(job, rawJobData) {
  // Amazon search API already returns description fields
  if (rawJobData) {
    const parts = [];
    if (rawJobData.title) parts.push(`Title: ${rawJobData.title}`);
    if (rawJobData.team) parts.push(`Team: ${rawJobData.team}`);
    if (rawJobData.normalized_location) parts.push(`Location: ${rawJobData.normalized_location}`);
    if (rawJobData.description) parts.push(`\nDescription:\n${stripHtml(rawJobData.description)}`);
    if (rawJobData.basic_qualifications) parts.push(`\nBasic Qualifications:\n${stripHtml(rawJobData.basic_qualifications)}`);
    if (rawJobData.preferred_qualifications) parts.push(`\nPreferred Qualifications:\n${stripHtml(rawJobData.preferred_qualifications)}`);
    return parts.join("\n");
  }

  // Fallback: fetch via Amazon search.json API by job ID
  try {
    const apiResp = await fetch(`https://www.amazon.jobs/en/search.json?job_ids=${job.id}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }
    });
    if (apiResp.ok) {
      const apiData = await apiResp.json();
      const apiJob = apiData.jobs?.find((j) => String(j.id_icims ?? j.id) === String(job.id));
      if (apiJob?.description) {
        const parts = [];
        if (apiJob.title) parts.push(`Title: ${apiJob.title}`);
        if (apiJob.team) parts.push(`Team: ${apiJob.team}`);
        if (apiJob.normalized_location) parts.push(`Location: ${apiJob.normalized_location}`);
        parts.push(`\nDescription:\n${stripHtml(apiJob.description)}`);
        if (apiJob.basic_qualifications) parts.push(`\nBasic Qualifications:\n${stripHtml(apiJob.basic_qualifications)}`);
        if (apiJob.preferred_qualifications) parts.push(`\nPreferred Qualifications:\n${stripHtml(apiJob.preferred_qualifications)}`);
        return parts.join("\n");
      }
    }
  } catch {}

  return null;
}

async function fetchGoogleDescription(job, rawJobData) {
  // Google batchexecute response includes description in fields 3, 4, 10
  if (rawJobData && Array.isArray(rawJobData)) {
    const parts = [];
    if (rawJobData[1]) parts.push(`Title: ${rawJobData[1]}`);

    // Locations
    if (Array.isArray(rawJobData[9])) {
      const locs = rawJobData[9].map((l) => (Array.isArray(l) ? l[0] : "")).filter(Boolean);
      if (locs.length) parts.push(`Locations: ${locs.join(", ")}`);
    }

    // Description (field 10)
    if (rawJobData[10]) {
      const desc = Array.isArray(rawJobData[10]) ? rawJobData[10][1] : rawJobData[10];
      if (desc) parts.push(`\nDescription:\n${stripHtml(desc)}`);
    }

    // Responsibilities (field 3)
    if (rawJobData[3]) {
      const resp = Array.isArray(rawJobData[3]) ? rawJobData[3][1] : rawJobData[3];
      if (resp) parts.push(`\nResponsibilities:\n${stripHtml(resp)}`);
    }

    // Qualifications (field 4)
    if (rawJobData[4]) {
      const qual = Array.isArray(rawJobData[4]) ? rawJobData[4][1] : rawJobData[4];
      if (qual) parts.push(`\nQualifications:\n${stripHtml(qual)}`);
    }

    return parts.join("\n");
  }

  // Fallback: search via batchexecute API and find the job by ID
  try {
    const innerPayload = JSON.stringify([["Software Engineer", null, null, null, "en-US", null, null, 2, null, null, 0]]);
    const outerPayload = JSON.stringify([[["r06xKb", innerPayload, null, "3"]]]);
    const body = "f.req=" + encodeURIComponent(outerPayload);

    const resp = await fetch(
      "https://www.google.com/about/careers/applications/_/HiringCportalFrontendUi/data/batchexecute?rpcids=r06xKb&source-path=/about/careers/applications/jobs/results&hl=en-US&soc-app=1&soc-platform=1&soc-device=1&_reqid=1000&rt=c",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": "Mozilla/5.0" },
        body
      }
    );

    if (resp.ok) {
      const text = await resp.text();
      const lines = text.replace(/^\)\]\}'\n?/, "").split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (!Array.isArray(parsed)) continue;
          for (const entry of parsed) {
            if (Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === "r06xKb" && typeof entry[2] === "string") {
              const data = JSON.parse(entry[2]);
              const jobs = data[0] || [];
              const target = jobs.find((j) => String(j[0]) === String(job.id));
              if (target) {
                const parts = [];
                if (target[1]) parts.push(`Title: ${target[1]}`);
                if (target[10]?.[1]) parts.push(`\nAbout:\n${stripHtml(target[10][1])}`);
                if (target[3]?.[1]) parts.push(`\nResponsibilities:\n${stripHtml(target[3][1])}`);
                if (target[4]?.[1]) parts.push(`\nQualifications:\n${stripHtml(target[4][1])}`);
                if (parts.length > 1) return parts.join("\n");
              }
            }
          }
        } catch {}
      }
    }
  } catch {}

  return null;
}

async function fetchMetaDescription(job) {
  const resp = await fetch(`https://www.metacareers.com/jobs/${job.id}`, {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!resp.ok) return null;

  const html = await resp.text();
  const ldMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!ldMatch) return null;

  try {
    const ld = JSON.parse(ldMatch[1]);
    const parts = [];
    if (ld.title) parts.push(`Title: ${ld.title}`);
    if (ld.hiringOrganization?.name) parts.push(`Company: ${ld.hiringOrganization.name}`);
    if (ld.description) parts.push(`\nDescription:\n${stripHtml(ld.description)}`);
    if (ld.responsibilities) parts.push(`\nResponsibilities:\n${stripHtml(ld.responsibilities)}`);
    if (ld.qualifications) parts.push(`\nQualifications:\n${stripHtml(ld.qualifications)}`);
    return parts.join("\n");
  } catch {
    return null;
  }
}

// Greenhouse companies — fetch full job detail from their API
// GREENHOUSE_BOARDS — imported from companies.js

async function fetchGreenhouseDescription(job) {
  const board = GREENHOUSE_BOARDS[job.sourceKey];
  if (!board) return null;

  try {
    const resp = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${job.id}`, {
      headers: { accept: "application/json" }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const parts = [];
    if (data.title) parts.push(`Title: ${data.title}`);
    if (data.location?.name) parts.push(`Location: ${data.location.name}`);
    if (data.content) parts.push(`\nDescription:\n${stripHtml(data.content)}`);
    return parts.length > 1 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

// Lever companies — fetch full job detail
async function fetchLeverDescription(job) {
  try {
    // Lever hosted URLs contain the company slug: jobs.lever.co/{company}/{id}
    const leverMatch = job.url?.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/i);
    const company = leverMatch?.[1] || job.sourceKey;

    const resp = await fetch(`https://api.lever.co/v0/postings/${company}/${job.id}?mode=json`, {
      headers: { accept: "application/json" }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const parts = [];
    if (data.text) parts.push(`Title: ${data.text}`);
    if (data.categories?.location) parts.push(`Location: ${data.categories.location}`);
    if (data.descriptionPlain) parts.push(`\nDescription:\n${data.descriptionPlain}`);
    else if (data.description) parts.push(`\nDescription:\n${stripHtml(data.description)}`);
    if (data.additionalPlain) parts.push(`\nAdditional:\n${data.additionalPlain}`);
    return parts.length > 1 ? parts.join("\n") : null;
  } catch {
    return null;
  }
}

// SMARTRECRUITERS_SLUGS — imported from companies.js

async function fetchConfluentDescription(job) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`https://careers.confluent.io/jobs/job/${job.id}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(3000);
      const desc = await page.evaluate(() => {
        const el = document.querySelector("[class*=description], [class*=detail], article, main");
        return el?.textContent?.trim() || "";
      });
      return desc.length > 50 ? desc : null;
    } finally { await browser.close(); }
  } catch { return null; }
}

async function fetchOracleDescription(job) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`https://careers.oracle.com/jobs/#en/sites/jobsearch/job/${job.id}`, { timeout: 60000 });
      try { await page.waitForSelector(".job-details__body", { timeout: 15000 }); } catch {}
      await page.waitForTimeout(5000);
      const desc = await page.evaluate(() => {
        const el = document.querySelector(".job-details__body");
        if (el && el.textContent.trim().length > 50) return el.textContent.trim();
        const blocks = Array.from(document.querySelectorAll("div, section"))
          .filter((e) => { const t = e.textContent.trim(); return t.length > 200 && t.length < 10000 && !t.includes(".component-styling"); })
          .sort((a, b) => b.textContent.length - a.textContent.length);
        return blocks[0]?.textContent?.trim() || "";
      });
      return desc.length > 50 ? desc : null;
    } finally { await browser.close(); }
  } catch { return null; }
}

async function fetchOracleHCMDescription(job) {
  // JPMorgan and Ford use Oracle HCM - same Playwright approach
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(job.url, { timeout: 60000 });
      try { await page.waitForSelector(".job-details__description-content, .job-details__body, [class*=requisition]", { timeout: 15000 }); } catch {}
      await page.waitForTimeout(5000);
      const desc = await page.evaluate(() => {
        for (const sel of [".job-details__description-content", ".job-details__body", "[class*=requisition-description]", "[class*=job-detail]"]) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 50) return el.textContent.trim();
        }
        const blocks = Array.from(document.querySelectorAll("div, section"))
          .filter((e) => { const t = e.textContent.trim(); return t.length > 200 && t.length < 10000; })
          .sort((a, b) => b.textContent.length - a.textContent.length);
        return blocks[0]?.textContent?.trim() || "";
      });
      return desc.length > 50 ? desc : null;
    } finally { await browser.close(); }
  } catch { return null; }
}

async function fetchUberDescription(job) {
  // Uber's detail page doesn't work. Fetch via the search API which includes descriptions.
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let jobsData = null;
      page.on("response", async (resp) => {
        if (resp.url().includes("loadSearchJobsResults")) {
          try { jobsData = await resp.json(); } catch {}
        }
      });
      await page.goto("https://www.uber.com/us/en/careers/list/", { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(3000);

      const match = jobsData?.data?.results?.find((j) => String(j.id) === String(job.id));
      if (match?.description) {
        return `Title: ${match.title}\n\n${match.description}`;
      }
      return null;
    } finally { await browser.close(); }
  } catch { return null; }
}

async function fetchGoldmanSachsDescription(job) {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(3000);

      const description = await page.evaluate(() => {
        const el = document.querySelector(".job-description, [class*=job-description]");
        return el?.textContent?.trim() || "";
      });

      return description.length > 50 ? description : null;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

async function fetchSmartRecruitersDescription(job) {
  try {
    const companySlug = SMARTRECRUITERS_SLUGS[job.sourceKey];
    if (!companySlug) return null;

    const response = await fetch(`https://api.smartrecruiters.com/v1/companies/${companySlug}/postings/${job.id}`, {
      headers: { "accept": "application/json" }
    });
    if (!response.ok) return null;

    const data = await response.json();
    const sections = data.jobAd?.sections || {};

    const parts = [
      data.name && `Title: ${data.name}`,
      data.location?.city && `Location: ${[data.location.city, data.location.region, data.location.country].filter(Boolean).join(", ")}`,
      sections.jobDescription?.text && `Job Description:\n${stripHtml(sections.jobDescription.text)}`,
      sections.qualifications?.text && `Qualifications:\n${stripHtml(sections.qualifications.text)}`,
      sections.additionalInformation?.text && `Additional Information:\n${stripHtml(sections.additionalInformation.text)}`
    ].filter(Boolean);

    return parts.join("\n\n") || null;
  } catch {
    return null;
  }
}

async function fetchAppleDescription(job) {
  try {
    const response = await fetch(job.url, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    if (!response.ok) return null;

    const html = await response.text();
    const match = html.match(/__staticRouterHydrationData\s*=\s*JSON\.parse\("(.+?)"\);/);
    if (!match) return null;

    const raw = match[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');

    const data = JSON.parse(raw);
    const jd = data?.loaderData?.jobDetails?.jobsData;
    if (!jd) return null;

    const parts = [
      jd.postingTitle && `Title: ${jd.postingTitle}`,
      jd.jobSummary && `Summary:\n${jd.jobSummary}`,
      jd.description && `Description:\n${jd.description}`,
      jd.minimumQualifications && `Minimum Qualifications:\n${jd.minimumQualifications}`,
      jd.preferredQualifications && `Preferred Qualifications:\n${jd.preferredQualifications}`
    ].filter(Boolean);

    return parts.join("\n\n") || null;
  } catch {
    return null;
  }
}

async function fetchDescriptionFallback(job) {
  const url = job.url;
  if (!url || !url.startsWith("http")) return null;

  try {
    const resp = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
      redirect: "follow"
    });
    if (!resp.ok) return null;

    const html = await resp.text();

    // Strategy 1: Schema.org ld+json (most reliable)
    const ldMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [, ldText] of ldMatches) {
      try {
        const ld = JSON.parse(ldText);
        // Could be an array or single object
        const posting = Array.isArray(ld)
          ? ld.find((item) => item["@type"] === "JobPosting")
          : ld["@type"] === "JobPosting" ? ld : null;

        if (posting) {
          const parts = [];
          if (posting.title) parts.push(`Title: ${posting.title}`);
          if (posting.hiringOrganization?.name) parts.push(`Company: ${posting.hiringOrganization.name}`);
          if (posting.jobLocation) {
            const locs = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
            const locTexts = locs.map((l) => l.address?.addressLocality || l.name || "").filter(Boolean);
            if (locTexts.length) parts.push(`Location: ${locTexts.join(", ")}`);
          }
          if (posting.description) parts.push(`\nDescription:\n${stripHtml(posting.description)}`);
          if (posting.responsibilities) parts.push(`\nResponsibilities:\n${stripHtml(posting.responsibilities)}`);
          if (posting.qualifications) parts.push(`\nQualifications:\n${stripHtml(posting.qualifications)}`);
          if (posting.skills) parts.push(`\nSkills:\n${stripHtml(posting.skills)}`);
          if (parts.length > 1) return parts.join("\n");
        }
      } catch {}
    }

    // Strategy 2: Extract from meta tags
    const metaParts = [];
    const titleMeta = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"[^>]*>/i);
    if (titleMeta) metaParts.push(`Title: ${titleMeta[1]}`);
    const descMeta = html.match(/<meta[^>]*(?:name="description"|property="og:description")[^>]*content="([^"]*)"[^>]*>/i);
    if (descMeta && descMeta[1].length > 50) metaParts.push(`\nDescription:\n${descMeta[1]}`);

    // Strategy 3: Extract main content text from common job description containers
    const contentSelectors = [
      /<article[^>]*>([\s\S]*?)<\/article>/i,
      /<div[^>]*class="[^"]*(?:job-description|job-details|posting-details|content-body|job-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /<main[^>]*>([\s\S]*?)<\/main>/i
    ];

    for (const selector of contentSelectors) {
      const match = html.match(selector);
      if (match && match[1].length > 200) {
        const text = stripHtml(match[1]);
        if (text.length > 100) {
          metaParts.push(`\nDescription:\n${text.slice(0, 5000)}`);
          break;
        }
      }
    }

    if (metaParts.length > 0) return metaParts.join("\n");
  } catch {}

  return null;
}

// WORKDAY_SOURCES — derived from companies.js
const WORKDAY_SOURCES = WORKDAY_KEYS;

function workdayApiUrl(jobUrl) {
  // Convert public URL to API URL by inserting /wday/cxs/{company}/ after the domain
  // e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/...
  //   -> https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/...
  const match = jobUrl.match(/^(https:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com)\/(.+)$/);
  if (!match) return jobUrl;
  const [, base, company, rest] = match;
  return `${base}/wday/cxs/${company}/${rest}`;
}

async function fetchWorkdayDescription(job) {
  if (!job.url) return null;

  // Workday exposes a JSON API at the /wday/cxs/ prefixed URL
  try {
    const apiUrl = workdayApiUrl(job.url);
    const resp = await fetch(apiUrl, {
      headers: { accept: "application/json", "content-type": "application/json" }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const info = data.jobPostingInfo;
    if (!info) return null;

    const parts = [];
    if (info.title) parts.push(`Title: ${info.title}`);
    if (info.location) parts.push(`Location: ${info.location}`);
    if (info.jobDescription) parts.push(`\nDescription:\n${stripHtml(info.jobDescription)}`);
    return parts.length > 1 ? parts.join("\n") : null;
  } catch {}

  return null;
}

// ASHBY_SOURCES — derived from companies.js
const ASHBY_SOURCES = ASHBY_KEYS;

// ASHBY_BOARDS — imported from companies.js

async function fetchAshbyDescription(job) {
  if (!job.id) return null;

  const board = ASHBY_BOARDS[job.sourceKey];
  if (!board) return null;

  // Use Ashby GraphQL API for full description
  try {
    const resp = await fetch("https://jobs.ashbyhq.com/api/non-user-graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
      body: JSON.stringify({
        operationName: "ApiJobPosting",
        variables: { organizationHostedJobsPageName: board, jobPostingId: job.id },
        query: `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
          jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
            title descriptionHtml locationName departmentName
          }
        }`
      })
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const posting = data?.data?.jobPosting;
    if (!posting) return null;

    const parts = [
      posting.title && `Title: ${posting.title}`,
      posting.locationName && `Location: ${posting.locationName}`,
      posting.departmentName && `Department: ${posting.departmentName}`,
      posting.descriptionHtml && `\nDescription:\n${stripHtml(posting.descriptionHtml)}`
    ].filter(Boolean);
    return parts.length > 1 ? parts.join("\n") : null;
  } catch {}

  return null;
}

export async function fetchJobDescription(job, rawJobData) {
  // Try company-specific fetcher first
  let description = null;

  switch (job.sourceKey) {
    case "microsoft":
      description = await fetchMicrosoftDescription(job);
      break;
    case "amazon":
      description = await fetchAmazonDescription(job, rawJobData);
      break;
    case "google":
      description = await fetchGoogleDescription(job, rawJobData);
      break;
    case "meta":
      description = await fetchMetaDescription(job);
      break;
  }

  // Greenhouse API fallback
  if (!description && job.sourceKey in GREENHOUSE_BOARDS) {
    description = await fetchGreenhouseDescription(job);
  }

  // Lever API fallback
  if (!description && (job.url?.includes("lever.co") || LEVER_KEYS.includes(job.sourceKey))) {
    description = await fetchLeverDescription(job);
  }

  // Ashby API fallback
  if (!description && ASHBY_SOURCES.includes(job.sourceKey)) {
    description = await fetchAshbyDescription(job);
  }

  // Workday HTML fallback
  if (!description && WORKDAY_SOURCES.includes(job.sourceKey)) {
    description = await fetchWorkdayDescription(job);
  }

  // Oracle (HCM SPA, needs Playwright to render)
  if (!description && job.sourceKey === "oracle") {
    description = await fetchOracleDescription(job);
  }

  // Uber (description available from search API, but detail page doesn't exist)
  if (!description && job.sourceKey === "uber") {
    description = await fetchUberDescription(job);
  }

  // JPMorgan / Ford (Oracle HCM - same approach)
  if (!description && (job.sourceKey === "jpmorgan" || job.sourceKey === "ford")) {
    description = await fetchOracleHCMDescription(job);
  }

  // Confluent (Vercel bot protection, needs Playwright)
  if (!description && job.sourceKey === "confluent") {
    description = await fetchConfluentDescription(job);
  }

  // Goldman Sachs (Contentful CMS, needs Playwright to render)
  if (!description && job.sourceKey === "goldmansachs") {
    description = await fetchGoldmanSachsDescription(job);
  }

  // SmartRecruiters (Visa, ServiceNow, Arista Networks)
  if (!description && SMARTRECRUITERS_KEYS.includes(job.sourceKey)) {
    description = await fetchSmartRecruitersDescription(job);
  }

  // Apple SSR hydration data
  if (!description && job.sourceKey === "apple") {
    description = await fetchAppleDescription(job);
  }

  // Universal HTML fallback for any company
  if (!description) {
    description = await fetchDescriptionFallback(job);
  }

  return description;
}

export async function saveJobData(job, description) {
  const dir = getJobDir(job);
  await fs.mkdir(dir, { recursive: true });

  const meta = {
    id: job.id,
    sourceKey: job.sourceKey,
    sourceLabel: job.sourceLabel,
    title: job.title,
    location: job.location,
    url: job.url,
    postedAt: job.postedAt,
    fetchedAt: new Date().toISOString()
  };

  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

  if (description) {
    await fs.writeFile(path.join(dir, "description.txt"), description, "utf8");
  }

  return dir;
}

export async function loadJobData(jobDirIdStr) {
  const dir = path.join(JOBS_DIR, jobDirIdStr);
  const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8"));
  let description = "";
  try {
    description = await fs.readFile(path.join(dir, "description.txt"), "utf8");
  } catch {}
  return { meta, description, dir };
}
