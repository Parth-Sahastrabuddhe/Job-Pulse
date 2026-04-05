import { getSession } from "@/lib/session";
import { getUserApplications } from "@/lib/db";

export async function GET(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || undefined;

  try {
    const applications = getUserApplications(session.discordId, { status });
    return Response.json({ applications });
  } catch (err) {
    console.error("Applications fetch error:", err);
    return Response.json({ error: "Failed to fetch applications" }, { status: 500 });
  }
}
