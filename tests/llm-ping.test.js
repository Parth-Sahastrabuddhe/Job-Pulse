import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateProviderConfig } from "../web/lib/llm-ping.js";

// The SSRF guard itself is covered in tests/llm-client.test.js; here we only
// verify the ping layer wires it in and validates each provider shape.

describe("validateProviderConfig", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("pings gemini with the supplied key and passes on 200", async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }) });
    const r = await validateProviderConfig({ provider: "gemini", apiKey: "k", baseUrl: null, model: null });
    expect(r.ok).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
  });

  it("returns the provider error message on auth failure", async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, text: async () => "invalid api key" });
    const r = await validateProviderConfig({ provider: "openai", apiKey: "bad", baseUrl: null, model: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/401/);
  });

  it("refuses a blocked custom endpoint before any fetch", async () => {
    const r = await validateProviderConfig({ provider: "custom", apiKey: null, baseUrl: "http://192.168.1.10/v1", model: "llama3" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/endpoint/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a model for openrouter and custom", async () => {
    const r = await validateProviderConfig({ provider: "openrouter", apiKey: "k", baseUrl: null, model: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/model/i);
  });

  it("rejects unknown providers", async () => {
    const r = await validateProviderConfig({ provider: "skynet", apiKey: "k", baseUrl: null, model: "m" });
    expect(r.ok).toBe(false);
  });
});
