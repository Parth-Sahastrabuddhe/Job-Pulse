import { getSession } from "@/lib/session";
import { createOtp } from "@/lib/db";
import { sendOtpEmail } from "@/lib/ses";

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

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));

  try {
    createOtp(email.toLowerCase().trim(), code);
    await sendOtpEmail(email.toLowerCase().trim(), code);
  } catch (err) {
    console.error("OTP send error:", err);
    return Response.json({ error: "Failed to send verification code" }, { status: 500 });
  }

  return Response.json({ sent: true });
}
