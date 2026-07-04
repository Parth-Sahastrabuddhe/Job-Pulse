import { describe, it, expect } from "vitest";
import {
  ROLE_CATEGORY_PATTERNS,
  ROLE_SECTIONS,
  sectionForCategory,
  isTargetRole,
  detectRoleCategories,
  detectArchetype,
  resolveLevel,
  formatLevelLine,
} from "../src/role-taxonomy.js";
import { ROLE_SECTIONS as WEB_ROLE_SECTIONS } from "../web/lib/role-taxonomy.mjs";

describe("taxonomy structure", () => {
  it("every category pattern belongs to exactly one section", () => {
    const sectionCounts = {};
    for (const section of Object.values(ROLE_SECTIONS)) {
      for (const cat of section.categories) {
        sectionCounts[cat.value] = (sectionCounts[cat.value] ?? 0) + 1;
      }
    }
    for (const category of Object.keys(ROLE_CATEGORY_PATTERNS)) {
      expect(sectionCounts[category], `category "${category}" missing from sections`).toBe(1);
    }
    // and no section lists a category that has no pattern
    for (const value of Object.keys(sectionCounts)) {
      expect(ROLE_CATEGORY_PATTERNS[value], `section category "${value}" has no pattern`).toBeDefined();
    }
  });

  it("sectionForCategory resolves and rejects", () => {
    expect(sectionForCategory("security")).toBe("software_engineering");
    expect(sectionForCategory("quant")).toBe("finance");
    expect(sectionForCategory("nope")).toBeNull();
  });

  it("web UI mirror stays identical to the bot taxonomy", () => {
    expect(WEB_ROLE_SECTIONS).toEqual(ROLE_SECTIONS);
  });

  it("collection-gate invariant: any target title classifies into >= 1 category", () => {
    const probes = [
      "Software Engineer", "Java Developer", ".NET Developer", "Platform Engineer",
      "Research Engineer", "Security Engineer", "SDET", "Firmware Engineer",
      "Solutions Architect", "Scrum Master", "Quantitative Researcher",
      "Financial Analyst", "Risk Analyst", "Staff Accountant", "Data Modeler",
      "Engineering Manager", "Technical Program Manager", "Production Engineer",
    ];
    for (const title of probes) {
      expect(isTargetRole(title), `${title} should pass the gate`).toBe(true);
      expect(detectRoleCategories(title).length, `${title} should categorize`).toBeGreaterThan(0);
    }
  });
});

describe("archetypes for new categories", () => {
  const cases = [
    ["Security Engineer", "Security"],
    ["SDET", "QA"],
    ["Firmware Engineer", "Embedded"],
    ["Solutions Architect", "Solutions"],
    ["Research Engineer", "Research"],
    ["Engineering Manager", "EM"],
    ["Quantitative Researcher", "Quant"],
    ["Financial Analyst", "Finance"],
    ["Risk Analyst", "Risk"],
    ["Staff Accountant", "Accounting"],
  ];
  for (const [title, archetype] of cases) {
    it(`"${title}" → ${archetype}`, () => {
      expect(detectArchetype(title)).toBe(archetype);
    });
  }
});

describe("resolveLevel / formatLevelLine", () => {
  it("bank bands resolve with display markers", () => {
    expect(resolveLevel("Associate, Software Engineering", "goldmansachs"))
      .toEqual({ level: "mid", marker: "Associate" });
    expect(resolveLevel("Software Engineering, Analyst", "morganstanley"))
      .toEqual({ level: "entry_mid", marker: "Analyst" });
  });

  it("bank bands do NOT apply outside banking companies", () => {
    expect(resolveLevel("Associate, Software Engineering", "stripe")).toBeNull();
  });

  it("renders the equivalence line", () => {
    expect(formatLevelLine("Associate, Software Engineering", "goldmansachs"))
      .toBe("Level: Associate (≈ mid, SDE 2 / L4 equivalent)");
    expect(formatLevelLine("Software Engineer III, Google Cloud", "google"))
      .toBe("Level: SWE III (Google L4) (≈ mid, SDE 2 / L4 equivalent)");
  });

  it("suppresses the line when markers and keywords conflict", () => {
    expect(formatLevelLine("Senior Product Manager II", "")).toBeNull();
  });

  it("shows nothing without an explicit convention (no guessing)", () => {
    expect(formatLevelLine("Software Engineer", "stripe")).toBeNull();
    expect(formatLevelLine("Senior Software Engineer", "")).toBeNull();
  });
});
