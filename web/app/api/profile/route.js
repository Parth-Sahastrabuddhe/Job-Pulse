import bcrypt from "bcryptjs";
import { clearSession, getSession } from "@/lib/session";
import { consumeRateLimit, getUserProfile, updateUserProfile, setPasswordHash, isFeatureEnabled } from "@/lib/db";
import {
  bcryptPasswordProblem,
  jsonBodyError,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";
import { ROLE_SECTIONS } from "@/lib/role-taxonomy.mjs";
import { encryptSecret, decryptSecret } from "../../../../src/crypto-util.js";
import { PROVIDERS } from "../../../../src/llm-providers.js";
import { validateProviderConfig } from "@/lib/llm-ping";
import { setLlmKeyEnc } from "@/lib/db";

const ALLOWED_COUNTRIES = new Set(["US", "CA", "GB", "DE", "IN", "ALL"]);
const ALLOWED_ROLE_CATEGORIES = new Set(
  Object.values(ROLE_SECTIONS).flatMap((section) => section.categories.map((category) => category.value))
);
const ALLOWED_SENIORITY_LEVELS = new Set(["intern", "entry", "mid", "senior", "staff"]);
const ALLOWED_EDUCATION_LEVELS = new Set(["", "bachelors", "masters", "phd"]);
const ALLOWED_NOTIFICATION_MODES = new Set(["realtime", "daily", "weekly"]);
const COMPANY_KEY_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const PROFILE_WINDOW_MS = 60 * 60 * 1000;

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
  if (arr.length > ALLOWED_COUNTRIES.size) return { error: "Too many countries selected" };
  const up = [...new Set(arr.map((c) => String(c).toUpperCase()).filter(Boolean))];
  if (up.length === 0) return { error: "Select at least one country" };
  for (const c of up) {
    if (!ALLOWED_COUNTRIES.has(c)) return { error: `Invalid country: ${c}` };
  }
  if (up.includes("ALL")) return { value: JSON.stringify(["ALL"]) };
  return { value: JSON.stringify(up) };
}

function normalizeStringSelection(input, { name, allowed, maxItems, pattern } = {}) {
  if (!Array.isArray(input)) return { error: `${name} must be an array` };
  if (input.length > maxItems) return { error: `Too many ${name.toLowerCase()} selected` };
  const values = [];
  const seen = new Set();
  for (const item of input) {
    if (typeof item !== "string" || item.length === 0 || item.length > 80) {
      return { error: `Invalid ${name.toLowerCase()} selection` };
    }
    if (allowed && !allowed.has(item)) return { error: `Invalid ${name.toLowerCase()}: ${item}` };
    if (pattern && !pattern.test(item)) return { error: `Invalid ${name.toLowerCase()} selection` };
    if (!seen.has(item)) {
      seen.add(item);
      values.push(item);
    }
  }
  return { value: values };
}

function consumeProfileLimit(session, action, limit) {
  return consumeRateLimit({
    scope: `profile-${action}`,
    keyHash: opaqueRateLimitKey(session.discordId),
    limit,
    windowMs: PROFILE_WINDOW_MS,
  });
}

