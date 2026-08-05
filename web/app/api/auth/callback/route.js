import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { discordRedirectUri, publicBaseUrl } from "@/lib/security";
import { getUserProfile } from "@/lib/db";
import {
  COOKIE_NAME,
  OAUTH_HANDOFF_COOKIE_NAME,
  encryptOAuthHandoff,
  oauthHandoffCookieOptions,
  sessionCookieOptions,
  signSession,
} from "@/lib/session";

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function configuredBaseUrl(request) {
  try {
    return { baseUrl: publicBaseUrl(request), redirectUri: discordRedirectUri(request) };
  } catch (error) {
    console.error("[oauth] Invalid public URL configuration:", error.message);
    return { error };
  }
}

function authError(baseUrl, code, statusCookie = true) {
  const response = NextResponse.redirect(new URL(`/auth?error=${encodeURIComponent(code)}`, baseUrl));
  if (statusCookie) response.cookies.delete("jobpulse_oauth_state");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request) {
  const configured = configuredBaseUrl(request);
  if (configured.error) {
    return NextResponse.json({ error: configured.error.message }, { status: 503 });
  }
  const { baseUrl, redirectUri } = configured;
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return authError(baseUrl, "missing_code");
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("jobpulse_oauth_state")?.value;
  if (!state || !expectedState || !constantTimeEqual(state, expectedState)) {
    return authError(baseUrl, "invalid_state");
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return authError(baseUrl, "oauth_not_configured");
  }

  // Exchange code for access token
  let tokenData;
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return authError(baseUrl, "token_exchange_failed");
    tokenData = await tokenRes.json();
  } catch {
    return authError(baseUrl, "token_exchange_failed");
  }

  if (typeof tokenData.access_token !== "string" || tokenData.access_token.length > 4096) {
    return authError(baseUrl, "no_access_token");
  }

  // Fetch Discord user profile
  let discordUser;
  try {
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!userRes.ok) return authError(baseUrl, "user_fetch_failed");
    discordUser = await userRes.json();
  } catch {
    return authError(baseUrl, "user_fetch_failed");
  }

  if (!discordUser.id) {
    return authError(baseUrl, "invalid_user");
  }

  // Check if user exists in DB
  let existingUser = null;
  try {
    existingUser = getUserProfile(discordUser.id);
  } catch {
    // DB not available during build — fail gracefully
  }

  const profileComplete = !!(existingUser && existingUser.email_verified);

  // Determine role
  const isAdminById = process.env.ADMIN_DISCORD_ID && discordUser.id === process.env.ADMIN_DISCORD_ID;
  const role = isAdminById ? "admin" : (existingUser?.role || "user");

  // The long-lived signed session contains identity only. The short-lived
  // Discord access token is placed in a separately encrypted HttpOnly cookie.
  const token = await signSession({
    discordId: discordUser.id,
    username: discordUser.username,
    avatar: discordUser.avatar,
    role,
    profileComplete,
    sessionVersion: existingUser?.session_version || 0,
  });

  // Redirect with session cookie set on the response.
  const destination = profileComplete ? "/profile" : "/verify";
  const response = NextResponse.redirect(new URL(destination, baseUrl));
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions(new URL(baseUrl).protocol === "https:"));
  if (!profileComplete) {
    const handoff = await encryptOAuthHandoff({
      discordId: discordUser.id,
      accessToken: tokenData.access_token,
    });
    response.cookies.set(OAUTH_HANDOFF_COOKIE_NAME, handoff, oauthHandoffCookieOptions());
  } else {
    response.cookies.delete(OAUTH_HANDOFF_COOKIE_NAME);
  }
  response.cookies.delete("jobpulse_oauth_state");
  response.headers.set("Cache-Control", "no-store");

  return response;
}
