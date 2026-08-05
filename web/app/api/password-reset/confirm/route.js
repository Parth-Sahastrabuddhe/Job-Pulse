import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import {
  consumePasswordResetCode,
  consumeRateLimit,
  getUserProfileByEmail,
  resetRateLimit,
  setPasswordHash,
} from "@/lib/db";
import { passwordResetCodeHash } from "@/lib/password-reset.mjs";
import {
  bcryptPasswordProblem,
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";
import { COOKIE_NAME, OAUTH_HANDOFF_COOKIE_NAME } from "@/lib/session";

const WINDOW_MS = 15 * 60 * 1000;

function invalidCode() {
  return NextResponse.json({ error: "Invalid or expired reset code" }, { status: 400 });
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  let email;
  let code;
  let password;
  try {
    const body = await readJsonBody(request, { maxBytes: 4 * 1024 });
    email = body.email;
    code = body.code;
    password = body.password;
  } catch (error) {
    return jsonBodyError(error) || NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Code must be exactly 6 digits" }, { status: 400 });
  }
  const passwordProblem = bcryptPasswordProblem(password, { minCharacters: 12 });
  if (passwordProblem) return NextResponse.json({ error: passwordProblem }, { status: 400 });

  const clientIp = getTrustedClientIp(request);
  const pairKeyHash = opaqueRateLimitKey(normalizedEmail, clientIp);
  let pairLimit;
  let ipLimit;
  try {
    pairLimit = consumeRateLimit({
      scope: "password-reset-confirm-email-ip",
      keyHash: pairKeyHash,
      limit: 5,
      windowMs: WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "password-reset-confirm-ip",
      keyHash: opaqueRateLimitKey(clientIp),
      limit: 50,
      windowMs: WINDOW_MS,
    });
  } catch (error) {
    console.error("[password-reset] Rate limiter error:", error);
    return NextResponse.json({ error: "Password recovery is temporarily unavailable" }, { status: 503 });
  }

  if (!pairLimit.allowed || !ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Request a new code and try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(pairLimit.retryAfterSeconds, ipLimit.retryAfterSeconds)),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const user = getUserProfileByEmail(normalizedEmail);
  let valid = false;
  try {
    const codeHash = passwordResetCodeHash(normalizedEmail, code);
    valid = consumePasswordResetCode(normalizedEmail, codeHash);
  } catch (error) {
    console.error("[password-reset] Code verification failed:", error?.name || "unknown error");
    return NextResponse.json({ error: "Password recovery is temporarily unavailable" }, { status: 503 });
  }
  if (!user || !valid) return invalidCode();

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    setPasswordHash(user.discord_id, passwordHash);
  } catch (error) {
    console.error("[password-reset] Password update failed:", error?.name || "unknown error");
    return NextResponse.json({ error: "Password could not be updated. Request a new code." }, { status: 500 });
  }

  try {
    resetRateLimit("password-reset-confirm-email-ip", pairKeyHash);
  } catch (error) {
    // The password and session version are already updated. Do not report a
    // false reset failure because best-effort limiter cleanup was busy.
    console.warn("[password-reset] Failed to clear confirmation rate limit:", error);
  }
  const response = NextResponse.json(
    { reset: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.delete(COOKIE_NAME);
  response.cookies.delete(OAUTH_HANDOFF_COOKIE_NAME);
  return response;
}