function rateLimitResponse(result) {
  return Response.json(
    { error: "Too many profile changes. Try again later." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
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

  const fitCheckEnabled = isFeatureEnabled("mu_fit_check");
  const response = {
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
    fitCheckEnabled,
  };
  if (fitCheckEnabled) Object.assign(response, {
    resumeText: profile.resume_text || "",
    experienceYears: profile.experience_years ?? null,
    llmProvider: profile.llm_provider || "gemini",
    llmModel: profile.llm_model || "",
    llmBaseUrl: profile.llm_base_url || "",
    llmKeyConfigured: !!profile.llm_key_enc,
  });
  return Response.json(response);
}

export async function PUT(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const currentProfile = getUserProfile(session.discordId);
  if (!currentProfile) {
    return Response.json({ error: "Profile not found" }, { status: 404 });
  }
  const fitCheckEnabled = isFeatureEnabled("mu_fit_check");

  let profileLimit;
  try {
    profileLimit = consumeProfileLimit(session, "update", 60);
  } catch (error) {
    console.error("[profile] Rate limiter error:", error);
    return Response.json({ error: "Profile updates are temporarily unavailable" }, { status: 503 });
  }
  if (!profileLimit.allowed) return rateLimitResponse(profileLimit);

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 64 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const fields = {};
  if (body.roleCategories !== undefined) {
    const result = normalizeStringSelection(body.roleCategories, {
      name: "Role category", allowed: ALLOWED_ROLE_CATEGORIES, maxItems: ALLOWED_ROLE_CATEGORIES.size,
    });
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    fields.role_categories = JSON.stringify(result.value);
  }
  if (body.seniorityLevels !== undefined) {
    const result = normalizeStringSelection(body.seniorityLevels, {
      name: "Seniority level", allowed: ALLOWED_SENIORITY_LEVELS, maxItems: ALLOWED_SENIORITY_LEVELS.size,
    });
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    fields.seniority_levels = JSON.stringify(result.value);
  }
  if (body.companySelections !== undefined) {
    const result = normalizeStringSelection(body.companySelections, {
      name: "Company", maxItems: 250, pattern: COMPANY_KEY_RE,
    });
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    fields.company_selections = JSON.stringify(result.value.includes("all") ? ["all"] : result.value);
  }
  if (body.country !== undefined) {
    const result = normalizeCountryForStorage(body.country);
    if (result.error) return Response.json({ error: result.error }, { status: 400 });
    fields.country = result.value;
  }
  if (body.requiresSponsorship !== undefined) {
    if (typeof body.requiresSponsorship !== "boolean") {
      return Response.json({ error: "Sponsorship preference must be a boolean" }, { status: 400 });
    }
    fields.requires_sponsorship = body.requiresSponsorship ? 1 : 0;
  }
  if (body.notificationMode !== undefined) {
    if (!ALLOWED_NOTIFICATION_MODES.has(body.notificationMode)) {
      return Response.json({ error: "Invalid notification mode" }, { status: 400 });
    }
    fields.notification_mode = body.notificationMode;
  }
  if (body.quietHoursStart !== undefined || body.quietHoursEnd !== undefined) {
    const start = body.quietHoursStart ?? "";
    const end = body.quietHoursEnd ?? "";
    if (typeof start !== "string" || typeof end !== "string") {
      return Response.json({ error: "Quiet hours must be text" }, { status: 400 });
    }
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
    if (typeof body.quietHoursTz !== "string" || body.quietHoursTz.length > 100 ||
        (body.quietHoursTz && !isValidTimezone(body.quietHoursTz))) {
      return Response.json({ error: "Invalid timezone" }, { status: 400 });
    }
    fields.quiet_hours_tz = body.quietHoursTz;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      return Response.json({ error: "Active preference must be a boolean" }, { status: 400 });
    }
    fields.is_active = body.isActive ? 1 : 0;
  }
  if (body.educationLevel !== undefined) {
    if (!ALLOWED_EDUCATION_LEVELS.has(body.educationLevel)) {
      return Response.json({ error: "Invalid education level" }, { status: 400 });
    }
    fields.education_level = body.educationLevel;
  }

  const fitCheckFields = ["resumeText", "experienceYears", "llmProvider", "llmModel", "llmBaseUrl", "llmKey"];
  if (!fitCheckEnabled && fitCheckFields.some((field) => body[field] !== undefined)) {
    return Response.json({ error: "Fit Check is not available yet" }, { status: 404 });
  }

  if (body.resumeText !== undefined) {
    if (body.resumeText !== null && typeof body.resumeText !== "string") {
      return Response.json({ error: "Resume must be text" }, { status: 400 });
    }
    const resume = body.resumeText ?? "";
    if (resume.length > 15000) {
      return Response.json({ error: "Resume must be 15,000 characters or fewer" }, { status: 400 });
    }
    fields.resume_text = resume.trim() ? resume : null;
  }
  if (body.experienceYears !== undefined) {
    if (body.experienceYears === null || body.experienceYears === "") {
      fields.experience_years = null;
    } else {
      if (typeof body.experienceYears !== "number" && typeof body.experienceYears !== "string") {
        return Response.json({ error: "Experience years must be a number" }, { status: 400 });
      }
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
    if (body.llmModel !== null && typeof body.llmModel !== "string") {
      return Response.json({ error: "Model name must be text" }, { status: 400 });
    }
    const model = (body.llmModel ?? "").trim();
    if (model.length > 100) return Response.json({ error: "Model name too long" }, { status: 400 });
    fields.llm_model = model || null;
  }
  if (body.llmBaseUrl !== undefined) {
    if (body.llmBaseUrl !== null && typeof body.llmBaseUrl !== "string") {
      return Response.json({ error: "Endpoint URL must be text" }, { status: 400 });
    }
    const url = (body.llmBaseUrl ?? "").trim();
    if (url.length > 300) return Response.json({ error: "Endpoint URL too long" }, { status: 400 });
    fields.llm_base_url = url || null;
  }

  if (body.llmKey !== undefined && typeof body.llmKey !== "string") {
    return Response.json({ error: "LLM key must be text" }, { status: 400 });
  }
  if (typeof body.llmKey === "string" && body.llmKey.length > 4096) {
    return Response.json({ error: "LLM key is too long" }, { status: 400 });
  }

  // Write-only LLM key handling + save-time provider validation.
  const secret = process.env.LLM_KEY_SECRET;
  const effective = {
    provider: fields.llm_provider ?? currentProfile.llm_provider ?? "gemini",
    baseUrl: fields.llm_base_url !== undefined ? fields.llm_base_url : currentProfile.llm_base_url,
    model: fields.llm_model !== undefined ? fields.llm_model : currentProfile.llm_model,
  };
  // Re-ping only when a value actually changes; the profile page resends the
  // whole profile on every save, so presence alone would ping every save and
  // couple unrelated saves to provider availability.
  const providerConfigChanged =
    (fields.llm_provider !== undefined && fields.llm_provider !== (currentProfile.llm_provider || "gemini")) ||
    (fields.llm_model !== undefined && (fields.llm_model ?? null) !== (currentProfile.llm_model ?? null)) ||
    (fields.llm_base_url !== undefined && (fields.llm_base_url ?? null) !== (currentProfile.llm_base_url ?? null));

  const needsProviderCheck = Boolean(body.llmKey) ||
    (providerConfigChanged && Boolean(currentProfile.llm_key_enc)) ||
    (providerConfigChanged && effective.provider === "custom" && Boolean(effective.baseUrl));
  if (needsProviderCheck) {
    let providerLimit;
    try {
      providerLimit = consumeProfileLimit(session, "provider-check", 10);
    } catch (error) {
      console.error("[profile] Provider rate limiter error:", error);
      return Response.json({ error: "Provider checks are temporarily unavailable" }, { status: 503 });
    }
    if (!providerLimit.allowed) return rateLimitResponse(providerLimit);
  }

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
  let passwordChanged = false;
  if (body.newPassword !== undefined) {
    const passwordProblem = bcryptPasswordProblem(body.newPassword, { minCharacters: 12 });
    if (passwordProblem) return Response.json({ error: passwordProblem }, { status: 400 });
    let passwordLimit;
    try {
      passwordLimit = consumeProfileLimit(session, "password", 10);
    } catch (error) {
      console.error("[profile] Password rate limiter error:", error);
      return Response.json({ error: "Password changes are temporarily unavailable" }, { status: 503 });
    }
    if (!passwordLimit.allowed) return rateLimitResponse(passwordLimit);
    const hash = await bcrypt.hash(body.newPassword, 10);
    setPasswordHash(session.discordId, hash);
    passwordChanged = true;
  }

  try {
    if (Object.keys(fields).length > 0) {
      updateUserProfile(session.discordId, fields);
    }
  } catch (err) {
    console.error("[profile] Update error:", err);
    return Response.json({ error: "Failed to update profile" }, { status: 500 });
  }

  if (passwordChanged) await clearSession();
  return Response.json({ updated: true, reauthRequired: passwordChanged });
}
