import { getSession } from "@/lib/session";
import { updateApplicationStatus } from "@/lib/db";

const ALLOWED_STATUSES = ["notified", "saved", "applied", "skipped", "interviewing", "offer", "rejected"];

export async function PUT(request, { params }) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobKey } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { status } = body;
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return Response.json(
      { error: `Status must be one of: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    updateApplicationStatus(session.discordId, jobKey, status);
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Application status update error:", err);
    return Response.json({ error: "Failed to update status" }, { status: 500 });
  }
}
