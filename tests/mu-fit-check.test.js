import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMuFitPrompt, formatFitReply, isFitConfigured, mapLlmErrorToMessage, runUserFitCheck } from "../src/mu-fit-check.js";
import { LlmError } from "../src/llm-client.js";
import { encryptSecret } from "../src/crypto-util.js";

const runLLMMock = vi.hoisted(() => vi.fn());

vi.mock("../src/llm-client.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runLLM: runLLMMock };
});

const baseProfile = {
  first_name: "Test",
  resume_text: "3 years of Node.js and SQL.",
  experience_years: 3.5,
  requires_sponsorship: 1,
  education_level: "masters",
  role_categories: '["software_engineer"]',
  seniority_levels: '["entry","mid"]',
  llm_provider: "gemini",
  llm_key_enc: "v1:a:b:c",
  llm_base_url: null,
  llm_model: null,
};
const job = { source_label: "Stripe", title: "Backend Engineer", location: "NYC", url: "https://x.test/1" };

describe("buildMuFitPrompt", () => {
  it("injects candidate facts, resume, and job fields", () => {
    const p = buildMuFitPrompt(baseProfile, job, "You will build APIs.");
    expect(p).toContain("3.5 years");
    expect(p).toContain("masters");
    expect(p).toContain("3 years of Node.js and SQL.");
    expect(p).toContain("Stripe");
    expect(p).toContain("Backend Engineer");
    expect(p).toContain("You will build APIs.");
    expect(p).toContain("FIT_SCORES:");
  });

  it("includes the sponsorship rule only when required", () => {
    const withSponsor = buildMuFitPrompt(baseProfile, job, "jd");
    expect(withSponsor).toMatch(/sponsorship/i);
    const noSponsor = buildMuFitPrompt({ ...baseProfile, requires_sponsorship: 0 }, job, "jd");
    expect(noSponsor).not.toMatch(/requires sponsorship/i);
  });

  it("truncates oversized resume and JD", () => {
    const p = buildMuFitPrompt({ ...baseProfile, resume_text: "r".repeat(20000) }, job, "j".repeat(20000));
    expect(p.length).toBeLessThan(40000);
    expect(p).not.toContain("r".repeat(15001));
    expect(p).not.toContain("j".repeat(12001));
  });
});

describe("isFitConfigured", () => {
  it("hosted provider needs resume + key", () => {
    expect(isFitConfigured(baseProfile)).toBe(true);
    expect(isFitConfigured({ ...baseProfile, resume_text: "" })).toBe(false);
    expect(isFitConfigured({ ...baseProfile, llm_key_enc: null })).toBe(false);
  });

  it("custom provider needs base url + model, key optional", () => {
    const custom = { ...baseProfile, llm_provider: "custom", llm_key_enc: null, llm_base_url: "http://x.test/v1", llm_model: "llama3" };
    expect(isFitConfigured(custom)).toBe(true);
    expect(isFitConfigured({ ...custom, llm_base_url: null })).toBe(false);
    expect(isFitConfigured({ ...custom, llm_model: null })).toBe(false);
  });

  it("openrouter needs an explicit model", () => {
    const or = { ...baseProfile, llm_provider: "openrouter" };
    expect(isFitConfigured(or)).toBe(false);
    expect(isFitConfigured({ ...or, llm_model: "meta-llama/llama-3.3-70b-instruct" })).toBe(true);
  });
});

describe("formatFitReply", () => {
  const result = { fitScore: 82, fitScores: { skills: 85, experience: 75, domain: 90, level: 78 }, shouldApply: "YES", fitAssessment: "block" };

  it("includes verdict, score breakdown, and provider footer", () => {
    const msg = formatFitReply(result, { provider: "gemini", model: "gemini-2.5-flash", cachedAt: null });
    expect(msg).toContain("Fit Assessment: YES");
    expect(msg).toContain("82/100");
    expect(msg).toContain("Skills 85");
    expect(msg).toContain("gemini-2.5-flash");
  });

  it("marks cached replies", () => {
    const msg = formatFitReply(result, { provider: "gemini", model: "gemini-2.5-flash", cachedAt: "2026-07-04T10:00:00Z" });
    expect(msg.toLowerCase()).toContain("cached");
  });

  it("stays under the Discord 2000-char limit with a huge assessment", () => {
    const msg = formatFitReply({ ...result, fitAssessment: "x".repeat(5000) }, { provider: "gemini", model: "m", cachedAt: null });
    expect(msg.length).toBeLessThanOrEqual(2000);
  });
});

describe("mapLlmErrorToMessage", () => {
  it.each([
    ["auth", /rejected|settings/i],
    ["quota", /quota|rate limit/i],
    ["transient", /respond|try again/i],
    ["blocked_url", /endpoint/i],
    ["bad_response", /unusable|try again/i],
  ])("maps %s to an actionable message", (kind, re) => {
    expect(mapLlmErrorToMessage(new LlmError(kind, "x"))).toMatch(re);
  });

  it("maps unknown errors to the transient message", () => {
    expect(mapLlmErrorToMessage(new Error("boom"))).toMatch(/try again/i);
  });
});

describe("runUserFitCheck", () => {
  const SECRET = "0123456789abcdef0123456789abcdef";

  afterEach(() => {
    delete process.env.LLM_KEY_SECRET;
    runLLMMock.mockReset();
  });

  it("throws auth when LLM_KEY_SECRET is missing but a key is stored", async () => {
    delete process.env.LLM_KEY_SECRET;
    await expect(runUserFitCheck(baseProfile, job, "jd")).rejects.toMatchObject({ kind: "auth" });
    expect(runLLMMock).not.toHaveBeenCalled();
  });

  it("throws auth when the stored key cannot be decrypted", async () => {
    process.env.LLM_KEY_SECRET = SECRET;
    await expect(
      runUserFitCheck({ ...baseProfile, llm_key_enc: "v1:AAAA:BBBB:CCCC" }, job, "jd")
    ).rejects.toMatchObject({ kind: "auth" });
    expect(runLLMMock).not.toHaveBeenCalled();
  });

  it("throws bad_response when the model output has no contract", async () => {
    process.env.LLM_KEY_SECRET = SECRET;
    runLLMMock.mockResolvedValue("nothing usable here");
    const profile = { ...baseProfile, llm_key_enc: encryptSecret("user-key", SECRET) };
    await expect(runUserFitCheck(profile, job, "jd")).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("passes the decrypted key and profile config to runLLM and returns the parsed result", async () => {
    process.env.LLM_KEY_SECRET = SECRET;
    runLLMMock.mockResolvedValue('═══\nFIT ASSESSMENT\nShould Apply: YES\n═══\nreasoning\n═══\nFIT_SCORES:{"score":82,"skills":85,"experience":75,"domain":90,"level":78}');
    const profile = { ...baseProfile, llm_key_enc: encryptSecret("user-key", SECRET) };
    const result = await runUserFitCheck(profile, job, "jd");
    expect(result.shouldApply).toBe("YES");
    expect(result.fitScore).toBe(82);
    expect(runLLMMock).toHaveBeenCalledWith(expect.any(String), {
      provider: "gemini",
      apiKey: "user-key",
      baseUrl: null,
      model: null,
    });
  });
});
