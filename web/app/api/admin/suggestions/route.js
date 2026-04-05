import { getSession } from "@/lib/session";
import { getAllSuggestions, respondToSuggestion } from "@/lib/admin";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || "";

  try {
    const suggestions = getAllSuggestions({ status: status || undefined });
    return Response.json({ suggestions });
  } catch (err) {
    console.error("Admin suggestions fetch error:", err);
    return Response.json({ error: "Failed to fetch suggestions" }, { status: 500 });
  }
}

export async function PUT(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { suggestionId, status, adminResponse } = body;
  if (!suggestionId || !status) {
    return Response.json({ error: "suggestionId and status are required" }, { status: 400 });
  }

  const allowedStatuses = ["pending", "approved", "rejected"];
  if (!allowedStatuses.includes(status)) {
    return Response.json({ error: `status must be one of: ${allowedStatuses.join(", ")}` }, { status: 400 });
  }

  try {
    respondToSuggestion(suggestionId, { status, adminResponse });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin suggestion respond error:", err);
    return Response.json({ error: "Failed to update suggestion" }, { status: 500 });
  }
}
