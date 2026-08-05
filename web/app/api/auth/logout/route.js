import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";
import { publicBaseUrl, requireSameOrigin } from "@/lib/security";

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  await clearSession();
  const response = NextResponse.redirect(new URL("/", publicBaseUrl(request)), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed; use POST to log out" },
    { status: 405, headers: { Allow: "POST" } }
  );
}
