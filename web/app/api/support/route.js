import { consumeRateLimit, createPublicSupportRequest } from "@/lib/db";
import {
  getTrustedClientIp,
  jsonBodyError,
  normalizeEmail,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";

// Public support intake: deliberately requires NO session so people locked out
// of their account can still reach us. Abuse is bounded by same-origin checks
// and a strict per-IP daily limit.

const DESCRIPTION_MAX_LENGTH = 2000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_LIMIT = 5;

const ALLOWED_CATEGORIES = ["question", "account", "bug", "missing_jobs", "feature_request", "other"];

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 8 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { category, description, email } = body;
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return Response.json(
      { error: "A valid email address is required so we can reply." },
      { status: 400 }
    );
  }
  if (!category || !ALLOWED_CATEGORIES.includes(category)) {
    return Response.json(
      { error: `Category must be one of: ${ALLOWED_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return Response.json({ error: "Please describe the issue in at least 10 characters." }, { status: 400 });
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return Response.json(
      { error: `Description must be ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.` },
      { status: 400 }
    );
  }

  let ipLimit;
  try {
    ipLimit = consumeRateLimit({
      scope: "public-support-ip",
      keyHash: opaqueRateLimitKey(getTrustedClientIp(request)),
      limit: IP_LIMIT,
      windowMs: WINDOW_MS,
    });
  } catch (error) {
    console.error("[public-support] Rate limiter error:", error);
    return Response.json({ error: "Support is temporarily unavailable" }, { status: 503 });
  }
  if (!ipLimit.allowed) {
    return Response.json(
      { error: "Too many submissions. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  try {
    const id = createPublicSupportRequest(normalizedEmail, category, description.trim());
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Public support create error:", err);
    return Response.json({ error: "Failed to submit. Please try again." }, { status: 500 });
  }
}
