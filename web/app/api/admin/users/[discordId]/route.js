import { getSession } from "@/lib/session";
import { updateUserProfile } from "@/lib/db";
import { deleteUser } from "@/lib/admin";

export async function PUT(request, { params }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { discordId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    updateUserProfile(discordId, body);
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin user update error:", err);
    return Response.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { discordId } = await params;

  try {
    const deleted = deleteUser(discordId);
    if (!deleted) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    return Response.json({ deleted: true });
  } catch (err) {
    console.error("Admin user delete error:", err);
    return Response.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
