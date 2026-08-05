import crypto from "node:crypto";
import {
  bcryptPasswordProblem,
  RequestBodyError,
  normalizeEmail,
  resolveDiscordRedirectUri,
  resolvePublicOrigin,
  trustedClientIp,
} from "./security-core.mjs";

function normalizeOrigin(value) {
  if (!value || value === "null") return "";
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function requestUrlOrigin(request) {
  const url = new URL(request.url);
  return normalizeOrigin(url.origin);
}

export function publicBaseUrl(request) {
  return resolvePublicOrigin(
    process.env.NEXT_PUBLIC_BASE_URL,
    requestUrlOrigin(request),
    { production: process.env.NODE_ENV === "production" }
  );
}

export function discordRedirectUri(request) {
  const origin = publicBaseUrl(request);
  return resolveDiscordRedirectUri(
    process.env.DISCORD_REDIRECT_URI,
    origin,
    { production: process.env.NODE_ENV === "production" }
  );
}

export function requireSameOrigin(request) {
  const originHeader = request.headers.get("origin");
  // If a client sent Origin, it is authoritative. Never let an explicit
  // opaque (`null`) or malformed Origin fall through to a Referer value.
  const sourceOrigin = originHeader === null
    ? normalizeOrigin(request.headers.get("referer"))
    : normalizeOrigin(originHeader);
  // Every browser state-changing request made by this app supplies Origin or
  // Referer. Missing source metadata is therefore not a compatibility signal;
  // accepting it would turn this check into an allow-on-unknown CSRF guard.
  if (!sourceOrigin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const allowed = new Set();
  allowed.add(publicBaseUrl(request));

  // Dev only: `next dev` canonicalizes request.url to its bind host, so the
  // computed base origin never matches when the site is browsed via another
  // hostname. Trusting the Host header keeps the same-origin semantics.
  if (process.env.NODE_ENV !== "production") {
    const hostHeader = request.headers.get("host");
    if (hostHeader) allowed.add(normalizeOrigin(`http://${hostHeader}`));
  }

  if (!allowed.has(sourceOrigin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export function getTrustedClientIp(request) {
  return trustedClientIp(request.headers, process.env.TRUST_PROXY);
}

export function opaqueRateLimitKey(...parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex");
}

export async function readJsonBody(request, { maxBytes = 16 * 1024 } = {}) {
  const contentLength = Number.parseInt(request.headers.get("content-length") || "", 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError("Request body is too large", 413);
  }
  if (!request.body) throw new RequestBodyError("Invalid request body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError("Request body is too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError("Invalid request body");
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected object");
    }
    return parsed;
  } catch {
    throw new RequestBodyError("Invalid request body");
  }
}

export function jsonBodyError(error) {
  if (!(error instanceof RequestBodyError)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}

export { bcryptPasswordProblem, normalizeEmail };
