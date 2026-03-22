import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./config.js";

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
  const resp = await fetch(url, { headers: { accept: "application/json" } });
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
      const apiJob = apiData.jobs?.[0];
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
const GREENHOUSE_BOARDS = {
  stripe: "stripe", databricks: "databricks", figma: "figma", lyft: "lyft",
  discord: "discord", twilio: "twilio", cloudflare: "cloudflare", coinbase: "coinbase",
  roblox: "roblox", anthropic: "anthropic", airbnb: "airbnb", doordash: "doordashusa",
  reddit: "reddit", pinterest: "pinterest", datadog: "datadog", mongodb: "mongodb",
  robinhood: "robinhood", hubspot: "hubspot", instacart: "instacart", samsara: "samsara"
};

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

const WORKDAY_SOURCES = ["nvidia", "salesforce", "adobe", "cisco", "netflix", "snap"];

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

const ASHBY_SOURCES = ["openai", "notion", "ramp", "snowflake", "cursor", "airtable", "vanta"];

const ASHBY_BOARDS = {
  openai: "openai", notion: "notion", ramp: "ramp",
  snowflake: "snowflake", cursor: "cursor", airtable: "airtable", vanta: "vanta"
};

async function fetchAshbyDescription(job) {
  if (!job.id) return null;

  const board = ASHBY_BOARDS[job.sourceKey];
  if (!board) return null;

  try {
    const resp = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${board}`, {
      headers: { accept: "application/json" }
    });
    if (!resp.ok) return null;

    const data = await resp.json();
    const posting = data.jobs?.find(j => j.id === job.id);
    if (!posting) return null;

    const parts = [];
    if (posting.title) parts.push(`Title: ${posting.title}`);
    if (posting.location) parts.push(`Location: ${posting.location}`);
    if (posting.department) parts.push(`Department: ${posting.department}`);
    if (posting.team) parts.push(`Team: ${posting.team}`);
    if (posting.descriptionPlain) parts.push(`\nDescription:\n${posting.descriptionPlain}`);
    else if (posting.descriptionHtml) parts.push(`\nDescription:\n${stripHtml(posting.descriptionHtml)}`);
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
  if (!description && (job.url?.includes("lever.co") || ["palantir", "plaid", "spotify", "creditkarma", "quora"].includes(job.sourceKey))) {
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
