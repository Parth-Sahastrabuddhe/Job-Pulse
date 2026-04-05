import { getSession } from "@/lib/session";
import { getUserProfile, updateUserProfile } from "@/lib/db";

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
    country: profile.country || "US",
    requiresSponsorship: profile.requires_sponsorship === 1,
    notificationMode: profile.notification_mode || "realtime",
    quietHoursStart: profile.quiet_hours_start || "",
    quietHoursEnd: profile.quiet_hours_end || "",
    quietHoursTz: profile.quiet_hours_tz || "America/New_York",
    isActive: profile.is_active === 1,
  });
}

export async function PUT(request) {
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
  if (body.country !== undefined) fields.country = body.country;
  if (body.requiresSponsorship !== undefined) fields.requires_sponsorship = body.requiresSponsorship ? 1 : 0;
  if (body.notificationMode !== undefined) fields.notification_mode = body.notificationMode;
  if (body.quietHoursStart !== undefined) fields.quiet_hours_start = body.quietHoursStart;
  if (body.quietHoursEnd !== undefined) fields.quiet_hours_end = body.quietHoursEnd;
  if (body.quietHoursTz !== undefined) fields.quiet_hours_tz = body.quietHoursTz;
  if (body.isActive !== undefined) fields.is_active = body.isActive ? 1 : 0;

  try {
    console.log("[profile] PUT for", session.discordId, "fields:", JSON.stringify(fields));
    updateUserProfile(session.discordId, fields);
    console.log("[profile] Updated successfully");
  } catch (err) {
    console.error("[profile] Update error:", err);
    return Response.json({ error: "Failed to update profile" }, { status: 500 });
  }

  return Response.json({ updated: true });
}
