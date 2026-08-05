import crypto from "node:crypto";
import { getSession } from "@/lib/session";
import { consumeRateLimit, createOtp, invalidateOtp } from "@/lib/db";
import {
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";
import { sendOtpEmail } from "@/lib/ses";

const OTP_RATE_LIMIT = 3;
const OTP_RATE_WINDOW_MS = 5 * 60 * 1000;
const OTP_IP_RATE_LIMIT = 20;

function rateLimitResponse(retryAfterSeconds) {
  return Response.json(
    { error: "Too many verification emails. Try again later." },
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
  if (session.profileComplete) {
    return Response.json({ error: "This account is already registered" }, { status: 409 });
  }

  let email;
  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 });
    email = body.email;
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return Response.json({ error: "A single valid email address is required" }, { status: 400 });

  const clientIp = getTrustedClientIp(request);
  let userEmailLimit;
  let ipLimit;
  try {
    userEmailLimit = consumeRateLimit({
      scope: "otp-send-user-email-ip",
      keyHash: opaqueRateLimitKey(session.discordId, normalizedEmail, clientIp),
      limit: OTP_RATE_LIMIT,
      windowMs: OTP_RATE_WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "otp-send-ip",
      keyHash: opaqueRateLimitKey(clientIp),
      limit: OTP_IP_RATE_LIMIT,
      windowMs: OTP_RATE_WINDOW_MS,
    });
  } catch (error) {
    console.error("[otp] Rate limiter error:", error);
    return Response.json({ error: "Email verification is temporarily unavailable" }, { status: 503 });
  }
  if (!userEmailLimit.allowed || !ipLimit.allowed) {
    return rateLimitResponse(Math.max(userEmailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
  }

  const code = String(crypto.randomInt(100000, 1000000));
  try {
    createOtp(normalizedEmail, code);
  } catch (error) {
    console.error("[otp] Code creation failed:", error);
    return Response.json({ error: "Email verification is temporarily unavailable" }, { status: 503 });
  }

  try {
    await sendOtpEmail(normalizedEmail, code);
  } catch (err) {
    // A code that was not delivered must never remain usable.
    try {
      invalidateOtp(normalizedEmail, code);
    } catch (invalidateError) {
      console.error("[otp] Failed to invalidate undelivered code:", invalidateError);
    }
    console.error("[otp] Email delivery failed:", err?.name || "unknown error");
    return Response.json(
      { error: "Verification email could not be sent. Please try again later." },
      { status: 502 }
    );
  }

  return Response.json({ sent: true }, { headers: { "Cache-Control": "no-store" } });
}
