import { describe, it, expect } from "vitest";
import { checkLegitimacy } from "../src/legitimacy.js";

function makeJob(overrides = {}) {
  return {
    key: "test-key-1",
    sourceLabel: "Stripe",
    title: "Software Engineer",
    seniorityLevel: "mid",
    postedAt: null,
    ...overrides,
  };
}

const stubRepost0 = () => 0;
const stubRepost1 = () => 1;
const stubRepost2 = () => 2;
const opts0 = { getRepostCountFn: stubRepost0 };

// --- Signal 1: Posting age ---
describe("checkLegitimacy — posting age", () => {
  it("high_confidence when no postedAt", () => {
    expect(checkLegitimacy(makeJob(), null, opts0).tier).toBe("high_confidence");
  });

  it("caution when mid job posted 35 days ago", () => {
    const postedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkLegitimacy(makeJob({ postedAt }), null, opts0);
    expect(result.tier).toBe("caution");
    expect(result.topSignal).toMatch(/35 days ago/);
  });

  it("suspicious when mid job posted 70 days ago", () => {
    const postedAt = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString();
    expect(checkLegitimacy(makeJob({ postedAt }), null, opts0).tier).toBe("suspicious");
  });

  it("caution (not suspicious) when senior job posted 50 days ago", () => {
    const postedAt = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
    expect(checkLegitimacy(makeJob({ postedAt, seniorityLevel: "senior" }), null, opts0).tier).toBe("caution");
  });

  it("no age signal for staff jobs (200 days old)", () => {
    const postedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    expect(checkLegitimacy(makeJob({ postedAt, seniorityLevel: "staff" }), null, opts0).tier).toBe("high_confidence");
  });
});

// --- Signal 2: Reposting ---
describe("checkLegitimacy — reposting", () => {
  it("high_confidence when no reposts", () => {
    expect(checkLegitimacy(makeJob(), null, opts0).tier).toBe("high_confidence");
  });

  it("caution when reposted once", () => {
    const result = checkLegitimacy(makeJob(), null, { getRepostCountFn: stubRepost1 });
    expect(result.tier).toBe("caution");
    expect(result.topSignal).toMatch(/Reposted once/);
  });

  it("suspicious when reposted 2+ times", () => {
    const result = checkLegitimacy(makeJob(), null, { getRepostCountFn: stubRepost2 });
    expect(result.tier).toBe("suspicious");
    expect(result.topSignal).toMatch(/Reposted 3×/);
  });

  it("strips seniority from title before matching (Senior Software Engineer → Software Engineer)", () => {
    // getRepostCountFn receives titleCore without 'Senior'
    let receivedCore = null;
    const captureFn = (sourceLabel, titleCore) => { receivedCore = titleCore; return 0; };
    checkLegitimacy(makeJob({ title: "Senior Software Engineer" }), null, { getRepostCountFn: captureFn });
    expect(receivedCore).not.toMatch(/Senior/i);
    expect(receivedCore).toMatch(/Software Engineer/);
  });
});

// --- Signal 3: Thin JD ---
describe("checkLegitimacy — thin JD", () => {
  it("suspicious for description under 300 chars", () => {
    const result = checkLegitimacy(makeJob(), "A".repeat(250), opts0);
    expect(result.tier).toBe("suspicious");
    expect(result.topSignal).toMatch(/Very thin/);
  });

  it("caution for description 300-599 chars", () => {
    const result = checkLegitimacy(makeJob(), "A".repeat(450), opts0);
    expect(result.tier).toBe("caution");
    expect(result.topSignal).toMatch(/Thin job description/);
  });

  it("high_confidence for description 600+ chars", () => {
    expect(checkLegitimacy(makeJob(), "A".repeat(700), opts0).tier).toBe("high_confidence");
  });

  it("no thin JD signal when description is null", () => {
    expect(checkLegitimacy(makeJob(), null, opts0).tier).toBe("high_confidence");
  });

  it("no thin JD signal when description is empty string", () => {
    expect(checkLegitimacy(makeJob(), "", opts0).tier).toBe("high_confidence");
  });
});

// --- Signal 4: Evergreen keywords ---
describe("checkLegitimacy — evergreen keywords", () => {
  it("caution for 'always hiring'", () => {
    const desc = "We are always hiring great engineers. " + "A".repeat(600);
    const result = checkLegitimacy(makeJob(), desc, opts0);
    expect(result.tier).toBe("caution");
    expect(result.topSignal).toMatch(/Evergreen/);
  });

  it("caution for 'talent pool'", () => {
    const desc = "Join our talent pool today. " + "A".repeat(600);
    expect(checkLegitimacy(makeJob(), desc, opts0).tier).toBe("caution");
  });

  it("caution for 'similar roles may be available'", () => {
    const desc = "Similar roles may be available at a later date. " + "A".repeat(600);
    expect(checkLegitimacy(makeJob(), desc, opts0).tier).toBe("caution");
  });

  it("no signal for normal description", () => {
    const desc = "We are looking for a software engineer to join our backend team. You will build scalable APIs and work with a cross-functional team. Requirements: 2+ years of experience with Node.js, strong understanding of REST APIs, experience with SQL databases. " + "A".repeat(400);
    expect(checkLegitimacy(makeJob(), desc, opts0).tier).toBe("high_confidence");
  });
});

// --- Tier reducer ---
describe("checkLegitimacy — tier reducer", () => {
  it("suspicious wins over caution when both fire", () => {
    // Thin JD < 300 chars (suspicious) + evergreen keyword (caution)
    const desc = "always hiring " + "A".repeat(200);
    expect(checkLegitimacy(makeJob(), desc, opts0).tier).toBe("suspicious");
  });

  it("returns all fired signals in signals array", () => {
    const desc = "always hiring " + "A".repeat(450); // evergreen (caution) + thin (caution)
    const result = checkLegitimacy(makeJob(), desc, opts0);
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
  });
});

// --- topSignal priority ---
describe("checkLegitimacy — topSignal priority", () => {
  it("prefers repost over age when both caution", () => {
    const postedAt = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const result = checkLegitimacy(makeJob({ postedAt }), null, { getRepostCountFn: stubRepost1 });
    expect(result.topSignal).toMatch(/Reposted/);
  });
});

// --- Fail-open ---
describe("checkLegitimacy — error handling", () => {
  it("returns high_confidence when getRepostCountFn throws", () => {
    const throwingFn = () => { throw new Error("DB error"); };
    const result = checkLegitimacy(makeJob(), null, { getRepostCountFn: throwingFn });
    expect(result.tier).toBe("high_confidence");
    expect(result.signals).toEqual([]);
  });
});
