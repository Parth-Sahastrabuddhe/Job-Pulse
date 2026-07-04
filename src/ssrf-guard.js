/**
 * ssrf-guard.js - shared SSRF protection for user-supplied endpoint URLs.
 *
 * SHARED MODULE: imported by the bot (src/llm-client.js, call time) and the
 * Next.js app (web/lib/llm-ping.js via @bot/ssrf-guard, save time). Keep it
 * pure: node:dns and node:net only.
 *
 * Unguarded, a user-supplied base URL is a direct line to the EC2 metadata
 * service (169.254.169.254) or anything else inside the network. Thrown
 * errors carry `.blocked = true`.
 */
import dns from "node:dns/promises";
import net from "node:net";

export function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. EC2 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const low = String(ip).toLowerCase();
  if (low === "::" || low === "::1") return true;
  if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return true; // fe80::/10
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7
  if (low.startsWith("::ffff:")) return isBlockedIp(low.slice(7)); // v4-mapped
  return false;
}

function blockedError(message) {
  const err = new Error(message);
  err.blocked = true;
  return err;
}

export async function assertSafeUrl(urlString) {
  let url;
  try {
    url = new URL(String(urlString));
  } catch {
    throw blockedError("Invalid endpoint URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blockedError("Endpoint must be http or https");
  }
  if (url.username || url.password) {
    throw blockedError("Credentials in the endpoint URL are not allowed");
  }
  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw blockedError("Endpoint hostname did not resolve");
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw blockedError("Endpoint resolves to a blocked address range");
    }
  }
}
