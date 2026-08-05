import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { consumeRateLimit, getUserProfileByEmail, resetRateLimit } from "@/lib/db";
import {
  bcryptPasswordProblem,
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";
import { signSession, sessionCookieOptions, COOKIE_NAME } from "@/lib/session";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_PAIR_LIMIT = 8;
const LOGIN_IP_LIMIT = 100;
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function tooManyAttempts(retryAfterSeconds) {
  return NextResponse.json(
    { error: "Too many login attempts. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  let email, password;
  try {
    const body = await readJsonBody(request, { maxBytes: 4 * 1024 });
    email = body.email;
    password = body.password;
  } catch (error) {
    return jsonBodyError(error) || NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (bcryptPasswordProblem(password)) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(email);
  const clientIp = getTrustedClientIp(request);
  const emailKey = normalizedEmail || String(email || "").trim().toLowerCase().slice(0, 254) || "invalid";
  const pairKeyHash = opaqueRateLimitKey(emailKey, clientIp);
  const ipKeyHash = opaqueRateLimitKey(clientIp);
  let pairLimit;
  let ipLimit;
  try {
    pairLimit = consumeRateLimit({
      scope: "login-email-ip",
      keyHash: pairKeyHash,
      limit: LOGIN_PAIR_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "login-ip",
      keyHash: ipKeyHash,
      limit: LOGIN_IP_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    });
  } catch (error) {
    console.error("[login] Rate limiter error:", error);
    return NextResponse.json({ error: "Login is temporarily unavailable" }, { status: 503 });
  }
  if (!pairLimit.allowed || !ipLimit.allowed) {
    return tooManyAttempts(Math.max(pairLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
  }

  const user = normalizedEmail ? getUserProfileByEmail(normalizedEmail) : null;
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (!user.password_hash) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  try {
    resetRateLimit("login-email-ip", pairKeyHash);
  } catch (error) {
    // Authentication succeeded; limiter cleanup is best-effort and must not
    // convert a correct password into a login failure.
    console.warn("[login] Failed to clear successful-login rate limit:", error);
  }

  // Create JWT session
  const isAdmin = user.discord_id === process.env.ADMIN_DISCORD_ID;
  const token = await signSession({
    discordId: user.discord_id,
    username: user.discord_username,
    avatar: null,
    role: isAdmin ? "admin" : (user.role || "user"),
    profileComplete: true,
    sessionVersion: user.session_version || 0,
  });

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions());
  response.headers.set("Cache-Control", "no-store");

  return response;
}
