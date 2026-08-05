import { getSession } from "@/lib/session";
import { getAllUsers } from "@/lib/admin";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  if (search.length > 200) {
    return Response.json({ error: "Search query is too long" }, { status: 400 });
  }
  if (status && !["active", "paused"].includes(status)) {
    return Response.json({ error: "Invalid user status" }, { status: 400 });
  }

  try {
    const users = getAllUsers({ search: search || undefined, status: status || undefined });
    return Response.json({ users });
  } catch (err) {
    console.error("Admin users fetch error:", err);
    return Response.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
