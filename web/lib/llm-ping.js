/**
 * llm-ping.js - save-time validation of a user's LLM provider config.
 *
 * Makes ONE ~1-token live call with the user's own key/endpoint so typos
 * fail at setup time instead of at first click. SSRF protection and the
 * provider registry are the shared modules in src/ (see spec decision 10).
 */
import { safeFetch } from "../../src/ssrf-guard.js";
import { PROVIDERS } from "../../src/llm-providers.js";

const PING_TIMEOUT_MS = 10000;
const PING_MAX_RESPONSE_BYTES = 64 * 1024;

async function ping(url, options, { fetchImpl = fetch, policy } = {}) {
  const requestOptions = {
    ...options,
    redirect: policy ? "follow" : "error",
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  };
  const response = policy
    ? await fetchImpl(url, requestOptions, policy)
    : await fetchImpl(url, requestOptions);
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch {}
    throw new Error(`Provider returned ${response.status}: ${detail}`);
  }
}

export async function validateProviderConfig(
  { provider, apiKey, baseUrl, model },
  { customFetch = safeFetch } = {},
) {
  try {
    const meta = PROVIDERS[provider];
    if (!meta) return { ok: false, error: `Unknown provider: ${provider}` };
    const resolvedModel = model || meta.defaultModel;
    if (!resolvedModel) return { ok: false, error: "A model name is required for this provider" };
    if (meta.keyRequired && !apiKey) return { ok: false, error: "An API key is required for this provider" };

    if (provider === "gemini") {
      await ping(`https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 1 } }),
      });
      return { ok: true };
    }
    if (provider === "anthropic") {
      await ping("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: resolvedModel, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      });
      return { ok: true };
    }

    // OpenAI-compatible: openai / groq / openrouter / custom
    let base = meta.baseUrl;
    if (provider === "custom") {
      if (!baseUrl) return { ok: false, error: "An endpoint URL is required for the custom provider" };
      let parsed;
      try {
        parsed = new URL(baseUrl);
      } catch {
        return { ok: false, error: "The custom endpoint must be a valid HTTPS URL" };
      }
      if (parsed.protocol !== "https:") {
        return { ok: false, error: "The custom endpoint must use HTTPS" };
      }
      base = parsed.toString();
    }
    const body = { model: resolvedModel, messages: [{ role: "user", content: "ping" }] };
    if (resolvedModel.startsWith("gpt-5")) body.max_completion_tokens = 1;
    else body.max_tokens = 1;
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const endpoint = `${base.replace(/\/+$/, "")}/chat/completions`;
    if (provider === "custom") {
      // Validation and transport must be one operation: resolving first and
      // then calling ordinary fetch leaves a DNS-rebinding/redirect TOCTOU gap.
      await ping(endpoint, { method: "POST", headers, body: JSON.stringify(body) }, {
        fetchImpl: customFetch,
        policy: {
          requireHttps: true,
          allowedContentTypes: ["application/json", "text/plain"],
          maxResponseBytes: PING_MAX_RESPONSE_BYTES,
          timeoutMs: PING_TIMEOUT_MS,
          maxRedirects: 2,
        },
      });
    } else {
      await ping(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.blocked ? "Your endpoint is unreachable or not allowed" : err.message };
  }
}
