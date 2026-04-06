import { getSession } from "@/lib/session";
import { getUserApplications } from "@/lib/db";

export async function GET(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;
  const query = searchParams.get("query") || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  try {
    const { applications, total } = getUserApplications(session.discordId, { status, query, limit, offset });
    return Response.json({ applications, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("Applications fetch error:", err);
    return Response.json({ error: "Failed to fetch applications" }, { status: 500 });
  }
}
