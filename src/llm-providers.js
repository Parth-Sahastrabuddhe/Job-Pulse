/**
 * llm-providers.js - provider registry for the multi-user fit check.
 *
 * SHARED MODULE: imported by the bot (src/llm-client.js) and the Next.js
 * app (web/lib/llm-ping.js and the profile page, via @bot/llm-providers).
 * Pure data: keep it import-free.
 */
export const PROVIDERS = {
  gemini:     { label: "Gemini",          wire: "gemini",    keyRequired: true,  defaultModel: "gemini-2.5-flash", baseUrl: null },
  openai:     { label: "OpenAI",          wire: "openai",    keyRequired: true,  defaultModel: "gpt-5-mini",       baseUrl: "https://api.openai.com/v1" },
  anthropic:  { label: "Anthropic",       wire: "anthropic", keyRequired: true,  defaultModel: "claude-haiku-4-5", baseUrl: null },
  groq:       { label: "Groq",            wire: "openai",    keyRequired: true,  defaultModel: "openai/gpt-oss-120b", baseUrl: "https://api.groq.com/openai/v1" },
  openrouter: { label: "OpenRouter",      wire: "openai",    keyRequired: true,  defaultModel: null,               baseUrl: "https://openrouter.ai/api/v1" },
  custom:     { label: "Custom endpoint", wire: "openai",    keyRequired: false, defaultModel: null,               baseUrl: null },
};
