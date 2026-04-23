// Fire-and-forget heartbeat pings to healthchecks.io.
// Never throws; silent no-op when url is falsy. Do not block the caller on network failures.

const TIMEOUT_MS = 5_000;

function silent(err) {
  // stdout only — caller's log() helper isn't imported here to keep this module dependency-free.
  // pm2 captures this to its log file.
  console.error(`[heartbeat] ${err?.message || err}`);
}

async function send(url, { method = "GET", body } = {}) {
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(url, {
      method,
      body,
      signal: controller.signal,
      headers: body ? { "Content-Type": "text/plain" } : undefined,
    });
  } catch (err) {
    silent(err);
  } finally {
    clearTimeout(timer);
  }
}

export async function ping(url) {
  await send(url);
}

export async function pingFail(url, reason) {
  if (!url) return;
  await send(`${url}/fail`, { method: "POST", body: String(reason ?? "") });
}
