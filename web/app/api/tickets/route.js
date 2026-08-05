import { getSession } from "@/lib/session";
import { consumeRateLimit, getUserTickets, createSupportTicket } from "@/lib/db";
import {
  getTrustedClientIp,
  jsonBodyError,
  opaqueRateLimitKey,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/security";

const DESCRIPTION_MAX_LENGTH = 4000;
const TICKET_WINDOW_MS = 24 * 60 * 60 * 1000;
const TICKET_USER_LIMIT = 10;
const TICKET_IP_LIMIT = 50;

function submissionLimitResponse(retryAfterSeconds) {
  return Response.json(
    { error: "Too many submissions. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.profileComplete) {
    return Response.json({ error: "Complete account verification before creating tickets" }, { status: 403 });
  }

  try {
    const tickets = getUserTickets(session.discordId);
    return Response.json({ tickets });
  } catch (err) {
    console.error("Tickets fetch error:", err);
    return Response.json({ error: "Failed to fetch tickets" }, { status: 500 });
  }
}

export async function POST(request) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.profileComplete) {
    return Response.json({ error: "Complete account verification before creating tickets" }, { status: 403 });
  }

  let body;
  try {
    body = await readJsonBody(request, { maxBytes: 8 * 1024 });
  } catch (error) {
    return jsonBodyError(error) || Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { category, description } = body;
  const allowedCategories = ["question", "account", "bug", "missing_jobs", "feature_request", "other"];

  if (!category || !allowedCategories.includes(category)) {
    return Response.json(
      { error: `Category must be one of: ${allowedCategories.join(", ")}` },
      { status: 400 }
    );
  }

  if (!description || typeof description !== "string" || description.trim().length < 10) {
    return Response.json(
      { error: "Description must be at least 10 characters." },
      { status: 400 }
    );
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return Response.json(
      { error: `Description must be ${DESCRIPTION_MAX_LENGTH.toLocaleString()} characters or fewer.` },
      { status: 400 }
    );
  }

  let userLimit;
  let ipLimit;
  try {
    userLimit = consumeRateLimit({
      scope: "ticket-create-user",
      keyHash: opaqueRateLimitKey(session.discordId),
      limit: TICKET_USER_LIMIT,
      windowMs: TICKET_WINDOW_MS,
    });
    ipLimit = consumeRateLimit({
      scope: "ticket-create-ip",
      keyHash: opaqueRateLimitKey(getTrustedClientIp(request)),
      limit: TICKET_IP_LIMIT,
      windowMs: TICKET_WINDOW_MS,
    });
  } catch (error) {
    console.error("[ticket] Rate limiter error:", error);
    return Response.json({ error: "Support tickets are temporarily unavailable" }, { status: 503 });
  }
  if (!userLimit.allowed || !ipLimit.allowed) {
    return submissionLimitResponse(Math.max(userLimit.retryAfterSeconds, ipLimit.retryAfterSeconds));
  }

  try {
    const id = createSupportTicket(session.discordId, category, description.trim());
    return Response.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Ticket create error:", err);
    return Response.json({ error: "Failed to create ticket" }, { status: 500 });
  }
}
