import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-in-production-32ch");
const COOKIE_NAME = "jobpulse_session";

function cookieSecure() {
  if (process.env.COOKIE_SECURE !== undefined) {
    return ["1", "true", "yes", "on"].includes(String(process.env.COOKIE_SECURE).toLowerCase());
  }
  return process.env.NODE_ENV === "production";
}

export async function createSession(payload) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(SECRET);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true, secure: cookieSecure(),
    sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/"
  });
  return token;
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch { return null; }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
