// Ordered heartbeat pings to healthchecks.io.
// Never throws and silently no-ops when the URL is falsy. Callers may await a
// state transition or deliberately use `void` when fire-and-forget is safe.

import fs from "node:fs";

const TIMEOUT_MS = 5_000;
const queuesByUrl = new Map();

export function writeLivenessBeacon(filePath, value = new Date().toISOString()) {
  fs.writeFileSync(filePath, String(value), { encoding: "utf8", mode: 0o600 });
  // writeFile's mode only applies when creating a file. Harden an existing
  // beacon too, including one left behind by an older deployment or umask.
  fs.chmodSync(filePath, 0o600);
}

function silent(err) {
  // caller's log() helper isn't imported here to keep this module dependency-free.
  // pm2 captures stderr to its log file.
  console.error(`[heartbeat] ${err?.message || err}`);
}

async function sendNow(url, { method = "GET", body } = {}) {
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

// Healthchecks.io stores the state of the latest request. Serialize requests
// per check URL so an older slow success cannot arrive after a newer failure
// and incorrectly turn the check green again. Different checks (micro/MU) do
// not block one another.
function send(url, options, queueKey = url) {
  if (!url) return Promise.resolve();
  const previous = queuesByUrl.get(queueKey) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(() => sendNow(url, options));
  queuesByUrl.set(queueKey, current);
  const clear = () => {
    if (queuesByUrl.get(queueKey) === current) queuesByUrl.delete(queueKey);
  };
  current.then(clear, clear);
  return current;
}

export async function ping(url) {
  await send(url);
}

export async function pingFail(url, reason) {
  if (!url) return;
  await send(
    `${url}/fail`,
    { method: "POST", body: String(reason ?? "") },
    url,
  );
}
