import { getSession } from "@/lib/session";
import { consumeRateLimit, createCompanySuggestion } from "@/lib/db";
import {
  getTrustedClientIp,
  jsonBodyError,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";

const COMPANY_NAME_MAX_LENGTH = 200;
const CAREERS_URL_MAX_LENGTH = 2048;
const REASON_MAX_LENGTH = 2000;
const SUGGESTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const SUGGESTION_USER_LIMIT = 5;
const SUGGESTION_IP_LIMIT = 30;

function submissionLimitResponse(retryAfterSeconds) {
  return Response.json(
    { error: "Too many submissions. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.profileComplete) {
    return Response.json({ error: "Complete account verification before submitting suggestions" }, { status: 403 });
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 8 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { companyName, careersUrl, reason } = body;

  if (!companyName || typeof companyName !== "string" || companyName.trim().length === 0) {
    return Response.json({ error: "Company name is required." }, { status: 400 });
  }
  if (companyName.length > COMPANY_NAME_MAX_LENGTH) {
    return Response.json({ error: `Company name must be ${COMPANY_NAME_MAX_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (careersUrl !== undefined && typeof careersUrl !== "string") {
    return Response.json({ error: "Careers URL must be a string." }, { status: 400 });
  }
  const normalizedUrl = String(careersUrl || "").trim();
  if (normalizedUrl.length > CAREERS_URL_MAX_LENGTH) {
    return Response.json({ error: "Careers URL is too long." }, { status: 400 });
  }
  if (normalizedUrl) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid");
    } catch {
      return Response.json({ error: "Careers URL must be a valid https:// URL." }, { status: 400 });
    }
  }
  if (reason !== undefined && typeof reason !== "string") {
    return Response.json({ error: "Reason must be a string." }, { status: 400 });
  }
  if (String(reason || "").length > REASON_MAX_LENGTH) {
    return Response.json({ error: `Reason must be ${REASON_MAX_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
  }

  let userLimit;
  let ipLimit;
  try {
    userLimit = consumeRateLimit({
      scope: "suggestion-create-user",
      keyHash: opaqueRateLimitKey(session.discordId),
      limit: SUGGESTION_USER_LIMIT,
      windowMs: SUGGESTION_WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "suggestion-create-ip",
      keyHash: opaqueRateLimitKey(getTrustedClientIp(request)),
      limit: SUGGESTION_IP_LIMIT,
      windowMs: SUGGESTION_WINDOW_MS,
    });
  } catch (error) {
    console.error("[suggestion] Rate limiter error:", error);
    return Response.json({ error: "Suggestions are temporarily unavailable" }, { status: 503 });
  }
  if (!userLimit.allowed || !ipLimit.allowed) {
    return submissionLimitResponse(Math.max(userLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
  }

  try {
    const id = createCompanySuggestion(
      session.discordId,
      companyName.trim(),
      normalizedUrl,
      String(reason || "").trim()
    );
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Suggestion create error:", err);
    return Response.json({ error: "Failed to submit suggestion" }, { status: 500 });
  }
}
