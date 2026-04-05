import { NextResponse } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(request) {
  await clearSession();
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  return NextResponse.redirect(new URL("/", `${proto}://${host}`));
}

export async function GET(request) {
  await clearSession();
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  return NextResponse.redirect(new URL("/", `${proto}://${host}`));
}
