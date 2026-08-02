import { chromium } from "playwright";
import { getConfig } from "./private-config.js";
import { launchChromiumWithGuard, newRestrictedPage } from "./playwright-guard.js";
import { assertSafeUrl } from "./ssrf-guard.js";
import { COMPANIES } from "./companies.js";
import fs from "node:fs";

const ATS_POLICIES = Object.freeze({
  greenhouse: {
    initialHosts: [/^(?:boards|job-boards)\.greenhouse\.io$/i],
  },
  lever: {
    initialHosts: [/^jobs\.lever\.co$/i],
  },
  workday: {
    initialHosts: [/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i],
  },
  ashby: {
    initialHosts: [/^jobs\.ashbyhq\.com$/i],
  },
});

function exactHostRule(hostname) {
  const escaped = String(hostname).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

export function detectATS(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return "unknown";
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
      (parsed.port && parsed.port !== "443")) return "unknown";
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (ATS_POLICIES.greenhouse.initialHosts.some((rule) => rule.test(hostname))) return "greenhouse";
  if (hostname === "jobs.lever.co") return "lever";
  if (ATS_POLICIES.workday.initialHosts[0].test(hostname)) return "workday";
  if (hostname === "jobs.ashbyhq.com") return "ashby";
  return "unknown";
}

/**
 * Bind an ATS URL to a company in the checked-in registry. This prevents a
 * forged message from pointing the personal profile at another tenant on an
 * otherwise legitimate shared ATS host.
 */
export function resolveAutoApplyTarget(jobUrl, companyName) {
  const ats = detectATS(jobUrl);
  if (ats === "unknown") return null;
  const normalizedCompany = String(companyName || "").trim().toLowerCase();
  const company = COMPANIES.find((candidate) =>
    candidate.ats === ats && candidate.label.toLowerCase() === normalizedCompany);
  if (!company) return null;

  const match = String(jobUrl).match(company.urlPattern);
  const jobId = match?.[1];
  if (!jobId) return null;

  // Always use the registry-owned Greenhouse board, never a tenant name from
  // the message URL. Other ATS regexes already encode their exact tenant.
  const targetUrl = ats === "greenhouse"
    ? `https://job-boards.greenhouse.io/${encodeURIComponent(company.board)}/jobs/${encodeURIComponent(jobId)}`
    : new URL(jobUrl).toString();
  return { ats, targetUrl, companyKey: company.key };
}

