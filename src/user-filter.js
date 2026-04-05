/**
 * @param {Object} job — must have roleCategories, seniorityLevel, countryCode, sourceKey
 * @param {Object} profile — from user_profiles (JSON string fields)
 * @param {Object} options — { sponsorLookup: (sourceKey) => boolean }
 * @returns {boolean}
 */
export function jobMatchesUserProfile(job, profile, { sponsorLookup } = {}) {
  // 1. Company selection
  const companies = JSON.parse(profile.company_selections || '["all"]');
  if (!companies.includes("all") && !companies.includes(job.sourceKey)) return false;

  // 2. Role category match
  const userRoles = JSON.parse(profile.role_categories || "[]");
  const jobRoles = Array.isArray(job.roleCategories) ? job.roleCategories : JSON.parse(job.roleCategories || "[]");
  if (jobRoles.length === 0 || !jobRoles.some((r) => userRoles.includes(r))) return false;

  // 3. Seniority match
  const userSeniority = JSON.parse(profile.seniority_levels || "[]");
  if (!userSeniority.includes(job.seniorityLevel || "mid")) return false;

  // 4. Country match
  const userCountry = (profile.country || "US").toUpperCase();
  if (userCountry !== "ALL") {
    const jobCountry = (job.countryCode || "").toUpperCase();
    if (jobCountry && jobCountry !== userCountry) return false;
  }

  // 5. Sponsorship check
  if (profile.requires_sponsorship) {
    const lookup = sponsorLookup || (() => false);
    if (!lookup(job.sourceKey)) return false;
  }

  return true;
}

/**
 * Filter jobs for a user, also handling per-user dedup.
 */
export function filterJobsForUser(jobs, profile, seenKeys, options = {}) {
  return jobs.filter((job) => {
    if (seenKeys.has(job.key)) return false;
    return jobMatchesUserProfile(job, profile, options);
  });
}
