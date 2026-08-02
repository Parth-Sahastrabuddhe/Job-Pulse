import crypto from "node:crypto";

/** Stable short identifier embedded in Discord button custom IDs. */
export function jobButtonHash(jobKey) {
  return crypto.createHash("sha1").update(String(jobKey || "")).digest("hex").slice(0, 16);
}
