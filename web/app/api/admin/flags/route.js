import { getSession } from "@/lib/session";
import { listFeatureFlags, setFeatureFlag } from "@/lib/db";
import { jsonBodyError, readJsonBody, requireSameOrigin } from "@/lib/security";

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return Response.json({ flags: listFeatureFlags() });
  } catch (err) {
    console.error("Admin flags fetch error:", err);
    return Response.json({ error: "Failed to fetch feature flags" }, { status: 500 });
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
    body = await readJsonBody(request, { maxBytes: 2 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || typeof body.key !== "string" || typeof body.enabled !== "boolean") {
    return Response.json({ error: "Expected { key: string, enabled: boolean }" }, { status: 400 });
  }
  try {
    const updated = setFeatureFlag(body.key, body.enabled);
    if (!updated) return Response.json({ error: "Unknown flag" }, { status: 404 });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin flags update error:", err);
    return Response.json({ error: "Failed to update flag" }, { status: 500 });
  }
}
