import bcrypt from "bcryptjs";
import { getSession, createSession } from "@/lib/session";
import { verifyOtp, createUserProfile, getUserProfile, getUserProfileByEmail, setNotificationChannelId } from "@/lib/db";
import { addUserToGuildWithRole, createUserChannel } from "@/lib/discord-admin";
import { requireSameOrigin } from "@/lib/security";

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email, code, firstName, password;
  try {
    const body = await request.json();
    email = body.email;
    code = body.code;
    firstName = body.firstName;
    password = body.password;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !code || !firstName) {
    return Response.json({ error: "email, code, and firstName are required" }, { status: 400 });
  }

  if (!password || password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  let valid = false;
  try {
    valid = verifyOtp(normalizedEmail, String(code));
  } catch (err) {
    console.error("OTP verify error:", err);
    return Response.json({ error: "Verification failed" }, { status: 500 });
  }

  if (!valid) {
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  // Check if this Discord account is already registered
  const existingByDiscord = getUserProfile(session.discordId);
  if (existingByDiscord) {
    return Response.json({ error: "You already have an account. Please log in instead." }, { status: 409 });
  }

  // Check if this email is taken by another account
  const existingByEmail = getUserProfileByEmail(normalizedEmail);
  if (existingByEmail) {
    return Response.json({ error: "This email is already associated with another account." }, { status: 409 });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user profile with password
  try {
    createUserProfile({
      discordId: session.discordId,
      discordUsername: session.username,
      firstName: firstName.trim(),
      email: normalizedEmail,
      passwordHash,
    });
  } catch (err) {
    console.error("createUserProfile error:", err);
    return Response.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }

  // Auto-add the newly verified user to the JobPulse Discord server with a
  // bot-only role. Non-fatal: any failure is logged and account creation still
  // succeeds — admin can re-invite manually.
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = process.env.DISCORD_BOT_ROLE_ID;
  const botToken = process.env.MULTI_USER_BOT_TOKEN;
  const accessToken = session.discordAccessToken;
  if (!guildId || !roleId || !botToken) {
    console.warn("[discord-join] skipped: missing DISCORD_GUILD_ID, DISCORD_BOT_ROLE_ID, or MULTI_USER_BOT_TOKEN");
  } else if (!accessToken) {
    console.warn("[discord-join] skipped: no discordAccessToken on session");
  } else {
    try {
      await addUserToGuildWithRole({
        discordId: session.discordId,
        accessToken,
        guildId,
        roleId,
        botToken,
      });
    } catch (err) {
      console.error("[discord-join] failed", err);
    }

    // Auto-provision a private per-user channel under the User Feeds category.
    // Multi-user bot will deliver job alerts to this channel instead of DM.
    const categoryId = process.env.DISCORD_USER_FEED_CATEGORY_ID;
    if (!categoryId) {
      console.warn("[user-channel-create] skipped: DISCORD_USER_FEED_CATEGORY_ID not set");
    } else {
      try {
        const channelId = await createUserChannel({
          guildId,
          categoryId,
          jobpulseMemberRoleId: roleId,
          userId: session.discordId,
          firstName: firstName.trim(),
          botToken,
        });
        setNotificationChannelId(session.discordId, channelId);
      } catch (err) {
        console.error("[user-channel-create] failed", err);
      }
    }
  }

  // Update session. Drop discordAccessToken — it's single-use and no longer needed.
  const { discordAccessToken: _discard, ...rest } = session;
  await createSession({
    ...rest,
    profileComplete: true,
  });

  return Response.json({ verified: true });
}
