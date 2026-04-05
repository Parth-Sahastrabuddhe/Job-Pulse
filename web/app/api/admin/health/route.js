import { getSession } from "@/lib/session";
import { getSystemHealth } from "@/lib/admin";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const health = getSystemHealth();
    return Response.json(health);
  } catch (err) {
    console.error("Admin health fetch error:", err);
    return Response.json({ error: "Failed to fetch system health" }, { status: 500 });
  }
}
