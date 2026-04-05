import crypto from "node:crypto";
import { getSession } from "@/lib/session";
import { createOtp } from "@/lib/db";
import { sendOtpEmail } from "@/lib/ses";

const otpAttempts = new Map(); // discordId -> { count, resetAt }
const OTP_RATE_LIMIT = 3;
const OTP_RATE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export async function POST(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email;
  try {
    const body = await request.json();
    email = body.email;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return Response.json({ error: "Valid email is required" }, { status: 400 });
  }

  // Rate limiting
  const userId = session.discordId;
  const now = Date.now();
  const attempts = otpAttempts.get(userId);
  if (attempts && attempts.resetAt > now && attempts.count >= OTP_RATE_LIMIT) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  if (!attempts || attempts.resetAt <= now) {
    otpAttempts.set(userId, { count: 1, resetAt: now + OTP_RATE_WINDOW_MS });
  } else {
    attempts.count++;
  }

  // Generate cryptographically secure 6-digit code
  const code = String(crypto.randomInt(100000, 1000000));

  try {
    createOtp(email.toLowerCase().trim(), code);
    await sendOtpEmail(email.toLowerCase().trim(), code);
  } catch (err) {
    console.error("OTP send error:", err);
    return Response.json({ error: "Failed to send verification code" }, { status: 500 });
  }

  return Response.json({ sent: true });
}
