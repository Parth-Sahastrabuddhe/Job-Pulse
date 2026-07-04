/**
 * mu-fit-check.js - multi-user fit check: prompt, orchestration, formatting.
 *
 * The owner pipeline (tailor.js + resume/prompt.md) is separate and untouched;
 * this module is fully parameterized from user_profiles columns. Output
 * contract (FIT ASSESSMENT block + FIT_SCORES line) matches the owner path so
 * fit-check-core.js parses both.
 */
import { decryptSecret } from "./crypto-util.js";
import { parseFitCheckOutput } from "./fit-check-core.js";
import { LlmError, PROVIDERS, runLLM } from "./llm-client.js";

const RESUME_MAX_CHARS = 15000;
const JD_MAX_CHARS = 12000;
const REPLY_ASSESSMENT_MAX = 1300;

function parseJsonArray(text, fallback) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) && v.length ? v : fallback;
  } catch {
    return fallback;
  }
}

function candidateFacts(profile) {
  const lines = [];
  if (profile.experience_years != null) lines.push(`- Industry experience: ${profile.experience_years} years`);
  if (profile.education_level) lines.push(`- Highest education: ${profile.education_level}`);
  lines.push(`- Requires visa sponsorship: ${profile.requires_sponsorship ? "YES (H1B or similar)" : "no"}`);
  const roles = parseJsonArray(profile.role_categories, ["software_engineer"]).join(", ");
  const seniority = parseJsonArray(profile.seniority_levels, ["entry", "mid"]).join(", ");
  lines.push(`- Target roles: ${roles}`);
  lines.push(`- Target seniority: ${seniority}`);
  return lines.join("\n");
}

export function buildMuFitPrompt(profile, job, description) {
  const resume = String(profile.resume_text ?? "").slice(0, RESUME_MAX_CHARS);
  const jd = String(description ?? "").slice(0, JD_MAX_CHARS);
  const sponsorshipRule = profile.requires_sponsorship
    ? `2. **Visa sponsorship check**: The candidate requires sponsorship. Look for phrases like "no sponsorship", "must be authorized to work without sponsorship", "US citizen or permanent resident required", "will not sponsor". If found, set Should Apply to NO, explain why, and set score to 0. If the JD is silent on sponsorship or offers it, note that positively.`
    : `2. **Work authorization**: The candidate does NOT need visa sponsorship; skip sponsorship analysis entirely.`;

  return `You are a rigorous, honest job-fit assessor. No flattery; the candidate needs the truth.

## Candidate facts
${candidateFacts(profile)}

## Candidate resume (plain text)
${resume}

## Job
- Title: ${job.title ?? ""}
- Company: ${job.source_label ?? job.sourceLabel ?? ""}
- Location: ${job.location ?? ""}
- URL: ${job.url ?? ""}

## Job description
${jd}

## Analysis required (include in Reasoning)
1. **Years of experience check**: If the JD specifies minimum years, compare against the candidate facts above. Flag if underqualified.
${sponsorshipRule}
3. **Stack fit**: Infer the candidate's primary stack from the resume. If the JD's primary stack differs, note the gap but acknowledge transferability when the systems concepts align. Consider company context (banks and fintech lean enterprise stacks; startups are language-flexible).
4. **ATS score calculation**, weighted:
   - 40% technical skills keyword match (languages, frameworks, tools in JD vs resume)
   - 25% experience type match (backend/distributed/APIs vs what the JD asks)
   - 20% domain and industry alignment
   - 15% level alignment (years, seniority signals)
   Show the breakdown in the reasoning.

## Output format (exact)
Output a fit assessment block delimited by lines of ═ characters, containing the header FIT ASSESSMENT, your reasoning, and a line "Should Apply: YES" or "Should Apply: STRETCH" or "Should Apply: NO".

After the closing ═══ line, output exactly one line (valid JSON, no markdown):
FIT_SCORES:{"score":82,"skills":85,"experience":75,"domain":90,"level":78}

Where score = skills*0.4 + experience*0.25 + domain*0.2 + level*0.15, rounded; each component is 0-100. If sponsorship is blocked, score is 0. Output nothing after the FIT_SCORES line.`;
}

