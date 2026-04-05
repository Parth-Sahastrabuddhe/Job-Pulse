import { getSession } from "@/lib/session";
import { getAllTickets, respondToTicket } from "@/lib/admin";

export async function GET(request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") || "";

  try {
    const tickets = getAllTickets({ status: status || undefined });
    return Response.json({ tickets });
  } catch (err) {
    console.error("Admin tickets fetch error:", err);
    return Response.json({ error: "Failed to fetch tickets" }, { status: 500 });
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

  const { ticketId, status, adminResponse } = body;
  if (!ticketId || !status) {
    return Response.json({ error: "ticketId and status are required" }, { status: 400 });
  }

  const allowedStatuses = ["open", "in_progress", "resolved", "closed"];
  if (!allowedStatuses.includes(status)) {
    return Response.json({ error: `status must be one of: ${allowedStatuses.join(", ")}` }, { status: 400 });
  }

  try {
    respondToTicket(ticketId, { status, adminResponse });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin ticket respond error:", err);
    return Response.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
