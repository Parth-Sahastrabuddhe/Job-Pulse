/**
 * URL liveness checker for ghost job detection.
 * Determines whether a job posting URL is still active before sending notifications.
 */

const DEAD_TEXT_PATTERNS = [
  /this\s+(?:position|job|role)\s+(?:has been|is no longer|is not)/i,
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

/**
 * Checks whether a job posting URL is still active.
 *
 * @param {string} url - The job posting URL to check.
 * @returns {Promise<boolean>} Resolves to true if the job is still live, false if it appears dead.
 */
export async function isJobUrlLive(url) {
  // No URL or non-HTTP URL → assume live
  if (!url || typeof url !== 'string') return true;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
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
  } catch {
    // Network error, timeout, or any transient failure → assume live
    return true;
  } finally {
    clearTimeout(timer);
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
