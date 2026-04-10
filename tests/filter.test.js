import { describe, it, expect } from "vitest";
import { filterJobForUser } from "../src/filter.js";

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

describe("filterJobForUser — passing cases", () => {
  it("passes basic Software Engineer for entry/mid SWE profile", () => {
    const result = filterJobForUser(makeJob(), makeProfile());
    expect(result.pass).toBe(true);
    expect(result.reason).toBe(null);
  });

  it("passes titles with level suffixes (Twilio regression case)", () => {
    expect(filterJobForUser(makeJob({ title: "Software Engineer (L1)" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "Software Engineer L3 Phone Numbers" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "Software Engineer, (L2) Audiences & Journeys" }), makeProfile()).pass).toBe(true);
  });

  it("passes hyphenated Back-End variants", () => {
    expect(filterJobForUser(makeJob({ title: "Back-End Engineer" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "Back End Engineer" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "Backend Engineer" }), makeProfile()).pass).toBe(true);
  });

  it("passes Platform Engineer via PLATFORM_ENGINEER_PATTERN", () => {
    expect(filterJobForUser(makeJob({ title: "Platform Engineer" }), makeProfile()).pass).toBe(true);
  });

  it("passes classic SWE titles", () => {
    expect(filterJobForUser(makeJob({ title: "Member of Technical Staff" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "SDE" }), makeProfile()).pass).toBe(true);
    expect(filterJobForUser(makeJob({ title: "Full-Stack Engineer" }), makeProfile()).pass).toBe(true);
  });

  it("ignores stale roleCategories on the job input (derives from title)", () => {
    // Regression guard: the DB may contain empty role_categories for old rows.
    // The filter must derive from title, not trust the passed-in field.
    const job = makeJob({ title: "Software Engineer", roleCategories: [] });
    expect(filterJobForUser(job, makeProfile()).pass).toBe(true);
  });
});

describe("filterJobForUser — failing cases", () => {
  it("drops senior for entry/mid profile", () => {
    const result = filterJobForUser(makeJob({ title: "Senior Software Engineer" }), makeProfile());
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("seniority_mismatch");
  });

  it("drops staff-tier titles for entry/mid profile", () => {
    expect(filterJobForUser(makeJob({ title: "Staff Software Engineer" }), makeProfile()).pass).toBe(false);
    expect(filterJobForUser(makeJob({ title: "Principal Engineer" }), makeProfile()).pass).toBe(false);
    expect(filterJobForUser(makeJob({ title: "Distinguished Engineer" }), makeProfile()).pass).toBe(false);
  });

  it("drops director always (even if profile selects director)", () => {
    const profile = makeProfile({ seniority_levels: '["director"]' });
    const result = filterJobForUser(makeJob({ title: "Director of Engineering" }), profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("director_blocked");
  });

  it("drops AVP for entry/mid profile (banking regression)", () => {
    const result = filterJobForUser(makeJob({ title: "AVP Software Engineer" }), makeProfile());
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("seniority_mismatch");
  });

  it("drops empty title", () => {
    const result = filterJobForUser(makeJob({ title: "" }), makeProfile());
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("no_role_categories");
  });

  it("drops non-SWE title", () => {
    const result = filterJobForUser(makeJob({ title: "Product Designer" }), makeProfile());
    expect(result.pass).toBe(false);
  });

  it("drops job from excluded company", () => {
    const profile = makeProfile({ company_selections: '["google", "meta"]' });
    const result = filterJobForUser(makeJob({ sourceKey: "stripe" }), profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("company_excluded");
  });

  it("drops non-US job for US profile", () => {
    const result = filterJobForUser(makeJob({ countryCode: "NON-US" }), makeProfile());
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("country_mismatch");
  });

  it("allows non-US job when profile country is ALL", () => {
    const result = filterJobForUser(makeJob({ countryCode: "NON-US" }), makeProfile({ country: "ALL" }));
    expect(result.pass).toBe(true);
  });
});

describe("filterJobForUser — sponsorship", () => {
  it("skips sponsorship check when profile does not require sponsorship", () => {
    expect(filterJobForUser(makeJob(), makeProfile()).pass).toBe(true);
  });

  it("passes when sponsorLookup returns true", () => {
    const profile = makeProfile({ requires_sponsorship: 1 });
    const result = filterJobForUser(makeJob(), profile, { sponsorLookup: () => true });
    expect(result.pass).toBe(true);
  });

  it("drops when sponsorLookup returns false", () => {
    const profile = makeProfile({ requires_sponsorship: 1 });
    const result = filterJobForUser(makeJob(), profile, { sponsorLookup: () => false });
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("non_sponsor_company");
  });

  it("skips sponsorship check when sponsorLookup not provided (assumes eligible)", () => {
    const profile = makeProfile({ requires_sponsorship: 1 });
    expect(filterJobForUser(makeJob(), profile).pass).toBe(true);
  });
});

describe("filterJobForUser — invalid profile", () => {
  it("returns invalid_profile for unparseable role_categories", () => {
    const profile = makeProfile({ role_categories: "not-json{" });
    const result = filterJobForUser(makeJob(), profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("invalid_profile");
  });

  it("returns invalid_profile for unparseable seniority_levels", () => {
    const profile = makeProfile({ seniority_levels: "bad{" });
    const result = filterJobForUser(makeJob(), profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("invalid_profile");
  });

  it("returns invalid_profile for unparseable company_selections", () => {
    const profile = makeProfile({ company_selections: "][" });
    const result = filterJobForUser(makeJob(), profile);
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("invalid_profile");
  });
});
