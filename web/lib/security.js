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
  return normalizeOrigin(process.env.NEXT_PUBLIC_BASE_URL) || requestUrlOrigin(request);
}

export function requireSameOrigin(request) {
  const sourceOrigin =
    normalizeOrigin(request.headers.get("origin")) ||
    normalizeOrigin(request.headers.get("referer"));
  if (!sourceOrigin) return null;

  const allowed = new Set();
  allowed.add(publicBaseUrl(request));

  if (!allowed.has(sourceOrigin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
