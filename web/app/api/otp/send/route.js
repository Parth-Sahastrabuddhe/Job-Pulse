import crypto from "node:crypto";
import { getSession } from "@/lib/session";
import { createOtp } from "@/lib/db";

const otpAttempts = new Map();
const OTP_RATE_LIMIT = 3;
const OTP_RATE_WINDOW_MS = 5 * 60 * 1000;

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

  const code = String(crypto.randomInt(100000, 1000000));
  const normalizedEmail = email.toLowerCase().trim();

  createOtp(normalizedEmail, code);

  // Try SES first, fall back to console logging
  try {
    const { sendOtpEmail } = await import("@/lib/ses");
    await sendOtpEmail(normalizedEmail, code);
    console.log(`[OTP] Sent to ${normalizedEmail} via SES`);
  } catch (err) {
    // SES not configured — log code to console so admin can retrieve it
    console.log(`[OTP] SES unavailable (${err.name}). Code for ${normalizedEmail}: ${code}`);
  }

  return Response.json({ sent: true });
}