export function isFitConfigured(profile) {
  if (!profile || !String(profile.resume_text ?? "").trim()) return false;
  const provider = PROVIDERS[profile.llm_provider || "gemini"];
  if (!provider) return false;
  if (provider.keyRequired && !profile.llm_key_enc) return false;
  if (!provider.defaultModel && !profile.llm_model) return false;
  if (profile.llm_provider === "custom" && !profile.llm_base_url) return false;
  return true;
}

export async function runUserFitCheck(profile, job, description) {
  const providerKey = profile.llm_provider || "gemini";
  let apiKey = null;
  if (profile.llm_key_enc) {
    const secret = process.env.LLM_KEY_SECRET;
    if (!secret) throw new LlmError("auth", "LLM_KEY_SECRET is not configured on the server");
    try {
      apiKey = decryptSecret(profile.llm_key_enc, secret);
    } catch {
      throw new LlmError("auth", "Stored key could not be decrypted");
    }
  }
  const prompt = buildMuFitPrompt(profile, job, description);
  const output = await runLLM(prompt, {
    provider: providerKey,
    apiKey,
    baseUrl: profile.llm_base_url,
    model: profile.llm_model,
  });
  const result = parseFitCheckOutput(output);
  if (result.shouldApply === "UNKNOWN" && result.fitScore == null) {
    throw new LlmError("bad_response", "Model output did not match the fit-check contract");
  }
  return result;
}

export function formatFitReply(result, { provider, model, cachedAt }) {
  const emoji = result.shouldApply === "YES" ? "✅" : result.shouldApply === "STRETCH" ? "⚠️" : "❌";
  let msg = `${emoji} **Fit Assessment: ${result.shouldApply}**`;
  if (result.fitScore != null) {
    const s = result.fitScores || {};
    const circle = result.fitScore >= 80 ? ":green_circle:" : result.fitScore >= 60 ? ":yellow_circle:" : ":red_circle:";
    msg += `\n${circle} **Fit Score: ${result.fitScore}/100** (Skills ${s.skills ?? "?"} | Exp ${s.experience ?? "?"} | Domain ${s.domain ?? "?"} | Level ${s.level ?? "?"})`;
  }
  if (result.fitAssessment) {
    const trimmed = result.fitAssessment.length > REPLY_ASSESSMENT_MAX
      ? result.fitAssessment.slice(0, REPLY_ASSESSMENT_MAX) + "..."
      : result.fitAssessment;
    msg += `\n\`\`\`\n${trimmed}\n\`\`\``;
  }
  const providerLabel = PROVIDERS[provider]?.label ?? provider;
  const modelLabel = model || PROVIDERS[provider]?.defaultModel || "";
  msg += `\n-# Powered by ${providerLabel} / ${modelLabel} (your ${provider === "custom" ? "endpoint" : "key"})`;
  if (cachedAt) {
    msg += ` - cached from ${String(cachedAt).slice(0, 10)}`;
  }
  return msg.slice(0, 2000);
}

export function mapLlmErrorToMessage(err) {
  const kind = err instanceof LlmError ? err.kind : "transient";
  switch (kind) {
    case "auth":
      return "Your LLM key or model was rejected. Check your Fit Check settings on the dashboard.";
    case "quota":
      return "Your LLM provider says quota or rate limit exceeded. Try again later.";
    case "blocked_url":
      return "Your endpoint is unreachable or not allowed. Check it on the dashboard.";
    case "bad_response":
      return "Got an unusable response from the model. Try again.";
    default:
      return "Your LLM did not respond. Try again in a minute.";
  }
}
