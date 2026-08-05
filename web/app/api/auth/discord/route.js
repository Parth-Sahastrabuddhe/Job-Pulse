import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { discordRedirectUri, publicBaseUrl } from "@/lib/security";

export async function GET(request) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "Discord OAuth is not configured: DISCORD_CLIENT_ID is missing" },
      { status: 503 }
    );
  }

  let redirectUri;
  let baseUrl;
  try {
    redirectUri = discordRedirectUri(request);
    baseUrl = publicBaseUrl(request);
  } catch (error) {
    console.error("[oauth] Invalid public URL configuration:", error.message);
    return NextResponse.json({ error: error.message }, { status: 503 });
  }

  const scopes = process.env.DISCORD_GUILD_ID
    ? "identify email guilds.join"
    : "identify email";
  const state = crypto.randomBytes(16).toString("hex");

  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    state,
  }).toString();

  const response = NextResponse.redirect(discordAuthUrl);
  response.cookies.set("jobpulse_oauth_state", state, {
    httpOnly: true,
    secure: new URL(baseUrl).protocol === "https:",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
