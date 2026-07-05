import bcrypt from "bcryptjs";
import { getSession } from "@/lib/session";
import { getUserProfile, updateUserProfile, setPasswordHash } from "@/lib/db";
import { requireSameOrigin } from "@/lib/security";
import { encryptSecret, decryptSecret } from "../../../../src/crypto-util.js";
import { PROVIDERS } from "../../../../src/llm-providers.js";
import { validateProviderConfig } from "@/lib/llm-ping";
import { setLlmKeyEnc } from "@/lib/db";

const ALLOWED_COUNTRIES = new Set(["US", "CA", "GB", "DE", "IN", "ALL"]);

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Stored country is a JSON array string ('["US","CA"]') for new saves, or a
// legacy scalar ("US", "ALL"). Always return an array to the client.
function parseStoredCountry(value) {
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr) && arr.length) return arr.map(String);
    } catch {}
  }
  return value ? [String(value)] : ["US"];
}

// Validate + normalize an incoming country selection (array or scalar) into a
// JSON array string for storage. Returns { value } or { error }.
function normalizeCountryForStorage(input) {
  const arr = Array.isArray(input) ? input : [input];
  const up = [...new Set(arr.map((c) => String(c).toUpperCase()).filter(Boolean))];
  if (up.length === 0) return { error: "Select at least one country" };
  for (const c of up) {
    if (!ALLOWED_COUNTRIES.has(c)) return { error: `Invalid country: ${c}` };
  }
  if (up.includes("ALL")) return { value: JSON.stringify(["ALL"]) };
  return { value: JSON.stringify(up) };
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = getUserProfile(session.discordId);
  if (!profile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }

  return Response.json({
    roleCategories: profile.role_categories ? JSON.parse(profile.role_categories) : [],
    seniorityLevels: profile.seniority_levels ? JSON.parse(profile.seniority_levels) : [],
    companySelections: profile.company_selections ? JSON.parse(profile.company_selections) : [],
    country: parseStoredCountry(profile.country),
    requiresSponsorship: profile.requires_sponsorship === 1,
    notificationMode: profile.notification_mode || "realtime",
    quietHoursStart: profile.quiet_hours_start || "",
    quietHoursEnd: profile.quiet_hours_end || "",
    quietHoursTz: profile.quiet_hours_tz || "America/New_York",
    isActive: profile.is_active === 1,
    educationLevel: profile.education_level || "",
    hasPassword: !!profile.password_hash,
    resumeText: profile.resume_text || "",
    experienceYears: profile.experience_years ?? null,
    llmProvider: profile.llm_provider || "gemini",
    llmModel: profile.llm_model || "",
    llmBaseUrl: profile.llm_base_url || "",
    llmKeyConfigured: !!profile.llm_key_enc,
  });
}

