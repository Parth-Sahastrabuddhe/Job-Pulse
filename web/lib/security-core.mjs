import { isIP } from "node:net";

const EMAIL_MAX_LENGTH = 254;
const LOCAL_PART_MAX_LENGTH = 64;
const EMAIL_RE = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

export class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > EMAIL_MAX_LENGTH ||
    /[\r\n,;]/.test(email) ||
    email.split("@").length !== 2
  ) {
    return null;
  }

  const [localPart] = email.split("@");
  if (
    localPart.length === 0 ||
    localPart.length > LOCAL_PART_MAX_LENGTH ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) return null;
  return EMAIL_RE.test(email) ? email : null;
}

export function bcryptPasswordProblem(value, { minCharacters = 6 } = {}) {
  if (typeof value !== "string") return "Password must be text";
  if (value.length < minCharacters) return `Password must be at least ${minCharacters} characters`;
  // bcrypt's input limit is bytes, not JavaScript characters.
  if (new TextEncoder().encode(value).byteLength > 72) {
    return "Password must be at most 72 UTF-8 bytes";
  }
  return null;
}

export function resolvePublicOrigin(configuredValue, requestUrl, { production = false } = {}) {
  const raw = String(configuredValue || "").trim();
  if (production && !raw) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL is required in production and must be the public HTTPS origin (for example, https://joblookout.app)"
    );
  }

  const candidate = raw || requestUrl;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("NEXT_PUBLIC_BASE_URL must be a valid absolute URL");
  }

  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_BASE_URL must contain only an origin, with no credentials, path, query, or fragment");
  }
  if (production && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_BASE_URL must use https:// in production");
  }
  if (!production && !["http:", "https:"].includes(url.protocol)) {
    throw new Error("NEXT_PUBLIC_BASE_URL must use http:// or https://");
  }

  return url.origin;
}

export function resolveDiscordRedirectUri(configuredValue, publicOrigin, { production = false } = {}) {
  const expected = new URL("/api/auth/callback", publicOrigin).toString();
  const raw = String(configuredValue || "").trim();
  if (!raw) return expected;

  let configured;
  try {
    configured = new URL(raw).toString();
  } catch {
    throw new Error("DISCORD_REDIRECT_URI must be a valid absolute URL");
  }

  if (production && !configured.startsWith("https://")) {
    throw new Error("DISCORD_REDIRECT_URI must use https:// in production");
  }
  if (configured !== expected) {
    throw new Error(`DISCORD_REDIRECT_URI must exactly match ${expected}`);
  }
  return configured;
}

export function trustedClientIp(headers, trustProxy = "") {
  if (String(trustProxy).toLowerCase() !== "nginx") return "direct";

  // deploy/nginx.conf overwrites this header with $remote_addr. Do not use a
  // client-supplied X-Forwarded-For chain here.
  const candidate = String(headers.get("x-real-ip") || "").trim();
  return isIP(candidate) ? candidate : "unknown";
}
