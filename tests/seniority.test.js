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
    ["SDE I", "entry"],
    ["Junior Software Engineer", "entry"],
    ["Entry Level Data Engineer", "entry"],
    ["Associate Software Engineer", "entry"],
    ["Software Engineer 1", "entry"],

    // Mid (default)
    ["Software Engineer II", "mid"],
    ["Software Engineer", "mid"],
    ["Data Engineer", "mid"],
    ["Software Engineer 2", "mid"],
    ["Product Manager", "mid"],
    ["Backend Developer", "mid"],

    // Senior
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Engineer", "senior"],
    ["Software Engineer III", "senior"],
    ["Lead Backend Engineer", "senior"],
    ["Software Engineer 3", "senior"],

    // Staff
    ["Staff Software Engineer", "staff"],
    ["Principal Engineer", "staff"],
    ["Distinguished Engineer", "staff"],
    ["Software Architect", "staff"],

    // Banking titles
    ["Vice President, Software Engineer", "senior"],
    ["SVP, Technology", "staff"],
    ["Associate, Technology", "entry"],
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
