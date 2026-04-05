import { getSession } from "@/lib/session";
import { getUserTickets, createSupportTicket } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tickets = getUserTickets(session.discordId);
    return Response.json({ tickets });
  } catch (err) {
    console.error("Tickets fetch error:", err);
    return Response.json({ error: "Failed to fetch tickets" }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { category, description } = body;
  const allowedCategories = ["bug", "missing_jobs", "feature_request", "other"];

  if (!category || !allowedCategories.includes(category)) {
    return Response.json(
      { error: `Category must be one of: ${allowedCategories.join(", ")}` },
      { status: 400 }
    );
  }

  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return Response.json(
      { error: "Description must be at least 10 characters." },
      { status: 400 }
    );
  }

  try {
    const id = createSupportTicket(session.discordId, category, description.trim());
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Ticket create error:", err);
    return Response.json({ error: "Failed to create ticket" }, { status: 500 });
  }
}
