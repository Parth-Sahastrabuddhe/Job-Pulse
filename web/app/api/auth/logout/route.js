import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";
import { publicBaseUrl, requireSameOrigin } from "@/lib/security";

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  await clearSession();
  return NextResponse.redirect(new URL("/", publicBaseUrl(request)));
}

export async function GET(request) {
  await clearSession();
  return NextResponse.redirect(new URL("/", publicBaseUrl(request)));
}
