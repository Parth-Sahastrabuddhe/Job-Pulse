import { describe, it, expect } from "vitest";
import { jobMatchesUserProfile } from "../src/user-filter.js";

function makeJob(overrides = {}) {
  return {
    sourceKey: "stripe", sourceLabel: "Stripe",
    title: "Software Engineer II", location: "San Francisco, CA",
    countryCode: "US", seniorityLevel: "mid",
    roleCategories: ["software_engineer"],
    ...overrides,
  };
}

function makeProfile(overrides = {}) {
  return {
    role_categories: '["software_engineer"]',
    seniority_levels: '["entry", "mid"]',
    company_selections: '["all"]',
    country: "US",
    requires_sponsorship: 0,
    ...overrides,
  };
}

describe("jobMatchesUserProfile", () => {
  // Role category matching
  it("matches when job role matches user preference", () => {
    expect(jobMatchesUserProfile(makeJob(), makeProfile())).toBe(true);
  });
  it("rejects when job role does not match user preference", () => {
    expect(jobMatchesUserProfile(makeJob({ roleCategories: ["data_engineer"] }), makeProfile())).toBe(false);
  });
  it("matches when job has multiple categories and one matches", () => {
    expect(jobMatchesUserProfile(makeJob({ roleCategories: ["software_engineer", "backend"] }), makeProfile({ role_categories: '["backend"]' }))).toBe(true);
  });

  // Seniority matching
  it("matches when seniority matches", () => {
    expect(jobMatchesUserProfile(makeJob({ seniorityLevel: "entry" }), makeProfile())).toBe(true);
  });
  it("rejects when seniority does not match", () => {
    expect(jobMatchesUserProfile(makeJob({ seniorityLevel: "senior" }), makeProfile())).toBe(false);
  });

  // Company selection
  it('matches any company when "all" selected', () => {
    expect(jobMatchesUserProfile(makeJob({ sourceKey: "google" }), makeProfile())).toBe(true);
  });
  it("matches when company in selection", () => {
    expect(jobMatchesUserProfile(makeJob(), makeProfile({ company_selections: '["stripe", "google"]' }))).toBe(true);
  });
  it("rejects when company not in selection", () => {
    expect(jobMatchesUserProfile(makeJob({ sourceKey: "stripe" }), makeProfile({ company_selections: '["google", "meta"]' }))).toBe(false);
  });

  // Country matching
  it("matches when country matches", () => {
    expect(jobMatchesUserProfile(makeJob(), makeProfile())).toBe(true);
  });
  it("rejects when country does not match", () => {
    expect(jobMatchesUserProfile(makeJob({ countryCode: "NON-US" }), makeProfile())).toBe(false);
  });
  it("allows any country when ALL", () => {
    expect(jobMatchesUserProfile(makeJob({ countryCode: "NON-US" }), makeProfile({ country: "ALL" }))).toBe(true);
  });

  // Sponsorship
  it("passes when user does not require sponsorship", () => {
    expect(jobMatchesUserProfile(makeJob(), makeProfile())).toBe(true);
  });
  it("uses sponsorLookup when user requires sponsorship", () => {
    const profile = makeProfile({ requires_sponsorship: 1 });
    expect(jobMatchesUserProfile(makeJob(), profile, { sponsorLookup: () => true })).toBe(true);
    expect(jobMatchesUserProfile(makeJob(), profile, { sponsorLookup: () => false })).toBe(false);
  });

  // Edge cases
  it("handles empty roleCategories", () => {
    expect(jobMatchesUserProfile(makeJob({ roleCategories: [] }), makeProfile())).toBe(false);
  });
});
