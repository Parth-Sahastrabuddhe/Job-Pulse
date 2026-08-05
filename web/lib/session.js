import { CompactEncrypt, compactDecrypt, SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { getUserProfile } from "./db.js";
import { resolveSessionSecret, sessionSecretProblem, sessionVersionMatches } from "./session-config.mjs";

export const COOKIE_NAME = "jobpulse_session";
export const OAUTH_HANDOFF_COOKIE_NAME = "jobpulse_oauth_handoff";
const SESSION_ISSUER = "jobpulse-web";
const SESSION_AUDIENCE = "jobpulse-web";

// Single source of truth for the session-signing secret. No hardcoded fallback:
// in production a strong SESSION_SECRET is mandatory (fail closed), and in
// dev/test we generate an ephemeral random secret rather than ship a known
// constant an attacker could use to forge an admin session. The dev secret is
// stashed on globalThis so every module that imports this file shares it.
function resolveSecret() {
  const provided = process.env.SESSION_SECRET;
  const production = process.env.NODE_ENV === "production";
  const problem = sessionSecretProblem(provided);
  if (!problem) return provided;
  if (production) return resolveSessionSecret(provided, { production: true });

  if (!globalThis.__jobpulseDevSecret) {
    globalThis.__jobpulseDevSecret = resolveSessionSecret(provided);
    console.warn(
      `[session] SESSION_SECRET ${problem}; using an ephemeral dev secret. Sessions won't persist across restarts.`
    );
  }
  return globalThis.__jobpulseDevSecret;
}

const SECRET_VALUE = resolveSecret();
const SECRET = new TextEncoder().encode(SECRET_VALUE);
const HANDOFF_SECRET = crypto.createHash("sha256").update(SECRET_VALUE).digest();

function cookieSecure() {
  if (process.env.NODE_ENV === "production") return true;
  try {
    if (new URL(process.env.NEXT_PUBLIC_BASE_URL).protocol === "https:") return true;
  } catch {}
  if (process.env.COOKIE_SECURE !== undefined) {
    return ["1", "true", "yes", "on"].includes(String(process.env.COOKIE_SECURE).toLowerCase());
  }
  return process.env.NODE_ENV === "production";
}

/** Sign a session payload as an HS256 JWT. Shared by login/callback/OTP flows. */
export async function signSession(payload, { expiresIn = "30d" } = {}) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}

/** Cookie options for the session cookie. `isHttps` controls the Secure flag. */
export function sessionCookieOptions(isHttps = cookieSecure()) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" ? true : isHttps,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  };
}

export function oauthHandoffCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  };
}

export async function encryptOAuthHandoff({ discordId, accessToken }) {
  const now = Math.floor(Date.now() / 1000);
  const plaintext = new TextEncoder().encode(JSON.stringify({
    discordId,
    accessToken,
    iat: now,
    exp: now + 10 * 60,
  }));
  return new CompactEncrypt(plaintext)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "jobpulse-oauth-handoff" })
    .encrypt(HANDOFF_SECRET);
}

export async function getOAuthHandoff() {
  const cookieStore = await cookies();
  const token = cookieStore.get(OAUTH_HANDOFF_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { plaintext, protectedHeader } = await compactDecrypt(token, HANDOFF_SECRET);
    if (protectedHeader.typ !== "jobpulse-oauth-handoff") return null;
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.discordId || !payload.accessToken || !payload.exp || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearOAuthHandoff() {
  const cookieStore = await cookies();
  cookieStore.delete(OAUTH_HANDOFF_COOKIE_NAME);
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
    let payload;
    try {
      ({ payload } = await jwtVerify(token, SECRET, {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
      }));
    } catch {
      // Sessions issued before the JobLookout domain migration did not carry
      // issuer/audience claims. Accept them until their normal 30-day expiry;
      // every newly issued session uses the stricter claim set above.
      ({ payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] }));
    }
    const safePayload = { ...payload };
    // Strip tokens from legacy session cookies immediately. New sessions never
    // include this claim; OAuth handoff data lives in a short-lived JWE.
    delete safePayload.discordAccessToken;
    if (!safePayload.discordId) return null;

    // A complete account must still exist. This immediately revokes sessions
    // after account deletion and refreshes authorization roles from the DB.
    if (safePayload.profileComplete) {
      let profile;
      try {
        profile = getUserProfile(safePayload.discordId);
      } catch {
        return null;
      }
      if (!profile) return null;
      if (!sessionVersionMatches(safePayload.sessionVersion, profile.session_version)) return null;
      const role = safePayload.discordId === process.env.ADMIN_DISCORD_ID
        ? "admin"
        : (profile.role || "user");
      return { ...safePayload, role };
    }
    return safePayload;
  } catch { return null; }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(OAUTH_HANDOFF_COOKIE_NAME);
}
