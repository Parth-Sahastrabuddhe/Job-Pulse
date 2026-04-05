import { describe, it, expect } from "vitest";
import { isTargetRole, detectRoleCategories } from "../src/sources/shared.js";

describe("isTargetRole (broadened)", () => {
  const shouldMatch = [
    "Software Engineer", "Software Engineer II", "Senior Software Engineer",
    "Staff Software Engineer", "Software Engineering Intern",
    "Backend Engineer", "Full-Stack Developer", "SDE I", "SWE",
    "Data Engineer", "Data Platform Engineer", "Analytics Engineer",
    "Machine Learning Engineer", "AI Engineer", "Deep Learning Researcher",
    "Frontend Engineer", "Front-End Developer", "UI Engineer",
    "Backend Developer", "Server Engineer",
    "DevOps Engineer", "Site Reliability Engineer", "SRE",
    "Infrastructure Engineer", "Cloud Engineer",
    "iOS Engineer", "Android Developer", "Mobile Engineer", "React Native Developer",
    "Product Manager", "Technical Program Manager", "Program Manager, Engineering",
    "Member of Technical Staff", "AMTS", "MTS", "Platform Engineer",
  ];

  const shouldNotMatch = [
    "Recruiter", "Sales Manager", "Marketing Analyst", "HR Business Partner",
    "Account Executive", "Legal Counsel", "Financial Analyst", "Office Manager",
    "Customer Success Manager", "Content Writer", "Graphic Designer",
    "", null, undefined,
  ];

  for (const title of shouldMatch) {
    it(`matches: "${title}"`, () => { expect(isTargetRole(title)).toBe(true); });
  }
  for (const title of shouldNotMatch) {
    it(`rejects: "${title}"`, () => { expect(isTargetRole(title)).toBe(false); });
  }
});

describe("detectRoleCategories", () => {
  it('detects software_engineer for "Software Engineer II"', () => {
    expect(detectRoleCategories("Software Engineer II")).toContain("software_engineer");
  });
  it('detects data_engineer for "Data Platform Engineer"', () => {
    expect(detectRoleCategories("Data Platform Engineer")).toContain("data_engineer");
  });
  it('detects ml_engineer for "Machine Learning Engineer"', () => {
    expect(detectRoleCategories("Machine Learning Engineer")).toContain("ml_engineer");
  });
  it('detects frontend for "Frontend Engineer"', () => {
    expect(detectRoleCategories("Frontend Engineer")).toContain("frontend");
  });
  it('detects backend for "Backend Developer"', () => {
    expect(detectRoleCategories("Backend Developer")).toContain("backend");
  });
  it('detects devops_sre for "Site Reliability Engineer"', () => {
    expect(detectRoleCategories("Site Reliability Engineer")).toContain("devops_sre");
  });
  it('detects mobile for "iOS Engineer"', () => {
    expect(detectRoleCategories("iOS Engineer")).toContain("mobile");
  });
  it('detects product_manager for "Technical Program Manager"', () => {
    expect(detectRoleCategories("Technical Program Manager")).toContain("product_manager");
  });
  it("can detect multiple categories for overlapping titles", () => {
    const cats = detectRoleCategories("Full-Stack Software Engineer");
    expect(cats).toContain("software_engineer");
  });
  it("returns empty array for non-tech titles", () => {
    expect(detectRoleCategories("Recruiter")).toEqual([]);
  });
  it("returns empty array for null/undefined", () => {
    expect(detectRoleCategories(null)).toEqual([]);
    expect(detectRoleCategories(undefined)).toEqual([]);
  });
});
