import crypto from "node:crypto";

export function passwordResetCodeHash(email, code, secret = process.env.SESSION_SECRET) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("A strong SESSION_SECRET is required for password reset codes");
  }
  return crypto
    .createHmac("sha256", secret)
    .update(`joblookout-password-reset\u0000${email}\u0000${code}`)
    .digest("hex");
}
