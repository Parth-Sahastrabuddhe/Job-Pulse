import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError, PROVIDERS, runLLM } from "../src/llm-client.js";
import { assertSafeUrl, isBlockedIp } from "../src/ssrf-guard.js";

function openAiOk(text) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) };
}
function anthropicOk(text) {
  return { ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }) };
}
function geminiOk(text) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2607:f8b0::1"])("allows %s", (ip) =>
    expect(isBlockedIp(ip)).toBe(false));
});

describe("assertSafeUrl", () => {
  it("rejects literal metadata IP without any fetch", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest")).rejects.toMatchObject({ blocked: true });
  });
  it("rejects non-http schemes and credentials", async () => {
    await expect(assertSafeUrl("ftp://example.com")).rejects.toMatchObject({ blocked: true });
    await expect(assertSafeUrl("http://user:pw@example.com")).rejects.toMatchObject({ blocked: true });
  });
  it("rejects localhost by resolution", async () => {
    await expect(assertSafeUrl("http://localhost:11434")).rejects.toMatchObject({ blocked: true });
  });
});

describe("runLLM dispatch", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("routes gemini through the native endpoint with the user key", async () => {
    fetch.mockResolvedValue(geminiOk("out"));
    const out = await runLLM("p", { provider: "gemini", apiKey: "uk", model: null, baseUrl: null });
    expect(out).toBe("out");
    expect(fetch.mock.calls[0][0]).toContain("generativelanguage.googleapis.com");
    expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("uk");
  });

  it("routes openai with Bearer auth and max_completion_tokens for gpt-5 models", async () => {
    fetch.mockResolvedValue(openAiOk("out"));
    await runLLM("p", { provider: "openai", apiKey: "sk", model: null, baseUrl: null });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(opts.headers.Authorization).toBe("Bearer sk");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe(PROVIDERS.openai.defaultModel);
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.temperature).toBeUndefined();
  });

  it("routes groq with max_tokens and temperature", async () => {
    fetch.mockResolvedValue(openAiOk("out"));
    await runLLM("p", { provider: "groq", apiKey: "gk", model: null, baseUrl: null });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.3);
  });

  it("routes anthropic natively with version header", async () => {
    fetch.mockResolvedValue(anthropicOk("out"));
    await runLLM("p", { provider: "anthropic", apiKey: "ak", model: null, baseUrl: null });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("ak");
    expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("maps anthropic refusal stop_reason to bad_response", async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ stop_reason: "refusal", content: [] }) });
    await expect(runLLM("p", { provider: "anthropic", apiKey: "ak", model: null, baseUrl: null }))
      .rejects.toMatchObject({ kind: "bad_response" });
  });

  it("omits the auth header for keyless custom endpoints", async () => {
    fetch.mockResolvedValue(openAiOk("out"));
    await runLLM("p", { provider: "custom", apiKey: null, model: "llama3", baseUrl: "http://example.com/v1" });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("blocks custom endpoints on private ranges before any fetch", async () => {
    await expect(runLLM("p", { provider: "custom", apiKey: null, model: "m", baseUrl: "http://192.168.1.5:11434/v1" }))
      .rejects.toMatchObject({ kind: "blocked_url" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a key for hosted providers and a model for openrouter/custom", async () => {
    await expect(runLLM("p", { provider: "openai", apiKey: null, model: null, baseUrl: null }))
      .rejects.toMatchObject({ kind: "auth" });
    await expect(runLLM("p", { provider: "openrouter", apiKey: "k", model: null, baseUrl: null }))
      .rejects.toMatchObject({ kind: "auth" });
  });

  it("normalizes HTTP statuses to error kinds", async () => {
    for (const [status, kind] of [[401, "auth"], [403, "auth"], [404, "auth"], [400, "auth"], [429, "quota"], [500, "transient"], [529, "transient"]]) {
      fetch.mockResolvedValue({ ok: false, status, text: async () => "err" });
      await expect(runLLM("p", { provider: "groq", apiKey: "k", model: "m", baseUrl: null }))
        .rejects.toMatchObject({ kind, status });
    }
  });

  it("maps network failures to transient", async () => {
    fetch.mockRejectedValue(new TypeError("fetch failed"));
    await expect(runLLM("p", { provider: "groq", apiKey: "k", model: "m", baseUrl: null }))
      .rejects.toMatchObject({ kind: "transient" });
  });

  it("maps empty completions to bad_response", async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [] }) });
    await expect(runLLM("p", { provider: "groq", apiKey: "k", model: "m", baseUrl: null }))
      .rejects.toMatchObject({ kind: "bad_response" });
  });
});
