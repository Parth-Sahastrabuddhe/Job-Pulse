import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getUserProfile } from "@/lib/db";

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-in-production-32ch");
const COOKIE_NAME = "jobpulse_session";

export async function GET(request) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/auth?error=missing_code", request.url));
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

  // Create JWT token
  const token = await new SignJWT({
    discordId: discordUser.id,
    username: discordUser.username,
    avatar: discordUser.avatar,
    role,
    profileComplete,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET);

  // Redirect with session cookie set on the response
  const destination = profileComplete ? "/profile" : "/verify";
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
