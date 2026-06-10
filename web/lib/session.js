import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "node:crypto";

export const COOKIE_NAME = "jobpulse_session";

// Single source of truth for the session-signing secret. No hardcoded fallback:
// in production a strong SESSION_SECRET is mandatory (fail closed), and in
// dev/test we generate an ephemeral random secret rather than ship a known
// constant an attacker could use to forge an admin session. The dev secret is
// stashed on globalThis so every module that imports this file shares it.
function resolveSecret() {
  const provided = process.env.SESSION_SECRET;
  if (provided && provided.length >= 32) return provided;

  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set to a strong value (>= 32 chars) in production");
  }

  if (!globalThis.__jobpulseDevSecret) {
    globalThis.__jobpulseDevSecret = crypto.randomBytes(48).toString("hex");
    console.warn(
      "[session] SESSION_SECRET unset or too short; using an ephemeral dev secret. Sessions won't persist across restarts."
    );
  }
  return globalThis.__jobpulseDevSecret;
}

const SECRET = new TextEncoder().encode(resolveSecret());

function cookieSecure() {
  if (process.env.COOKIE_SECURE !== undefined) {
    return ["1", "true", "yes", "on"].includes(String(process.env.COOKIE_SECURE).toLowerCase());
  }
  return process.env.NODE_ENV === "production";
}

/** Sign a session payload as an HS256 JWT. Shared by login/callback/OTP flows. */
export async function signSession(payload, { expiresIn = "30d" } = {}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}

/** Cookie options for the session cookie. `isHttps` controls the Secure flag. */
export function sessionCookieOptions(isHttps = cookieSecure()) {
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  };
}

export async function createSession(payload) {
  const token = await signSession(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, sessionCookieOptions());
  return token;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    return payload;
  } catch { return null; }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
