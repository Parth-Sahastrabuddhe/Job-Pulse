import { describe, expect, it } from "vitest";
import {
  autoFillApplication,
  detectATS,
  resolveAutoApplyTarget,
} from "../src/auto-apply.js";

describe("auto-apply destination policy", () => {
  it("recognizes only HTTPS URLs on explicitly supported ATS hosts", () => {
    expect(detectATS("https://boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectATS("https://job-boards.greenhouse.io/acme/jobs/123")).toBe("greenhouse");
    expect(detectATS("https://jobs.lever.co/acme/123")).toBe("lever");
    expect(detectATS("https://acme.wd5.myworkdayjobs.com/en-US/jobs/123")).toBe("workday");
    expect(detectATS("https://jobs.ashbyhq.com/acme/123")).toBe("ashby");

    expect(detectATS("http://jobs.lever.co/acme/123")).toBe("unknown");
    expect(detectATS("https://jobs.lever.co:8443/acme/123")).toBe("unknown");
    expect(detectATS("https://jobs.lever.co.attacker.example/acme/123")).toBe("unknown");
    expect(detectATS("https://attacker.example/?next=https://jobs.lever.co/acme/123")).toBe("unknown");
    expect(detectATS("https://myworkdayjobs.com.attacker.example/jobs/123")).toBe("unknown");
  });

  it("binds shared ATS URLs to the registry-owned company tenant", () => {
    expect(resolveAutoApplyTarget(
      "https://jobs.lever.co/palantir/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "Palantir",
    )).toMatchObject({ ats: "lever", companyKey: "palantir" });
    expect(resolveAutoApplyTarget(
      "https://jobs.lever.co/palantir/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "Plaid",
    )).toBeNull();

    const greenhouse = resolveAutoApplyTarget(
      "https://boards.greenhouse.io/forged-tenant/jobs/12345",
      "Stripe",
    );
    expect(greenhouse.targetUrl).toBe("https://job-boards.greenhouse.io/stripe/jobs/12345");
  });

  it("refuses an unknown ATS before loading or sending applicant data", async () => {
    await expect(autoFillApplication(
      "https://careers.example.com/jobs/123",
      "Example",
      "Engineer",
    )).resolves.toEqual(expect.objectContaining({
      ats: "unknown",
      success: false,
      screenshot: null,
      error: expect.stringMatching(/no applicant data was sent/i),
    }));

    await expect(autoFillApplication(
      "https://jobs.lever.co/palantir/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "Plaid",
      "Engineer",
    )).resolves.toEqual(expect.objectContaining({
      ats: "unknown",
      success: false,
      error: expect.stringMatching(/no applicant data was sent/i),
    }));
  });
});