function getApplyUrl(url, ats) {
  const parsed = new URL(url);
  switch (ats) {
    case "greenhouse":
      if (!parsed.hash) parsed.hash = "app";
      return parsed.toString();
    case "lever":
      if (!parsed.pathname.endsWith("/apply")) {
        parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/apply`;
      }
      return parsed.toString();
    default:
      return parsed.toString();
  }
}

async function safeFill(page, selector, value) {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 2000 })) {
      await el.fill(value);
      return true;
    }
  } catch {}
  return false;
}

async function safeUpload(page, selector, filePath) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const el = page.locator(selector).first();
    if (await el.count() > 0) {
      await el.setInputFiles(filePath);
      return true;
    }
  } catch {}
  return false;
}

async function fillGreenhouse(page, profile) {
  await safeFill(page, 'input[name="job_application[first_name]"], #first_name', profile.name.split(" ")[0] || "");
  await safeFill(page, 'input[name="job_application[last_name]"], #last_name', profile.name.split(" ").slice(1).join(" ") || "");
  await safeFill(page, 'input[name="job_application[email]"], #email', profile.email);
  await safeFill(page, 'input[name="job_application[phone]"], #phone', profile.phone);
  // LinkedIn - try multiple selectors
  await safeFill(page, 'input[name*="linkedin"], input[id*="linkedin"]', profile.linkedin);
  await safeUpload(page, 'input[type="file"][name*="resume"], input[type="file"]', profile.resumePath);
}

async function fillLever(page, profile) {
  await safeFill(page, 'input[name="name"]', profile.name);
  await safeFill(page, 'input[name="email"]', profile.email);
  await safeFill(page, 'input[name="phone"]', profile.phone);
  await safeFill(page, 'input[name="urls[LinkedIn]"], input[name*="linkedin"]', profile.linkedin);
  await safeUpload(page, 'input[type="file"][name="resume"], input[type="file"]', profile.resumePath);
}

async function fillAshby(page, profile) {
  await safeFill(page, 'input[name="_systemfield_name"]', profile.name);
  await safeFill(page, 'input[name="_systemfield_email"]', profile.email);
  await safeFill(page, 'input[name="_systemfield_phone"]', profile.phone);
  await safeUpload(page, 'input[type="file"]', profile.resumePath);
}

async function fillWorkday(page, profile) {
  // Workday is multi-step — fill what's visible on the first page
  await safeFill(page, '[data-automation-id="legalNameSection_firstName"], input[aria-label*="First Name"]', profile.name.split(" ")[0] || "");
  await safeFill(page, '[data-automation-id="legalNameSection_lastName"], input[aria-label*="Last Name"]', profile.name.split(" ").slice(1).join(" ") || "");
  await safeFill(page, '[data-automation-id="email"], input[aria-label*="Email"]', profile.email);
  await safeFill(page, '[data-automation-id="phone"], input[aria-label*="Phone"]', profile.phone);
  await safeUpload(page, 'input[type="file"]', profile.resumePath);
}

export async function autoFillApplication(jobUrl, companyName, jobTitle, options = {}) {
  const target = resolveAutoApplyTarget(jobUrl, companyName);
  const ats = target?.ats || "unknown";
  const atsPolicy = ATS_POLICIES[ats];
  if (!atsPolicy || !target) {
    return {
      screenshot: null,
      ats: "unknown",
      success: false,
      error: "Unsupported application host; no applicant data was sent",
    };
  }

  try {
    await assertSafeUrl(target.targetUrl, {
      requireHttps: true,
      allowedHosts: atsPolicy.initialHosts,
      signal: options.signal,
      timeoutMs: 5000,
    });
  } catch {
    return {
      screenshot: null,
      ats,
      success: false,
      error: "Application URL failed the network safety policy; no applicant data was sent",
    };
  }

  const runtimeConfig = getConfig();
  const profile = runtimeConfig.applicant;

  if (!profile.name || !profile.email) {
    return { screenshot: null, ats, success: false, error: "APPLICANT_NAME and APPLICANT_EMAIL must be set in .env" };
  }

  let browser;
  let page;
  let networkFrozen = false;
  try {
    browser = await launchChromiumWithGuard(chromium, { headless: true }, {
      ...runtimeConfig,
      signal: options.signal,
    });
    page = await newRestrictedPage(browser, {
      // Only the exact registry-bound ATS host may load. Once profile fields
      // begin filling, freeze all network so page script cannot forward PII or
      // resume bytes to another tenant on the same shared ATS origin.
      allowedHosts: [exactHostRule(new URL(target.targetUrl).hostname)],
      signal: options.signal,
      allowRequest: () => !networkFrozen,
    });
    const applyUrl = getApplyUrl(target.targetUrl, ats);
    await page.goto(applyUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for forms to load
    await page.waitForTimeout(2000);
    networkFrozen = true;

    switch (ats) {
      case "greenhouse": await fillGreenhouse(page, profile); break;
      case "lever": await fillLever(page, profile); break;
      case "ashby": await fillAshby(page, profile); break;
      case "workday": await fillWorkday(page, profile); break;
      default: throw new Error("Unsupported ATS policy");
    }

    // Wait for fills to settle
    await page.waitForTimeout(1000);

    const screenshot = await page.screenshot({ fullPage: true });
    return { screenshot, ats, success: true };
  } catch (error) {
    const screenshot = await page?.screenshot({ fullPage: true }).catch(() => null) || null;
    return { screenshot, ats, success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
