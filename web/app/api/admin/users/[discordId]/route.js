import { getSession } from "@/lib/session";
import { getUserProfile, updateUserProfile } from "@/lib/db";
import { deleteUser } from "@/lib/admin";
import { deleteDiscordUserArtifacts } from "@/lib/discord-admin";
import { jsonBodyError, readJsonBody, requireSameOrigin } from "@/lib/security";

export async function PUT(request, { params }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { discordId } = await params;
  if (!/^\d{17,20}$/.test(discordId)) {
    return Response.json({ error: "Invalid Discord user ID" }, { status: 400 });
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 8 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "is_active" || ![0, 1, false, true].includes(body.is_active)) {
    return Response.json({ error: "Only is_active may be updated" }, { status: 400 });
  }

  try {
    if (!getUserProfile(discordId)) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    updateUserProfile(discordId, { is_active: body.is_active ? 1 : 0 });
    return Response.json({ updated: true });
  } catch (err) {
    console.error("Admin user update error:", err);
    return Response.json({ error: "Failed to update user" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session || session.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { discordId } = await params;
  if (!/^\d{17,20}$/.test(discordId)) {
    return Response.json({ error: "Invalid Discord user ID" }, { status: 400 });
  }
  if (discordId === session.discordId) {
    return Response.json({ error: "You cannot delete your own admin account" }, { status: 400 });
  }

  try {
    const profile = getUserProfile(discordId);
    const deleted = deleteUser(discordId);
    if (!deleted) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    // Database deletion is authoritative. Clean up the private Discord feed
    // and membership afterward; report non-fatal cleanup failures to the admin.
    const cleanup = await deleteDiscordUserArtifacts({
      discordId,
      channelId: profile?.notification_channel_id,
      guildId: process.env.DISCORD_GUILD_ID,
      botToken: process.env.MULTI_USER_BOT_TOKEN,
    });
    const cleanupWasNeeded = Boolean(profile?.notification_channel_id || process.env.DISCORD_GUILD_ID);
    if (cleanupWasNeeded && cleanup.skipped) {
      console.warn("[account-delete] Discord cleanup skipped: bot credentials are unavailable");
    } else if (cleanup.failures.length) {
      console.warn("[account-delete] Discord cleanup incomplete:", cleanup.failures.join(", "));
    }
    return Response.json({
      deleted: true,
      discordCleanupPending: cleanupWasNeeded && (cleanup.skipped || cleanup.failures.length > 0),
    });
  } catch (err) {
    console.error("Admin user delete error:", err);
    return Response.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
