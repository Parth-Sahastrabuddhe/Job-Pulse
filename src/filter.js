/**
 * Shared filter for both the personal (micro) bot and the multi-user bot.
 *
 * Pure, no I/O. Always derives role/seniority classification from `job.title`
 * via detectRoleCategories / detectSeniority — never reads job.roleCategories
 * or job.seniorityLevel from the caller. This eliminates the class of
 * "stale DB classification" bugs.
 *
 * Sponsorship eligibility is delegated to an injected `sponsorLookup` callback
 * so this module stays I/O-free and easily testable.
 */

import { detectRoleCategories, detectSeniority } from "./sources/shared.js";

/**
 * @param {object} job - must have sourceKey, title, countryCode
 * @param {object} profile - user profile with JSON-stringified list fields
 *                          (role_categories, seniority_levels, company_selections)
 * @param {object} [options] - { sponsorLookup?: (sourceKey: string) => boolean }
 * @returns {{ pass: boolean, reason: string|null }}
 */
export function filterJobForUser(job, profile, options = {}) {
  let companies;
  let userRoles;
  let userSeniority;
  try {
    companies = JSON.parse(profile.company_selections || '["all"]');
    userRoles = JSON.parse(profile.role_categories || "[]");
    userSeniority = JSON.parse(profile.seniority_levels || "[]");
  } catch {
    return { pass: false, reason: "invalid_profile" };
  }

  // 1. Company selection
  if (!companies.includes("all") && !companies.includes(job.sourceKey)) {
    return { pass: false, reason: "company_excluded" };
  }

  // 2. Seniority — director check runs before role matching (unconditional block)
  const level = detectSeniority(job.title || "") || "mid";
  if (level === "director") {
    return { pass: false, reason: "director_blocked" };
  }

  // 3. Role category — always derived from title
  const jobRoles = detectRoleCategories(job.title || "");
  if (jobRoles.length === 0) {
    return { pass: false, reason: "no_role_categories" };
  }
  if (!jobRoles.some((r) => userRoles.includes(r))) {
    return { pass: false, reason: "role_mismatch" };
  }

  // 4. Seniority mismatch (non-director levels)
  if (level === "entry_mid") {
    if (!userSeniority.includes("entry") && !userSeniority.includes("mid")) {
      return { pass: false, reason: "seniority_mismatch" };
    }
  } else if (!userSeniority.includes(level)) {
    return { pass: false, reason: "seniority_mismatch" };
  }

  // 5. Country
  const userCountry = (profile.country || "US").toUpperCase();
  if (userCountry !== "ALL") {
    const jobCountry = (job.countryCode || "").toUpperCase();
    if (jobCountry && jobCountry !== userCountry) {
      return { pass: false, reason: "country_mismatch" };
    }
  }

  // 6. Sponsorship
  if (profile.requires_sponsorship) {
    const { sponsorLookup } = options;
    if (sponsorLookup && !sponsorLookup(job.sourceKey)) {
      return { pass: false, reason: "non_sponsor_company" };
    }
    // If sponsorLookup not provided, skip check (assume eligible).
  }

  return { pass: true, reason: null };
}
