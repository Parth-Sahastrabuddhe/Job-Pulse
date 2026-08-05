import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // Defense in depth for sessions created by releases predating the encrypted
  // one-time OAuth handoff. Never reflect an OAuth bearer token to JavaScript.
  const { discordAccessToken: _discard, ...safeSession } = session;
  return Response.json(safeSession, { headers: { "Cache-Control": "no-store" } });
}
