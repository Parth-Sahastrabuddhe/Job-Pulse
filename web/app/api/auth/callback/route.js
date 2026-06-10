import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { publicBaseUrl } from "@/lib/security";
import { getUserProfile } from "@/lib/db";
import { signSession, sessionCookieOptions, COOKIE_NAME } from "@/lib/session";

export async function GET(request) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.redirect(new URL("/auth?error=missing_code", request.url));
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("jobpulse_oauth_state")?.value;
  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/auth?error=invalid_state", request.url));
  }

  const redirectUri =
    process.env.DISCORD_REDIRECT_URI ||
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/auth/callback`;

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
    });
    tokenData = await tokenRes.json();
  } catch {
    return NextResponse.redirect(new URL("/auth?error=token_exchange_failed", request.url));
  }

  if (!tokenData.access_token) {
    return NextResponse.redirect(new URL("/auth?error=no_access_token", request.url));
  }

  // Fetch Discord user profile
  let discordUser;
  try {
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    discordUser = await userRes.json();
  } catch {
    return NextResponse.redirect(new URL("/auth?error=user_fetch_failed", request.url));
  }

  if (!discordUser.id) {
    return NextResponse.redirect(new URL("/auth?error=invalid_user", request.url));
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

  // Create JWT token. discordAccessToken is carried through to /api/otp/verify
  // so it can add the user to the Discord guild after OTP verification completes.
  const token = await signSession({
    discordId: discordUser.id,
    username: discordUser.username,
    avatar: discordUser.avatar,
    role,
    profileComplete,
    discordAccessToken: profileComplete ? undefined : tokenData.access_token,
  });

  // Redirect with session cookie set on the response.
  const baseUrl = publicBaseUrl(request);
  const destination = profileComplete ? "/profile" : "/verify";
  const response = NextResponse.redirect(new URL(destination, baseUrl));
  const isHttps = baseUrl.startsWith("https://");
  response.cookies.set(COOKIE_NAME, token, sessionCookieOptions(isHttps));
  response.cookies.delete("jobpulse_oauth_state");

  return response;
}
