import bcrypt from "bcryptjs";
import { getSession, createSession } from "@/lib/session";
import { verifyOtp, createUserProfile, getUserProfile, getUserProfileByEmail } from "@/lib/db";

export async function POST(request) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let email, code, firstName, password;
  try {
    const body = await request.json();
    email = body.email;
    code = body.code;
    firstName = body.firstName;
    password = body.password;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!email || !code || !firstName) {
    return Response.json({ error: "email, code, and firstName are required" }, { status: 400 });
  }

  if (!password || password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
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

  // Check if this Discord account is already registered
  const existingByDiscord = getUserProfile(session.discordId);
  if (existingByDiscord) {
    return Response.json({ error: "You already have an account. Please log in instead." }, { status: 409 });
  }

  // Check if this email is taken by another account
  const existingByEmail = getUserProfileByEmail(normalizedEmail);
  if (existingByEmail) {
    return Response.json({ error: "This email is already associated with another account." }, { status: 409 });
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user profile with password
  try {
    createUserProfile({
      discordId: session.discordId,
      discordUsername: session.username,
      firstName: firstName.trim(),
      email: normalizedEmail,
      passwordHash,
    });
  } catch (err) {
    console.error("createUserProfile error:", err);
    return Response.json({ error: "Failed to create account. Please try again." }, { status: 500 });
  }

  // Update session
  await createSession({
    ...session,
    profileComplete: true,
  });

  return Response.json({ verified: true });
}
