import { getSession } from "@/lib/session";
import { getAllSuggestions, respondToSuggestion } from "@/lib/admin";
import { jsonBodyError, readJsonBody, requireSameOrigin } from "@/lib/security";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || "";
  if (status && !["pending", "approved", "rejected"].includes(status)) {
    return Response.json({ error: "Invalid suggestion status" }, { status: 400 });
  }

  try {
    const suggestions = getAllSuggestions({ status: status || undefined });
    return Response.json({ suggestions });
  } catch (err) {
    console.error("Admin suggestions fetch error:", err);
    return Response.json({ error: "Failed to fetch suggestions" }, { status: 500 });
  }
}

export async function PUT(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 8 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { suggestionId, status, adminResponse } = body;
  if (!Number.isSafeInteger(suggestionId) || suggestionId < 1 || !status) {
    return Response.json({ error: "suggestionId and status are required" }, { status: 400 });
  }

  const allowedStatuses = ["pending", "approved", "rejected"];
  if (!allowedStatuses.includes(status)) {
    return Response.json({ error: `status must be one of: ${allowedStatuses.join(", ")}` }, { status: 400 });
  }
  if (adminResponse !== undefined && (typeof adminResponse !== "string" || adminResponse.length > 4000)) {
    return Response.json({ error: "adminResponse must be a string of 4,000 characters or fewer" }, { status: 400 });
  }

  try {
    const updated = respondToSuggestion(suggestionId, { status, adminResponse });
    if (!updated) return Response.json({ error: "Suggestion not found" }, { status: 404 });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin suggestion respond error:", err);
    return Response.json({ error: "Failed to update suggestion" }, { status: 500 });
  }
}
