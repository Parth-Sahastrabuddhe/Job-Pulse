import { getSession, createSession } from "@/lib/session";
import { verifyOtp, createUserProfile } from "@/lib/db";

export async function POST(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email, code, firstName;
  try {
    const body = await request.json();
    email = body.email;
    code = body.code;
    firstName = body.firstName;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !code || !firstName) {
    return Response.json({ error: "email, code, and firstName are required" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  let valid = false;
  try {
    valid = verifyOtp(normalizedEmail, String(code));
  } catch (err) {
    console.error("OTP verify error:", err);
    return Response.json({ error: "Verification failed" }, { status: 500 });
  }

  if (!valid) {
    return Response.json({ error: "Invalid or expired code" }, { status: 400 });
  }

  // Create user profile
  try {
    createUserProfile({
      discordId: session.discordId,
      discordUsername: session.username,
      firstName: firstName.trim(),
      email: normalizedEmail,
    });
  } catch (err) {
    // Profile may already exist (race condition) — not fatal
    console.error("createUserProfile error:", err);
  }

  // Update session with profileComplete: true
  await createSession({
    ...session,
    profileComplete: true,
  });

  return Response.json({ verified: true });
}
