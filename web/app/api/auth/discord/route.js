import { redirect } from "next/navigation";

export async function GET() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = encodeURIComponent(
    process.env.DISCORD_REDIRECT_URI ||
      `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/auth/callback`
  );

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20email`;

  redirect(discordAuthUrl);
}
