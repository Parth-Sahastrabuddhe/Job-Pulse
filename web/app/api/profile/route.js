import bcrypt from "bcryptjs";
import { getSession } from "@/lib/session";
import { getUserProfile, updateUserProfile, setPasswordHash } from "@/lib/db";
import { requireSameOrigin } from "@/lib/security";

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
