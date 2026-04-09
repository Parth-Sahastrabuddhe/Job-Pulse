import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "./config.js";
import { fetchWithTimeout } from "./sources/shared.js";

export async function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (key) return key;

  // Try reading from .env file directly
  try {
    const envContent = await fs.readFile(path.join(PROJECT_ROOT, ".env"), "utf8");
    const match = envContent.match(/GEMINI_API_KEY=(.+)/);
    if (match) return match[1].trim();
  } catch {}

  return null;
}

export async function runGemini(prompt, options = {}) {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set in .env");
  }

  const temperature = options.temperature ?? 0.3;
  const maxOutputTokens = options.maxOutputTokens ?? 8192;

  const response = await fetchWithTimeout(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens
        }
      })
    },
    60000
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${error.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return text;
}
