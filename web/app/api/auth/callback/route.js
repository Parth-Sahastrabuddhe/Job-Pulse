import { redirect } from "next/navigation";
import { createSession } from "@/lib/session";
import { getUserProfile } from "@/lib/db";

export async function GET(request) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");

  if (!code) {
    redirect("/auth?error=missing_code");
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
    redirect("/auth?error=token_exchange_failed");
  }

  if (!tokenData.access_token) {
    redirect("/auth?error=no_access_token");
  }

  // Fetch Discord user profile
  let discordUser;
  try {
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    discordUser = await userRes.json();
  } catch {
    redirect("/auth?error=user_fetch_failed");
  }

  if (!discordUser.id) {
    redirect("/auth?error=invalid_user");
  }

  // Check if user exists in DB
  let existingUser = null;
  try {
    existingUser = getUserProfile(discordUser.id);
  } catch {
    // DB not available during build — fail gracefully
  }

  const profileComplete = !!(existingUser && existingUser.email_verified);

  // Determine role: admin env var takes precedence, otherwise read from DB
  const isAdminById = process.env.ADMIN_DISCORD_ID && discordUser.id === process.env.ADMIN_DISCORD_ID;
  const role = isAdminById ? "admin" : (existingUser?.role || null);

  // Create JWT session
  await createSession({
    discordId: discordUser.id,
    username: discordUser.username,
    avatar: discordUser.avatar,
    role,
    profileComplete,
  });

  // Route: existing verified user → profile, new user → verify
  redirect(profileComplete ? "/profile" : "/verify");
}
