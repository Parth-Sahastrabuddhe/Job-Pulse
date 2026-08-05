import { getSession } from "@/lib/session";
import { getAllTickets, respondToTicket } from "@/lib/admin";
import { jsonBodyError, readJsonBody, requireSameOrigin } from "@/lib/security";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || "";
  if (status && !["open", "in_progress", "resolved", "closed"].includes(status)) {
    return Response.json({ error: "Invalid ticket status" }, { status: 400 });
  }

  try {
    const tickets = getAllTickets({ status: status || undefined });
    return Response.json({ tickets });
  } catch (err) {
    console.error("Admin tickets fetch error:", err);
    return Response.json({ error: "Failed to fetch tickets" }, { status: 500 });
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

  const { ticketId, status, adminResponse } = body;
  // Negative ids identify visitor requests from public_support_requests.
  if (!Number.isSafeInteger(ticketId) || ticketId === 0 || !status) {
    return Response.json({ error: "ticketId and status are required" }, { status: 400 });
  }

  const allowedStatuses = ["open", "in_progress", "resolved", "closed"];
  if (!allowedStatuses.includes(status)) {
    return Response.json({ error: `status must be one of: ${allowedStatuses.join(", ")}` }, { status: 400 });
  }
  if (adminResponse !== undefined && (typeof adminResponse !== "string" || adminResponse.length > 4000)) {
    return Response.json({ error: "adminResponse must be a string of 4,000 characters or fewer" }, { status: 400 });
  }

  try {
    const updated = respondToTicket(ticketId, { status, adminResponse });
    if (!updated) return Response.json({ error: "Ticket not found" }, { status: 404 });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin ticket respond error:", err);
    return Response.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
