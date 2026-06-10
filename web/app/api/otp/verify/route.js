import bcrypt from "bcryptjs";
import { getSession, createSession } from "@/lib/session";
import { verifyOtp, createUserProfile, getUserProfile, getUserProfileByEmail, setNotificationChannelId } from "@/lib/db";
import { addUserToGuildWithRole, createUserChannel } from "@/lib/discord-admin";
import { requireSameOrigin } from "@/lib/security";

// Brute-force guard for OTP verification: a 6-digit code is only ~1e6 wide, so
// cap failed attempts per session and lock out for a window. In-memory (per
// process), matching the single pm2 web fork; revisit if the web scales out.
const verifyAttempts = new Map();
const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

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

  // Enforce the brute-force lockout before checking the code.
  const attemptKey = session.discordId;
  const nowMs = Date.now();
  const priorAttempts = verifyAttempts.get(attemptKey);
  if (priorAttempts && priorAttempts.resetAt > nowMs && priorAttempts.count >= VERIFY_MAX_ATTEMPTS) {
    return Response.json(
      { error: "Too many attempts. Please request a new code and try again later." },
      { status: 429 }
    );
  }

  let valid = false;
  try {
    valid = verifyOtp(normalizedEmail, String(code));
  } catch (err) {
    console.error("OTP verify error:", err);
    return Response.json({ error: "Verification failed" }, { status: 500 });
  }

  if (!valid) {
    // Count the failed attempt toward the lockout.
    if (!priorAttempts || priorAttempts.resetAt <= nowMs) {
      verifyAttempts.set(attemptKey, { count: 1, resetAt: nowMs + VERIFY_WINDOW_MS });
    } else {
      priorAttempts.count++;
    }
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  // Verified. Clear the attempt counter for this session.
  verifyAttempts.delete(attemptKey);

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
