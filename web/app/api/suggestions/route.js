import { getSession } from "@/lib/session";
import { createCompanySuggestion } from "@/lib/db";

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

  const { companyName, careersUrl, reason } = body;

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    return Response.json({ error: "Company name is required." }, { status: 400 });
  }

  try {
    const id = createCompanySuggestion(
      session.discordId,
      companyName.trim(),
      careersUrl || "",
      reason || ""
    );
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Suggestion create error:", err);
    return Response.json({ error: "Failed to submit suggestion" }, { status: 500 });
  }
}
