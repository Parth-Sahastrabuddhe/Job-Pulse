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
    // Role expansion (2026-07): language/tech-prefixed + new sections
    "Java Developer", ".NET Developer", "React Developer", "Kotlin Developer",
    "Go Developer", "Salesforce Developer", "Production Engineer",
    "Research Engineer", "Security Engineer", "Penetration Tester",
    "SDET", "QA Automation Engineer", "Firmware Engineer",
    "Embedded Software Engineer", "Solutions Architect", "Sales Engineer",
    "Engineering Manager", "Scrum Master", "Project Manager, Infrastructure",
    "Quantitative Researcher", "Financial Analyst", "Investment Banking Analyst",
    "Risk Analyst", "Staff Accountant", "Internal Auditor", "Treasury Analyst",
    "Data Modeler", "Database Administrator",
    // Full-catalog expansion (2026-07): design, hardware, IT, business, sales
    "Product Designer", "UX Researcher", "Technical Writer",
    "Hardware Engineer", "ASIC Design Engineer", "Electrical Engineer",
    "Mechanical Engineer", "Manufacturing Engineer", "Quality Engineer",
    "IT Support Specialist", "Network Engineer", "Systems Administrator",
    "Technical Support Engineer", "Operations Analyst", "Supply Chain Analyst",
    "Management Consultant", "Strategy Analyst", "Sales Manager",
    "Account Executive", "Marketing Analyst", "Customer Success Manager",
    "Graphic Designer", "Content Writer", "Business Development Manager",
    "Clinical Research Associate", "Biostatistician",
  ];

  const shouldNotMatch = [
    "Recruiter", "HR Business Partner", "Legal Counsel", "Office Manager",
    "Executive Assistant", "Facilities Coordinator", "Paralegal",
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
