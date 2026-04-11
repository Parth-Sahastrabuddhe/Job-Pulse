import { chromium } from "playwright";
import { getConfig } from "./config.js";
import fs from "node:fs";

function detectATS(url) {
  if (/boards\.greenhouse\.io|job-boards\.greenhouse\.io/i.test(url)) return "greenhouse";
  if (/jobs\.lever\.co/i.test(url)) return "lever";
  if (/myworkdayjobs\.com/i.test(url)) return "workday";
  if (/jobs\.ashbyhq\.com/i.test(url)) return "ashby";
  return "unknown";
}

function getApplyUrl(url, ats) {
  switch (ats) {
    case "greenhouse":
      return url.includes("#app") ? url : url + "#app";
    case "lever":
      return url.includes("/apply") ? url : url.replace(/\/?$/, "/apply");
    default:
      return url;
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

async function fillGeneric(page, profile) {
  // Try common patterns
  const nameFields = page.locator('input[name*="name" i]:not([name*="company"]):not([type="hidden"])');
  if (await nameFields.count() > 0) await nameFields.first().fill(profile.name).catch(() => {});

  const emailFields = page.locator('input[name*="email" i]:not([type="hidden"]), input[type="email"]');
  if (await emailFields.count() > 0) await emailFields.first().fill(profile.email).catch(() => {});

  const phoneFields = page.locator('input[name*="phone" i]:not([type="hidden"]), input[type="tel"]');
  if (await phoneFields.count() > 0) await phoneFields.first().fill(profile.phone).catch(() => {});

  await safeUpload(page, 'input[type="file"]', profile.resumePath);
}

export async function autoFillApplication(jobUrl, companyName, jobTitle) {
  const ats = detectATS(jobUrl);
  const profile = getConfig().applicant;

  if (!profile.name || !profile.email) {
    return { screenshot: null, ats, success: false, error: "APPLICANT_NAME and APPLICANT_EMAIL must be set in .env" };
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const applyUrl = getApplyUrl(jobUrl, ats);
    await page.goto(applyUrl, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for forms to load
    await page.waitForTimeout(2000);

    switch (ats) {
      case "greenhouse": await fillGreenhouse(page, profile); break;
      case "lever": await fillLever(page, profile); break;
      case "ashby": await fillAshby(page, profile); break;
      case "workday": await fillWorkday(page, profile); break;
      default: await fillGeneric(page, profile); break;
    }

    // Wait for fills to settle
    await page.waitForTimeout(1000);

    const screenshot = await page.screenshot({ fullPage: true });
    return { screenshot, ats, success: true };
  } catch (error) {
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    return { screenshot, ats, success: false, error: error.message };
  } finally {
    await browser.close();
  }
}
