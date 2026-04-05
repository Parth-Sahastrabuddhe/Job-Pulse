import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { getUserProfileByEmail } from "@/lib/db";

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-in-production-32ch");
const COOKIE_NAME = "jobpulse_session";

export async function POST(request) {
  let email, password;
  try {
    const body = await request.json();
    email = body.email;
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const user = getUserProfileByEmail(email.toLowerCase().trim());
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  if (!user.password_hash) {
    return NextResponse.json({ error: "No password set. Please register with Discord first." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Create JWT session
  const isAdmin = user.discord_id === process.env.ADMIN_DISCORD_ID;
  const token = await new SignJWT({
    discordId: user.discord_id,
    username: user.discord_username,
    avatar: null,
    role: isAdmin ? "admin" : (user.role || "user"),
    profileComplete: true,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(SECRET);

  const proto = request.headers.get("x-forwarded-proto") || "http";
  const isHttps = proto === "https";

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
