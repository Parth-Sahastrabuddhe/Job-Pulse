import { getSession } from "@/lib/session";
import { getUserApplications, getUserProfile } from "@/lib/db";

export async function GET(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;
  const query = searchParams.get("query") || undefined;
  const sort = searchParams.get("sort") || "date_desc";
  const rawPage = searchParams.get("page") || "1";
  const allowedStatuses = new Set(["notified", "saved", "applied", "skipped", "interviewing", "offer", "rejected"]);
  if (status && !allowedStatuses.has(status)) {
    return Response.json({ error: "Invalid application status" }, { status: 400 });
  }
  if (query && query.length > 200) {
    return Response.json({ error: "Search query is too long" }, { status: 400 });
  }
  const allowedSorts = new Set(["date_desc", "date_asc", "company_asc", "company_desc", "status_asc"]);
  if (!allowedSorts.has(sort)) {
    return Response.json({ error: "Invalid sort order" }, { status: 400 });
  }
  if (!/^\d{1,5}$/.test(rawPage)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }
  const page = Number(rawPage);
  if (page < 1 || page > 10000) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }
  const limit = 50;
  const offset = (page - 1) * limit;

  try {
    const { applications, total, stats } = getUserApplications(session.discordId, { status, query, sort, limit, offset });
    const isAdmin = session.discordId === process.env.ADMIN_DISCORD_ID;
    const profile = getUserProfile(session.discordId);
    const timezone = profile?.quiet_hours_tz || "America/New_York";
    return Response.json({ applications, total, stats, page, totalPages: Math.ceil(total / limit), hideSkipped: isAdmin, timezone });
  } catch (err) {
    console.error("Applications fetch error:", err);
    return Response.json({ error: "Failed to fetch applications" }, { status: 500 });
  }
}
