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

    // Mid (default) — explicit II / III / 2 / 3 level markers
    ["Software Engineer II", "mid"],
    ["Data Engineer", "mid"],
    ["Software Engineer 2", "mid"],
    ["Software Engineer III", "mid"],
    ["Software Engineer 3", "mid"],
    ["Backend Developer", "mid"],

    // Senior
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Engineer", "senior"],
    ["Lead Backend Engineer", "senior"],
    ["Product Manager", "senior"],
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
