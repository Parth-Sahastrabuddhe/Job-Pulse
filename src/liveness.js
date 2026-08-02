/**
 * URL liveness checker for ghost job detection.
 * Determines whether a job posting URL is still active before sending notifications.
 */
import { safeFetch } from "./ssrf-guard.js";

const DEAD_TEXT_PATTERNS = [
  // Must end with a dead-status word: JD boilerplate like Boeing's "This
  // position is not contingent upon program award" renders into the first
  // 10 KB on Workday and must NOT match.
  /this\s+(?:position|job|role)\s+(?:has been|is no longer|is not(?:\s+currently)?)\s+(?:available|open|accepting|active|filled|closed|removed|posted)/i,
  /no longer (?:available|accepting|open)/i,
  /position\s+(?:has been\s+)?filled/i,
  /job\s+(?:has been\s+)?(?:closed|removed|expired)/i,
  /page\s+(?:not found|doesn't exist)/i,
];

const CAREERS_ROOT_PATTERNS = [
  /\/careers\/?$/i,
  /\/jobs\/?$/i,
  /\/careers\/search/i,
  /\/jobs\/search/i,
  /\/careers\/home/i,
];

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 10 * 1024; // 10 KB
const MAX_DOWNLOAD_BYTES = 512 * 1024;

/**
 * Checks whether a job posting URL is still active.
 *
 * @param {string} url - The job posting URL to check.
 * @returns {Promise<boolean>} Resolves to true if the job is still live, false if it appears dead.
 */
export async function isJobUrlLive(url, options = {}) {
  // Malformed/non-web URLs are not deliverable job postings. Reject before any
  // network operation rather than treating attacker-controlled schemes as live.
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && process.env.NODE_ENV !== "production")) {
    return false;
  }

  try {
    const fetchImpl = options.fetchImpl || safeFetch;
    const resp = await fetchImpl(parsed.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: options.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    }, {
      requireHttps: process.env.NODE_ENV === "production",
      allowedContentTypes: ["text/html", "application/xhtml+xml", "application/xml", "text/plain"],
      maxResponseBytes: MAX_DOWNLOAD_BYTES,
      timeoutMs: TIMEOUT_MS,
      maxRedirects: 4,
    });

    // HTTP 404 / 410 → dead
    if (resp.status === 404 || resp.status === 410) return false;

    // Soft 404: final URL after redirects is a generic careers root → dead
    const finalUrl = resp.url || url;
    if (CAREERS_ROOT_PATTERNS.some((pattern) => pattern.test(finalUrl))) return false;

    // Read first 10 KB of body to check dead-text patterns
    const bodyText = await readFirstBytes(resp, MAX_BODY_BYTES);
    if (bodyText && DEAD_TEXT_PATTERNS.some((pattern) => pattern.test(bodyText))) return false;

    return true;
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason instanceof Error ? options.signal.reason : error;
    }
    // Unsafe destinations and malformed redirects fail closed. Ordinary network
    // outages remain fail-open so a transient ATS outage does not expire jobs.
    const failClosedCodes = new Set([
      "BLOCKED_URL",
      "PEER_MISMATCH",
      "REDIRECT_BLOCKED",
      "TOO_MANY_REDIRECTS",
      "INVALID_REDIRECT",
      "UNEXPECTED_CONTENT_TYPE",
    ]);
    if (failClosedCodes.has(error?.code)) return false;
    return true;
  }
}

/**
 * Reads at most `maxBytes` from a fetch Response body, then cancels the stream.
 *
 * @param {Response} resp
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
async function readFirstBytes(resp, maxBytes) {
  if (!resp.body) {
    // Fallback for environments where body is not a ReadableStream
    try {
      const text = await resp.text();
      return text.slice(0, maxBytes);
    } catch {
      return '';
    }
  }

  const reader = resp.body.getReader();
  const chunks = [];
  let bytesRead = 0;

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytesRead += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const combined = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined.slice(0, maxBytes));
}
