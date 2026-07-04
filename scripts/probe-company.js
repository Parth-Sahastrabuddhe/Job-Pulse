/**
 * probe-company.js: run one parameterized ATS collector and report what it
 * returns. Used by the add-company automation for pre-push verification (this
 * box) and post-deploy verification (EC2). Network reads only, no DB access.
 *
 * Usage: node scripts/probe-company.js <companyKey>
 *
 * stdout: JSON { key, label, ats, total, us, sample: [...] } or { error }.
 * Exit codes: 0 ok, 1 error/unknown key, 2 unsupported (solo/Playwright company).
 */

import { COMPANIES } from "../src/companies.js";
import { getConfig } from "../src/config.js";
import { jobMatchesCountryFilter } from "../src/sources/shared.js";
import { collectGreenhouseJobs } from "../src/sources/greenhouse.js";
import { collectWorkdayJobs } from "../src/sources/workday.js";
import { collectLeverJobs } from "../src/sources/lever.js";
import { collectAshbyJobs } from "../src/sources/ashby.js";
import { collectSmartRecruitersJobs } from "../src/sources/smartrecruiters.js";
import { collectPcsxJobs } from "../src/sources/pcsx.js";

const ATS_COLLECTORS = {
  greenhouse: collectGreenhouseJobs,
  workday: collectWorkdayJobs,
  lever: collectLeverJobs,
  ashby: collectAshbyJobs,
  smartrecruiters: collectSmartRecruitersJobs,
  pcsx: collectPcsxJobs,
};

const key = process.argv[2];
if (!key) {
  console.error("Usage: node scripts/probe-company.js <companyKey>");
  process.exit(1);
}

const company = COMPANIES.find((c) => c.key === key);
if (!company) {
  console.log(JSON.stringify({ error: "unknown company key", key }));
  process.exit(1);
}

const collector = ATS_COLLECTORS[company.ats];
if (!collector) {
  console.log(JSON.stringify({ error: "probe supports parameterized ATS companies only", key, ats: company.ats }));
  process.exit(2);
}

const config = getConfig();
if (!config[key]) {
  console.log(JSON.stringify({ error: "missing config entry in src/config.js", key }));
  process.exit(1);
}

try {
  const jobs = await collector(null, config, () => {}, key);
  const list = Array.isArray(jobs) ? jobs : [];
  // Same gate prod uses (includes location-inference + blank-location grace),
  // so this predicts what would actually flow to US users.
  const us = list.filter((j) => jobMatchesCountryFilter(j, "us")).length;
  const sample = list.slice(0, 5).map((j) => ({
    title: j.title ?? "",
    location: j.location ?? "",
    countryCode: j.countryCode ?? "",
    seniority: j.seniorityLevel ?? "",
    roles: j.roleCategories ?? [],
    url: j.url ?? "",
  }));
  console.log(JSON.stringify({ key, label: company.label, ats: company.ats, total: list.length, us, sample }, null, 2));
} catch (err) {
  console.log(JSON.stringify({ error: `collector threw: ${err.message}`, key, ats: company.ats }));
  process.exit(1);
}
