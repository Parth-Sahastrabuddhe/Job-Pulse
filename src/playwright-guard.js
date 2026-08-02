import fs from "node:fs";
import { safeFetch } from "./ssrf-guard.js";

const DEFAULT_MIN_MEM_MB = 450;
const DEFAULT_NIGHT_START = "00:00";
const DEFAULT_NIGHT_END = "06:00";
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_MAX_CONCURRENT = 1;

let activeLaunchReservations = 0;
const launchQueue = [];

export class PlaywrightLaunchSkippedError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaywrightLaunchSkippedError";
    this.code = "PLAYWRIGHT_SKIPPED";
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseMinutes(hhmm, fallback) {
  const match = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function localMinutes(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || DEFAULT_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

export function isWithinDailyWindow(start, end, tz, now = new Date()) {
  const startMinutes = parseMinutes(start, parseMinutes(DEFAULT_NIGHT_START, 0));
  const endMinutes = parseMinutes(end, parseMinutes(DEFAULT_NIGHT_END, 6 * 60));
  const current = localMinutes(tz, now);

  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

function readLinuxMemAvailableMb() {
  const content = fs.readFileSync("/proc/meminfo", "utf8");
  const values = new Map();

  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1], Number.parseInt(match[2], 10));
  }

  const availableKb = values.get("MemAvailable");
  if (Number.isFinite(availableKb)) return Math.floor(availableKb / 1024);

  const fallbackKb =
    (values.get("MemFree") || 0) +
    (values.get("Buffers") || 0) +
    (values.get("Cached") || 0);
  return fallbackKb > 0 ? Math.floor(fallbackKb / 1024) : null;
}

export function getMemAvailableMb() {
  if (process.platform !== "linux") return Number.POSITIVE_INFINITY;

  try {
    return readLinuxMemAvailableMb();
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function getPlaywrightMinMemMb(config = {}) {
  return parsePositiveInt(
    config.playwrightMinMemMb ?? process.env.PLAYWRIGHT_MIN_MEM_MB,
    DEFAULT_MIN_MEM_MB
  );
}

export function canLaunchPlaywright(config = {}) {
  const minMemMb = getPlaywrightMinMemMb(config);
  const availableMb = getMemAvailableMb();
  const reservedMb = Math.max(0, Number(config.reservedSlots || 0)) * minMemMb;
  const effectiveAvailableMb = Number.isFinite(availableMb) ? availableMb - reservedMb : availableMb;

  if (Number.isFinite(effectiveAvailableMb) && effectiveAvailableMb < minMemMb) {
    return {
      ok: false,
      availableMb,
      minMemMb,
      reason: `available memory ${availableMb} MiB minus ${reservedMb} MiB reserved is below Playwright floor ${minMemMb} MiB`,
    };
  }

  return { ok: true, availableMb, minMemMb, reason: "" };
}

function maxConcurrentPlaywright(config = {}) {
  return parsePositiveInt(
    config.playwrightMaxConcurrent ?? process.env.PLAYWRIGHT_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT
  );
}

function drainLaunchQueue() {
  for (let index = 0; index < launchQueue.length;) {
    const item = launchQueue[index];
    if (item.signal?.aborted) {
      launchQueue.splice(index, 1);
      item.reject(item.signal.reason || new PlaywrightLaunchSkippedError("Playwright launch was aborted"));
      continue;
    }
    if (activeLaunchReservations >= item.maxConcurrent) break;

    launchQueue.splice(index, 1);
    activeLaunchReservations += 1;
    item.signal?.removeEventListener("abort", item.onAbort);
    let released = false;
    item.resolve(() => {
      if (released) return;
      released = true;
      activeLaunchReservations = Math.max(0, activeLaunchReservations - 1);
      queueMicrotask(drainLaunchQueue);
    });
  }
}

function reserveLaunchSlot(config = {}) {
  const signal = config.signal;
  if (signal?.aborted) return Promise.reject(signal.reason || new PlaywrightLaunchSkippedError("Playwright launch was aborted"));
  return new Promise((resolve, reject) => {
    const item = {
      resolve,
      reject,
      signal,
      maxConcurrent: maxConcurrentPlaywright(config),
      onAbort: null,
    };
    item.onAbort = () => {
      const index = launchQueue.indexOf(item);
      if (index >= 0) launchQueue.splice(index, 1);
      reject(signal.reason || new PlaywrightLaunchSkippedError("Playwright launch was aborted"));
    };
    signal?.addEventListener("abort", item.onAbort, { once: true });
    launchQueue.push(item);
    drainLaunchQueue();
  });
}

function minimalBrowserEnv(env = process.env) {
  const allowed = [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ",
    "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "FONTCONFIG_PATH",
    "DBUS_SESSION_BUS_ADDRESS",
  ];
  return Object.fromEntries(allowed.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]]));
}

function sandboxedLaunchOptions(launchOptions = {}) {
  const production = process.env.NODE_ENV === "production";
  const explicitDevelopment = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const args = Array.isArray(launchOptions.args) ? launchOptions.args : [];
  const unsafeArgs = new Set(["--no-sandbox", "--disable-setuid-sandbox"]);
  const requestedUnsafe = launchOptions.chromiumSandbox === false || args.some((arg) => unsafeArgs.has(arg));
  const devEscape = explicitDevelopment && process.env.PLAYWRIGHT_ALLOW_NO_SANDBOX === "1" && requestedUnsafe;

  if (production && requestedUnsafe) {
    throw new PlaywrightLaunchSkippedError("Chromium sandbox cannot be disabled in production");
  }

  return {
    ...launchOptions,
    args: [...new Set([
      ...args.filter((arg) => !unsafeArgs.has(arg)),
      // Speculative DNS bypasses request routing and is unnecessary for these
      // short-lived scraper pages.
      "--dns-prefetch-disable",
    ])],
    chromiumSandbox: !devEscape,
    env: minimalBrowserEnv(launchOptions.env || process.env),
  };
}

