import { getSession } from "@/lib/session";
import { getRuntimeLogs } from "@/lib/runtime-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const service = request.nextUrl.searchParams.get("service") || "web";
    return Response.json(getRuntimeLogs(service), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error?.message === "INVALID_SERVICE") {
      return Response.json({ error: "Invalid service" }, { status: 400 });
    }
    console.error("Admin runtime logs fetch error:", error);
    return Response.json({ error: "Failed to read runtime logs" }, { status: 500 });
  }
}
