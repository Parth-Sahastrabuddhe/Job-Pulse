import fs from "node:fs";

const DEFAULT_MIN_MEM_MB = 450;
const DEFAULT_NIGHT_START = "00:00";
const DEFAULT_NIGHT_END = "06:00";
const DEFAULT_TIMEZONE = "America/New_York";

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

  if (Number.isFinite(availableMb) && availableMb < minMemMb) {
    return {
      ok: false,
      availableMb,
      minMemMb,
      reason: `available memory ${availableMb} MiB is below Playwright floor ${minMemMb} MiB`,
    };
  }

  return { ok: true, availableMb, minMemMb, reason: "" };
}

export async function launchChromiumWithGuard(chromium, launchOptions = {}, config = {}) {
  const decision = canLaunchPlaywright(config);
  if (!decision.ok) {
    throw new PlaywrightLaunchSkippedError(decision.reason);
  }
  return chromium.launch(launchOptions);
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