export async function PUT(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const fields = {};
  if (body.roleCategories !== undefined) fields.role_categories = JSON.stringify(body.roleCategories);
  if (body.seniorityLevels !== undefined) fields.seniority_levels = JSON.stringify(body.seniorityLevels);
  if (body.companySelections !== undefined) fields.company_selections = JSON.stringify(body.companySelections);
  if (body.country !== undefined) {
    const result = normalizeCountryForStorage(body.country);
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    fields.country = result.value;
  }
  if (body.requiresSponsorship !== undefined) fields.requires_sponsorship = body.requiresSponsorship ? 1 : 0;
  if (body.notificationMode !== undefined) fields.notification_mode = body.notificationMode;
  if (body.quietHoursStart !== undefined || body.quietHoursEnd !== undefined) {
    const start = body.quietHoursStart ?? "";
    const end = body.quietHoursEnd ?? "";
    // Both-or-neither, HH:MM format, and start !== end (equal bounds would
    // read as a 24/7 quiet window and permanently silence realtime delivery).
    if ((start && !end) || (!start && end)) {
      return Response.json({ error: "Set both quiet-hours times, or clear both" }, { status: 400 });
    }
    if (start && (!HHMM_RE.test(start) || !HHMM_RE.test(end))) {
      return Response.json({ error: "Quiet hours must be in HH:MM format" }, { status: 400 });
    }
    if (start && start === end) {
      return Response.json({ error: "Quiet hours start and end cannot be the same time" }, { status: 400 });
    }
    fields.quiet_hours_start = start || null;
    fields.quiet_hours_end = end || null;
  }
  if (body.quietHoursTz !== undefined) {
    if (body.quietHoursTz && !isValidTimezone(body.quietHoursTz)) {
      return Response.json({ error: "Invalid timezone" }, { status: 400 });
    }
    fields.quiet_hours_tz = body.quietHoursTz;
  }
  if (body.isActive !== undefined) fields.is_active = body.isActive ? 1 : 0;
  if (body.educationLevel !== undefined) fields.education_level = body.educationLevel;

  if (body.resumeText !== undefined) {
    const resume = String(body.resumeText ?? "");
    if (resume.length > 15000) {
      return Response.json({ error: "Resume must be 15,000 characters or fewer" }, { status: 400 });
    }
    fields.resume_text = resume.trim() ? resume : null;
  }
  if (body.experienceYears !== undefined) {
    if (body.experienceYears === null || body.experienceYears === "") {
      fields.experience_years = null;
    } else {
      const years = Number(body.experienceYears);
      if (!Number.isFinite(years) || years < 0 || years > 50) {
        return Response.json({ error: "Experience years must be between 0 and 50" }, { status: 400 });
      }
      fields.experience_years = years;
    }
  }
  if (body.llmProvider !== undefined) {
    if (!PROVIDERS[body.llmProvider]) {
      return Response.json({ error: "Invalid LLM provider" }, { status: 400 });
    }
    fields.llm_provider = body.llmProvider;
  }
  if (body.llmModel !== undefined) {
    const model = String(body.llmModel ?? "").trim();
    if (model.length > 100) return Response.json({ error: "Model name too long" }, { status: 400 });
    fields.llm_model = model || null;
  }
  if (body.llmBaseUrl !== undefined) {
    const url = String(body.llmBaseUrl ?? "").trim();
    if (url.length > 300) return Response.json({ error: "Endpoint URL too long" }, { status: 400 });
    fields.llm_base_url = url || null;
  }

  // Write-only LLM key handling + save-time provider validation.
  const secret = process.env.LLM_KEY_SECRET;
  const currentProfile = getUserProfile(session.discordId);
  const effective = {
    provider: fields.llm_provider ?? currentProfile.llm_provider ?? "gemini",
    baseUrl: fields.llm_base_url !== undefined ? fields.llm_base_url : currentProfile.llm_base_url,
    model: fields.llm_model !== undefined ? fields.llm_model : currentProfile.llm_model,
  };
  const providerConfigChanged =
    fields.llm_provider !== undefined || fields.llm_model !== undefined || fields.llm_base_url !== undefined;

  if (body.llmKey !== undefined && body.llmKey === "") {
    setLlmKeyEnc(session.discordId, null);
  } else if (body.llmKey) {
    if (!secret) return Response.json({ error: "Server is missing LLM_KEY_SECRET" }, { status: 500 });
    const check = await validateProviderConfig({ ...effective, apiKey: String(body.llmKey) });
    if (!check.ok) return Response.json({ error: `Provider check failed: ${check.error}` }, { status: 400 });
    setLlmKeyEnc(session.discordId, encryptSecret(String(body.llmKey), secret));
  } else if (providerConfigChanged && currentProfile.llm_key_enc) {
    // Provider/model/endpoint changed without a new key: re-ping with the stored key.
    if (!secret) return Response.json({ error: "Server is missing LLM_KEY_SECRET" }, { status: 500 });
    let storedKey = null;
    try { storedKey = decryptSecret(currentProfile.llm_key_enc, secret); } catch {}
    const check = await validateProviderConfig({ ...effective, apiKey: storedKey });
    if (!check.ok) return Response.json({ error: `Provider check failed: ${check.error}` }, { status: 400 });
  } else if (providerConfigChanged && effective.provider === "custom" && effective.baseUrl) {
    // Keyless custom endpoint: still validate reachability + SSRF.
    const check = await validateProviderConfig({ ...effective, apiKey: null });
    if (!check.ok) return Response.json({ error: `Provider check failed: ${check.error}` }, { status: 400 });
  }

  // Handle password setting/changing
  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }
    const hash = await bcrypt.hash(body.newPassword, 10);
    setPasswordHash(session.discordId, hash);
  }

  try {
    if (Object.keys(fields).length > 0) {
      updateUserProfile(session.discordId, fields);
    }
  } catch (err) {
    console.error("[profile] Update error:", err);
    return Response.json({ error: "Failed to update profile" }, { status: 500 });
  }

  return Response.json({ updated: true });
}
