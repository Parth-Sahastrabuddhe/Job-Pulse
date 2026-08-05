import crypto from "node:crypto";
import {
  consumeRateLimit,
  createPasswordResetCode,
  getUserProfileByEmail,
  invalidatePasswordResetCode,
} from "@/lib/db";
import { passwordResetCodeHash } from "@/lib/password-reset.mjs";
import {
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";
import { sendPasswordResetEmail } from "@/lib/ses";

const WINDOW_MS = 15 * 60 * 1000;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;
const GENERIC_MESSAGE = "If an account exists for that email, we sent a 6-digit reset code.";

function genericResponse() {
  return Response.json(
    { sent: true, message: GENERIC_MESSAGE },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  let email;
  try {
    const body = await readJsonBody(request, { maxBytes: 2 * 1024 });
    email = body.email;
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const clientIp = getTrustedClientIp(request);
  let pairLimit;
  let emailLimit;
  let ipLimit;
  try {
    pairLimit = consumeRateLimit({
      scope: "password-reset-request-email-ip",
      keyHash: opaqueRateLimitKey(normalizedEmail, clientIp),
      limit: 3,
      windowMs: WINDOW_MS,
    });
    emailLimit = consumeRateLimit({
      scope: "password-reset-request-email",
      keyHash: opaqueRateLimitKey(normalizedEmail),
      limit: 5,
      windowMs: EMAIL_WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "password-reset-request-ip",
      keyHash: opaqueRateLimitKey(clientIp),
      limit: 20,
      windowMs: WINDOW_MS,
    });
  } catch (error) {
    console.error("[password-reset] Rate limiter error:", error);
    return Response.json({ error: "Password recovery is temporarily unavailable" }, { status: 503 });
  }

  if (!pairLimit.allowed || !emailLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(
      pairLimit.retryAfterSeconds,
      emailLimit.retryAfterSeconds,
      ipLimit.retryAfterSeconds
    );
    return Response.json(
      { error: "Too many reset requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } }
    );
  }

  const user = getUserProfileByEmail(normalizedEmail);
  if (!user || user.email_verified !== 1) return genericResponse();

  const code = String(crypto.randomInt(100000, 1000000));
  let codeHash;
  try {
    codeHash = passwordResetCodeHash(normalizedEmail, code);
    createPasswordResetCode(normalizedEmail, codeHash);
    await sendPasswordResetEmail(normalizedEmail, code);
  } catch (error) {
    if (codeHash) {
      try {
        invalidatePasswordResetCode(normalizedEmail, codeHash);
      } catch (invalidateError) {
        console.error("[password-reset] Failed to invalidate undelivered code:", invalidateError?.name || "unknown error");
      }
    }
    console.error("[password-reset] Email delivery failed:", error?.name || "unknown error");
  }

  return genericResponse();
}