export async function launchChromiumWithGuard(chromium, launchOptions = {}, config = {}) {
  const release = await reserveLaunchSlot(config);
  let browser;
  try {
    const decision = canLaunchPlaywright({
      ...config,
      reservedSlots: activeLaunchReservations - 1,
    });
    if (!decision.ok) {
      throw new PlaywrightLaunchSkippedError(decision.reason);
    }
    browser = await chromium.launch(sandboxedLaunchOptions(launchOptions));
  } catch (error) {
    release();
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    config.signal?.removeEventListener("abort", onAbort);
    release();
  };
  const originalClose = browser.close.bind(browser);
  browser.close = async (...args) => {
    try {
      return await originalClose(...args);
    } finally {
      cleanup();
    }
  };
  browser.on?.("disconnected", cleanup);
  const onAbort = () => {
    browser.close().catch(() => cleanup());
  };
  config.signal?.addEventListener("abort", onAbort, { once: true });
  if (config.signal?.aborted) onAbort();
  return browser;
}

/**
 * Create a browser page whose network is fail-closed.
 *
 * Merely validating page.goto() before navigation is insufficient: Chromium
 * performs its own DNS lookup and a page can issue arbitrary subrequests. All
 * HTTP(S) requests are therefore fulfilled through safeFetch, which validates
 * every destination and pins the validated IP to the socket. WebSockets are
 * blocked because they cannot use that pinned transport.
 */
export async function newRestrictedPage(browser, policy = {}) {
  if (!Array.isArray(policy.allowedHosts) || policy.allowedHosts.length === 0) {
    throw new TypeError("newRestrictedPage requires an explicit allowedHosts policy");
  }

  const {
    contextOptions = {},
    fetcher = safeFetch,
    allowedHosts,
    signal,
    timeoutMs = 30_000,
    maxRequestBytes = 8 * 1024 * 1024,
    maxResponseBytes = 8 * 1024 * 1024,
    onBlocked,
    allowRequest,
  } = policy;
  const context = await browser.newContext({
    ...contextOptions,
    serviceWorkers: "block",
    ignoreHTTPSErrors: false,
  });

  try {
    await context.addInitScript(() => {
      // These channels do not pass through Playwright's HTTP route. Job pages
      // do not need them, so remove them before any remote script executes.
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
        try { Object.defineProperty(globalThis, name, { value: undefined, configurable: false }); } catch {}
      }
      try {
        Object.defineProperty(navigator, "sendBeacon", {
          value: () => false,
          configurable: false,
        });
      } catch {}
    });

    await context.route("**/*", async (route) => {
      const request = route.request();
      try {
        if (signal?.aborted) throw signal.reason || new Error("Browser request aborted");
        if (allowRequest && !(await allowRequest(request))) {
          throw new Error("Browser request blocked by page policy");
        }
        const headers = { ...request.headers() };
        // The pinned transport derives framing from the actual body.
        delete headers.host;
        delete headers["content-length"];
        delete headers.connection;
        headers["accept-encoding"] = "identity";
        const body = request.postDataBuffer?.() || undefined;
        const response = await fetcher(request.url(), {
          method: request.method(),
          headers,
          body,
          redirect: "manual",
          signal,
        }, {
          requireHttps: true,
          allowedHosts,
          timeoutMs,
          maxRequestBytes,
          maxResponseBytes,
          lookup: policy.lookup,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        // Playwright recalculates response framing for the buffered body.
        delete responseHeaders["content-length"];
        delete responseHeaders["transfer-encoding"];
        delete responseHeaders.connection;
        const responseBody = request.method() === "HEAD"
          ? Buffer.alloc(0)
          : Buffer.from(await response.arrayBuffer());
        await route.fulfill({
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
        });
      } catch (error) {
        onBlocked?.(request.url(), error);
        await route.abort("blockedbyclient").catch(() => {});
      }
    });

    await context.routeWebSocket("**/*", async (socket) => {
      await socket.close({ code: 1008, reason: "Network policy blocked WebSocket" });
    });

    if (signal?.aborted) throw signal.reason || new Error("Browser page creation aborted");
    return await context.newPage();
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

export function shouldRunScheduledPlaywrightSource(config = {}, now = new Date()) {
  const schedule = String(config.playwrightSchedule || process.env.PLAYWRIGHT_SCHEDULE || "always")
    .trim()
    .toLowerCase();

  if (["0", "false", "off", "disabled", "never"].includes(schedule)) {
    return { ok: false, reason: "Playwright schedule is disabled" };
  }

  if (schedule === "night" || schedule === "nightly") {
    const start = config.playwrightNightStart || process.env.PLAYWRIGHT_NIGHT_START || DEFAULT_NIGHT_START;
    const end = config.playwrightNightEnd || process.env.PLAYWRIGHT_NIGHT_END || DEFAULT_NIGHT_END;
    const tz = config.playwrightTimezone || process.env.PLAYWRIGHT_TIMEZONE || DEFAULT_TIMEZONE;
    if (!isWithinDailyWindow(start, end, tz, now)) {
      return { ok: false, reason: `outside Playwright window ${start}-${end} ${tz}` };
    }
  }

  return { ok: true, reason: "" };
}
