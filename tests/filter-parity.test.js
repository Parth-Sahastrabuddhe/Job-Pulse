/**
 * Parity test — the critical regression guard for filter drift.
 *
 * Asserts that the micro bot's PERSONAL_PROFILE and an equivalent mu user
 * profile produce identical decisions on a fixed set of titles that includes
 * every known past bug case. If this test ever fails, some change has
 * introduced drift between the two code paths.
 */
import { describe, it, expect } from "vitest";
import { filterJobForUser } from "../src/filter.js";
import { PERSONAL_PROFILE } from "../src/personal-profile.js";

function makeJob(overrides = {}) {
  return {
    sourceKey: "stripe",
    sourceLabel: "Stripe",
    title: "Software Engineer II",
    location: "San Francisco, CA",
    countryCode: "US",
    ...overrides,
  };
}

const SAHAS_MU_PROFILE = {
  id: 1,
  role_categories: JSON.stringify(["software_engineer"]),
  seniority_levels: JSON.stringify(["entry", "mid"]),
  company_selections: JSON.stringify(["all"]),
  country: "US",
  requires_sponsorship: 1,
  education_level: "masters",
};

const TITLES = [
  // Standard SWE
  "Software Engineer",
  "Software Engineer II",
  "Software Engineer (L1)",
  "Software Engineer L3 Phone Numbers",
  "Software Engineer, (L2) Audiences & Journeys",
  "Software Developer",
  "Full-Stack Engineer",
  "Full Stack Developer",
  "Member of Technical Staff",
  "SDE",
  "SWE II",
  // Back-end variants (historical bug: LEGACY_SWE_PATTERN missing back-end)
  "Backend Engineer",
  "Back-End Engineer",
  "Back End Engineer",
  // Cloud / Platform / Systems
  "Cloud Engineer",
  "Platform Engineer",
  "Systems Engineer",
  // Entry / entry_mid
  "Software Engineer I",
  "SDE I",
  "Junior Software Engineer",
  "New Grad Software Engineer",
  // Should drop
  "Senior Software Engineer",
  "Sr. Software Engineer",
  "Staff Software Engineer",
  "Principal Engineer",
  "Distinguished Engineer",
  "Lead Backend Engineer",
  "Director of Engineering",
  "Engineering Manager",
  "Software Engineering Intern",
  // Banking variants (must drop for entry/mid)
  "VP Software Engineer",
  "AVP Software Engineer",
  "SVP, Technology",
  "Managing Director, Technology",
  // Non-SWE
  "Product Manager",
  "Data Scientist",
];

describe("filter parity: PERSONAL_PROFILE vs equivalent mu profile", () => {
  for (const title of TITLES) {
    it(`agrees on "${title}"`, () => {
      const job = makeJob({ title });
      const micro = filterJobForUser(job, PERSONAL_PROFILE);
      const mu = filterJobForUser(job, SAHAS_MU_PROFILE);
      expect(
        mu.pass,
        `Divergence: micro=${micro.pass} (${micro.reason}) mu=${mu.pass} (${mu.reason})`
      ).toBe(micro.pass);
    });
  }
});
