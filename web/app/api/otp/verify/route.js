import bcrypt from "bcryptjs";
import { clearOAuthHandoff, createSession, getOAuthHandoff, getSession } from "@/lib/session";
import {
  consumeRateLimit,
  createUserProfile,
  getUserProfile,
  getUserProfileByEmail,
  resetRateLimit,
  setNotificationChannelId,
  verifyOtp,
} from "@/lib/db";
import { addUserToGuildWithRole, createUserChannel } from "@/lib/discord-admin";
import {
  bcryptPasswordProblem,
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";

const VERIFY_MAX_ATTEMPTS = 5;
const VERIFY_WINDOW_MS = 15 * 60 * 1000;

function verificationRateLimit(retryAfterSeconds) {
  return Response.json(
    { error: "Too many attempts. Please request a new code and try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email, code, firstName, password;
  try {
    const body = await readJsonBody(request, { maxBytes: 4 * 1024 });
    email = body.email;
    code = body.code;
    firstName = body.firstName;
    password = body.password;
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return Response.json({ error: "A single valid email address is required" }, { status: 400 });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return Response.json({ error: "Code must be exactly 6 digits" }, { status: 400 });
  }
  const normalizedFirstName = typeof firstName === "string" ? firstName.trim() : "";
  if (!normalizedFirstName || normalizedFirstName.length > 100 || /[\u0000-\u001f\u007f]/.test(normalizedFirstName)) {
    return Response.json({ error: "First name must be between 1 and 100 characters" }, { status: 400 });
  }

  const passwordProblem = bcryptPasswordProblem(password, { minCharacters: 12 });
  if (passwordProblem) return Response.json({ error: passwordProblem }, { status: 400 });

  const limitKeyHash = opaqueRateLimitKey(
    session.discordId,
    normalizedEmail,
    getTrustedClientIp(request)
  );
  let attemptLimit;
  try {
    attemptLimit = consumeRateLimit({
      scope: "otp-verify-user-email-ip",
      keyHash: limitKeyHash,
      limit: VERIFY_MAX_ATTEMPTS,
      windowMs: VERIFY_WINDOW_MS,
    });
  } catch (error) {
    console.error("[otp] Verification rate limiter error:", error);
    return Response.json({ error: "Email verification is temporarily unavailable" }, { status: 503 });
  }
  if (!attemptLimit.allowed) {
    return verificationRateLimit(attemptLimit.retryAfterSeconds);
  }

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

  try {
    resetRateLimit("otp-verify-user-email-ip", limitKeyHash);
  } catch (error) {
    // The OTP is already consumed. A cleanup failure must not make the user
    // submit that one-time code again.
    console.warn("[otp] Failed to clear verification rate limit:", error);
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
      firstName: normalizedFirstName,
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
  const handoff = await getOAuthHandoff();
  const accessToken = handoff?.discordId === session.discordId ? handoff.accessToken : null;
  if (!guildId || !roleId || !botToken) {
    console.warn("[discord-join] skipped: missing DISCORD_GUILD_ID, DISCORD_BOT_ROLE_ID, or MULTI_USER_BOT_TOKEN");
  } else if (!accessToken) {
    console.warn("[discord-join] skipped: no valid short-lived OAuth handoff");
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
          firstName: normalizedFirstName,
          botToken,
        });
        setNotificationChannelId(session.discordId, channelId);
      } catch (err) {
        console.error("[user-channel-create] failed", err);
      }
    }
  }

  // Update the identity-only session and erase the one-time OAuth handoff.
  await createSession({
    ...session,
    profileComplete: true,
    sessionVersion: 0,
  });
  await clearOAuthHandoff();

  return Response.json({ verified: true }, { headers: { "Cache-Control": "no-store" } });
}
