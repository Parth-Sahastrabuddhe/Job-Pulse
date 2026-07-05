import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGemini } from "../src/gemini.js";

function okResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  };
}

describe("runGemini options", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "global-key";
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("hi")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GEMINI_API_KEY;
  });

  it("uses the global key and default model when no options given", async () => {
    await runGemini("p");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(opts.headers["x-goog-api-key"]).toBe("global-key");
  });

  it("uses options.apiKey and options.model when provided", async () => {
    await runGemini("p", { apiKey: "user-key", model: "gemini-2.5-flash-lite" });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain("gemini-2.5-flash-lite:generateContent");
    expect(opts.headers["x-goog-api-key"]).toBe("user-key");
  });

  it("attaches .status to HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 429, text: async () => "quota" })));
    await expect(runGemini("p")).rejects.toMatchObject({ status: 429 });
  });
});
