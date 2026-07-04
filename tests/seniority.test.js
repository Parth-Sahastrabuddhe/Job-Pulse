import { describe, it, expect } from "vitest";
import { detectSeniority } from "../src/sources/shared.js";

describe("detectSeniority", () => {
  const cases = [
    // Intern
    ["Software Engineering Intern", "intern"],
    ["Summer Internship - SWE", "intern"],
    ["Co-Op Engineer", "intern"],

    // Entry
    ["Software Engineer, New Grad", "entry"],
    ["Junior Software Engineer", "entry"],
    ["Entry Level Data Engineer", "entry"],
    ["Early Career Software Engineer", "entry"],

    // Entry+Mid — plain titles without level markers match both entry-only and mid users
    ["SDE I", "entry_mid"],
    ["Software Engineer 1", "entry_mid"],
    ["Software Engineer I", "entry_mid"],
    ["Software Development Engineer I", "entry_mid"],
    ["Software Engineer", "entry_mid"],
    ["Associate Software Engineer", "entry_mid"],

    // Mid — explicit II / 2 markers, defaults, and the PM ladder (the old
    // blanket "manager -> senior" rule hid every plain PM job from
    // entry/mid PM users)
    ["Software Engineer II", "mid"],
    ["Data Engineer", "mid"],
    ["Software Engineer 2", "mid"],
    ["Backend Developer", "mid"],
    ["Product Manager", "mid"],
    ["Technical Program Manager", "mid"],
    ["Scrum Master", "mid"],
    ["Staff Accountant", "mid"],

    // Senior — III/3 are the senior rung in the generic numeral convention
    // (Amazon SDE III = L6; Google's III = L4 is a per-company override)
    ["Software Engineer III", "senior"],
    ["Software Engineer 3", "senior"],
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Engineer", "senior"],
    ["Lead Backend Engineer", "senior"],
    ["Engineering Manager", "senior"],

    // Director
    ["Director of Engineering", "director"],
    ["Chief Technology Officer", "director"],
    ["Managing Director", "director"],

    // Staff
    ["Staff Software Engineer", "staff"],
    ["Principal Engineer", "staff"],
    ["Distinguished Engineer", "staff"],
    ["Software Architect", "staff"],

    // Banking titles
    ["Vice President, Software Engineer", "senior"],
    ["AVP, Software Engineer", "senior"],
    ["SVP, Technology", "staff"],
    ["Associate, Technology", "mid"],
  ];

  for (const [title, expected] of cases) {
    it(`"${title}" → ${expected}`, () => {
      expect(detectSeniority(title)).toBe(expected);
    });
  }

  it("returns mid for null/undefined/empty", () => {
    expect(detectSeniority(null)).toBe("mid");
    expect(detectSeniority(undefined)).toBe("mid");
    expect(detectSeniority("")).toBe("mid");
  });
});

describe("detectSeniority with company-aware level rules", () => {
  const cases = [
    // Bank corporate bands (Analyst -> Associate -> VP IC track)
    ["Software Engineering, Analyst", "goldmansachs", "entry_mid"],
    ["Associate, Software Engineering", "goldmansachs", "mid"],
    ["Senior Associate, Software Engineer", "jpmorgan", "mid"],
    ["Vice President, Software Engineering", "morganstanley", "senior"],
    ["AVP, Software Engineer", "citi", "mid"],
    ["Software Engineer Summer Analyst", "goldmansachs", "intern"],
    // JPMorgan dual titles: SWE I/II/III sit in the analyst/associate bands
    ["Software Engineer III - Java, AWS, AI", "jpmorgan", "mid"],
    ["Software Engineer I", "jpmorgan", "entry"],
    // Google's titled numerals are L3/L4
    ["Software Engineer III, Google Cloud", "google", "mid"],
    ["Software Engineer II, YouTube", "google", "entry"],
    // Non-bank companies keep the generic convention
    ["Software Development Engineer III", "amazon", "senior"],
    ["SDE II", "amazon", "mid"],
    // Generic AVP outside banks keeps its old meaning
    ["AVP, Software Engineer", "", "senior"],
  ];

  for (const [title, sourceKey, expected] of cases) {
    it(`"${title}" @ ${sourceKey || "(generic)"} → ${expected}`, () => {
      expect(detectSeniority(title, sourceKey)).toBe(expected);
    });
  }

  it("PM ladder levels from modifiers", () => {
    expect(detectSeniority("Associate Product Manager")).toBe("entry");
    expect(detectSeniority("Senior Product Manager")).toBe("senior");
    expect(detectSeniority("Group Product Manager")).toBe("staff");
  });

  it("new-grad variants classify entry", () => {
    expect(detectSeniority("Graduate Software Engineer")).toBe("entry");
    expect(detectSeniority("University Graduate, Software Engineer")).toBe("entry");
  });
});
