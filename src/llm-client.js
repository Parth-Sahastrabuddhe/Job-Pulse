/**
 * llm-client.js - provider dispatch for the multi-user fit check.
 *
 * Every call is bring-your-own: the user's key or the user's endpoint.
 * There is NO fallback to the owner's GEMINI_API_KEY, NO fallback between
 * providers, and NO Claude CLI here. A failed call surfaces a typed LlmError.
 */
import { runGemini } from "./gemini.js";
import { PROVIDERS } from "./llm-providers.js";
import { assertSafeUrl } from "./ssrf-guard.js";

// Re-export so bot-side callers (mu-fit-check.js) import everything from here.
export { PROVIDERS };

export class LlmError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = "LlmError";
    this.kind = kind; // auth | quota | transient | bad_response | blocked_url
    this.status = status;
  }
}

const MAX_OUTPUT_TOKENS = 4096;
const TIMEOUT_MS = 60000;

function kindForStatus(status) {
  if (status === 429) return "quota";
  if (status === 400 || status === 401 || status === 403 || status === 404) return "auth";
  return "transient";
}

async function readBodySnippet(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}

async function doFetch(url, options) {
  try {
    // redirect: "error" so a malicious endpoint cannot bounce us to an
    // internal address after the SSRF check passed.
    return await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError("transient", `Network error: ${err.message}`);
  }
}

async function runOpenAiCompatible(prompt, { apiKey, baseUrl, model }) {
  const body = { model, messages: [{ role: "user", content: prompt }] };
  if (model.startsWith("gpt-5")) {
    // gpt-5 family rejects max_tokens and non-default temperature.
    body.max_completion_tokens = MAX_OUTPUT_TOKENS;
  } else {
    body.max_tokens = MAX_OUTPUT_TOKENS;
    body.temperature = 0.3;
  }
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await doFetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new LlmError(kindForStatus(response.status), `Provider error (${response.status}): ${await readBodySnippet(response)}`, response.status);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new LlmError("bad_response", "Empty response from model");
  return text;
}

async function runAnthropic(prompt, { apiKey, model }) {
  const response = await doFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new LlmError(kindForStatus(response.status), `Provider error (${response.status}): ${await readBodySnippet(response)}`, response.status);
  }
  const data = await response.json();
  if (data.stop_reason === "refusal") {
    throw new LlmError("bad_response", "The model declined this request");
  }
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  if (!text) throw new LlmError("bad_response", "Empty response from model");
  return text;
}

async function runGeminiWire(prompt, { apiKey, model }) {
  try {
    return await runGemini(prompt, { apiKey, model, maxOutputTokens: MAX_OUTPUT_TOKENS });
  } catch (err) {
    if (typeof err.status === "number") {
      throw new LlmError(kindForStatus(err.status), err.message, err.status);
    }
    if (/empty response/i.test(err.message)) {
      throw new LlmError("bad_response", err.message);
    }
    throw new LlmError("transient", err.message);
  }
}

export async function runLLM(prompt, config) {
  const provider = PROVIDERS[config.provider];
  if (!provider) throw new LlmError("auth", `Unknown provider: ${config.provider}`);
  if (provider.keyRequired && !config.apiKey) {
    throw new LlmError("auth", "No API key configured for this provider");
  }
  const model = config.model || provider.defaultModel;
  if (!model) throw new LlmError("auth", "No model configured for this provider");

  if (config.provider === "custom") {
    if (!config.baseUrl) throw new LlmError("blocked_url", "No endpoint configured");
    try {
      await assertSafeUrl(config.baseUrl); // call-time re-check closes the DNS-rebinding window
    } catch (err) {
      throw new LlmError("blocked_url", err.message);
    }
    return runOpenAiCompatible(prompt, { apiKey: config.apiKey, baseUrl: config.baseUrl, model });
  }
  if (provider.wire === "gemini") return runGeminiWire(prompt, { apiKey: config.apiKey, model });
  if (provider.wire === "anthropic") return runAnthropic(prompt, { apiKey: config.apiKey, model });
  return runOpenAiCompatible(prompt, { apiKey: config.apiKey, baseUrl: provider.baseUrl, model });
}
