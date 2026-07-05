import { describe, expect, it } from "vitest";
import { parseFitCheckOutput } from "../src/fit-check-core.js";

const BLOCK = `═══════════════
FIT ASSESSMENT
Should Apply: YES
Reasoning: solid match
═══════════════`;

describe("parseFitCheckOutput", () => {
  it("extracts verdict YES/STRETCH/NO", () => {
    expect(parseFitCheckOutput("Should Apply: YES").shouldApply).toBe("YES");
    expect(parseFitCheckOutput("Should Apply: STRETCH").shouldApply).toBe("STRETCH");
    expect(parseFitCheckOutput("Should Apply: NO").shouldApply).toBe("NO");
    expect(parseFitCheckOutput("nothing here").shouldApply).toBe("UNKNOWN");
  });

  it("extracts the assessment block", () => {
    const r = parseFitCheckOutput(`preamble\n${BLOCK}\ntrailer`);
    expect(r.fitAssessment).toContain("FIT ASSESSMENT");
    expect(r.fitAssessment.startsWith("═")).toBe(true);
  });

  it("parses the FIT_SCORES line", () => {
    const r = parseFitCheckOutput(`${BLOCK}\nFIT_SCORES:{"score":82,"skills":85,"experience":75,"domain":90,"level":78}`);
    expect(r.fitScore).toBe(82);
    expect(r.fitScores.domain).toBe(90);
  });

  it("tolerates malformed FIT_SCORES JSON", () => {
    const r = parseFitCheckOutput(`${BLOCK}\nFIT_SCORES:{"score":82,`);
    expect(r.fitScore).toBeNull();
    expect(r.fitScores).toBeNull();
  });

  it("ignores FIT_SCORES without a numeric score", () => {
    const r = parseFitCheckOutput(`FIT_SCORES:{"score":"high"}`);
    expect(r.fitScore).toBeNull();
  });
});
