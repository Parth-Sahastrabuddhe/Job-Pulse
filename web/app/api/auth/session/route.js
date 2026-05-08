import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { discordAccessToken: _discard, ...safeSession } = session;
  return Response.json(safeSession);
}
