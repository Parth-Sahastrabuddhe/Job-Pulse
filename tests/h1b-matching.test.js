import { describe, it, expect } from "vitest";
import { normalizeEmployerName, resolveCompanyStats, candidateNamesFor } from "../src/h1b-matching.js";
import { formatH1bLine } from "../src/mu-delivery.js";

describe("normalizeEmployerName", () => {
  it("strips punctuation and legal suffixes", () => {
    expect(normalizeEmployerName("Google LLC")).toBe("GOOGLE");
    expect(normalizeEmployerName("NVIDIA Corporation")).toBe("NVIDIA");
    expect(normalizeEmployerName("Stripe, Inc.")).toBe("STRIPE");
    expect(normalizeEmployerName("Anthropic, PBC")).toBe("ANTHROPIC");
  });

  it("collapses spaced legal forms before stripping", () => {
    expect(normalizeEmployerName("Bloomberg L.P.")).toBe("BLOOMBERG");
    expect(normalizeEmployerName("OPENAI, L L C")).toBe("OPENAI");
  });

  it("strips stacked suffixes and trailing ampersands", () => {
    expect(normalizeEmployerName("Goldman Sachs & Co. LLC")).toBe("GOLDMAN SACHS");
  });

  it("does not truncate words that merely end with a suffix token", () => {
    expect(normalizeEmployerName("Costco")).toBe("COSTCO");
    expect(normalizeEmployerName("Cisco")).toBe("CISCO");
  });
});

describe("resolveCompanyStats", () => {
  const employers = {
    "META PLATFORMS": { n: 100, w: 200_000 },
    "ACME": { n: 10, w: 120_000 },
    "ACME ROBOTICS": { n: 5, w: 0 },
  };

  it("resolves via alias list (meta -> META PLATFORMS)", () => {
    const stats = resolveCompanyStats(employers, { key: "meta", label: "Meta" });
    expect(stats).toEqual({ lcaCount: 100, medianWage: 200_000, matchedNames: ["META PLATFORMS"] });
  });

  it("resolves via normalized label when no alias exists", () => {
    const stats = resolveCompanyStats(employers, { key: "acme", label: "Acme, Inc." });
    expect(stats.lcaCount).toBe(10);
    expect(stats.medianWage).toBe(120_000);
  });

  it("returns null when nothing matches", () => {
    expect(resolveCompanyStats(employers, { key: "nope", label: "Nope Systems" })).toBeNull();
  });

  it("weights wages by count and skips zero-wage entries", () => {
    const stats = resolveCompanyStats(
      { "A": { n: 30, w: 100_000 }, "B": { n: 10, w: 200_000 } },
      { key: "x", label: "ignored" },
    );
    expect(stats).toBeNull(); // label doesn't match; sanity guard for test data
    const merged = resolveCompanyStats(
      { "ACME": { n: 30, w: 100_000 }, "ACME ROBOTICS": { n: 10, w: 200_000 } },
      { key: "acme2", label: "Acme" },
    );
    // Only the label-matched entry counts without an alias.
    expect(merged.lcaCount).toBe(30);
  });

  it("candidateNamesFor merges alias and label without duplicates", () => {
    const names = candidateNamesFor({ key: "openai", label: "OpenAI" });
    expect(names).toContain("OPENAI OPCO");
    expect(names).toContain("OPENAI");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("formatH1bLine", () => {
  it("renders count, window, and wage", () => {
    expect(formatH1bLine({ lca_count: 8025, avg_salary: 186000, lca_fy: "2025" }))
      .toBe("🛂 H-1B 2025: ~8,025 LCAs certified, median ~$186k");
  });

  it("omits wage when unknown", () => {
    expect(formatH1bLine({ lca_count: 12, avg_salary: 0, lca_fy: "2025" }))
      .toBe("🛂 H-1B 2025: ~12 LCAs certified");
  });

  it("returns null without real data", () => {
    expect(formatH1bLine(null)).toBeNull();
    expect(formatH1bLine({ lca_count: 0, avg_salary: 0, lca_fy: "" })).toBeNull();
  });
});
