/**
 * mu-scheduler.js — Pure scheduling logic for multi-user notification delivery.
 *
 * No Discord, no DB, no I/O. Fully testable.
 *
 * Exports:
 *   isInQuietHours(start, end, tz, now)   → boolean
 *   shouldDeliverDigest(mode, tz, lastDeliveredAt, now) → boolean
 *   getDeliveryAction(profile, now)        → "send" | "queue"
 */

/**
 * Parse a "HH:MM" time string into total minutes since midnight.
 * @param {string} hhmm
 * @returns {number}
 */
function parseMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Get the current hour and minute in the given IANA timezone using Intl.
 * @param {string} tz  IANA timezone string, e.g. "America/New_York"
 * @param {Date}   now
 * @returns {{ hour: number, minute: number }}
 */
function getLocalTime(tz, now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
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
  // Intl may return hour=24 for midnight in some environments; normalise
  if (hour === 24) hour = 0;
  return { hour, minute };
}

/**
 * Get the weekday number (0=Sunday … 6=Saturday) in the given timezone.
 * @param {string} tz
 * @param {Date}   now
 * @returns {number}
 */
function getLocalDayOfWeek(tz, now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(now);

  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayStr] ?? new Date(now).getDay();
}

/**
 * Get the local date string "YYYY-MM-DD" in the given timezone.
 * @param {string} tz
 * @param {Date}   now
 * @returns {string}
 */
function getLocalDateString(tz, now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA produces YYYY-MM-DD
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if `now` falls within the configured quiet window.
 *
 * @param {string|null} start  "HH:MM" or null
 * @param {string|null} end    "HH:MM" or null
 * @param {string}      tz     IANA timezone
 * @param {Date}        now
 * @returns {boolean}
 */
export function isInQuietHours(start, end, tz, now) {
  if (!start || !end) return false;

  const { hour, minute } = getLocalTime(tz, now);
  const currentMinutes = hour * 60 + minute;
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);

  if (startMinutes < endMinutes) {
    // Same-day range, e.g. 13:00–17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range, e.g. 22:00–08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Returns true when it is time to fire a digest delivery.
 *
 * - "realtime" → always false (no digest)
 * - "daily"    → true after 08:00 in user's TZ, not yet delivered today
 * - "weekly"   → same, but only on Monday
 *
 * @param {"realtime"|"daily"|"weekly"} mode
 * @param {string}      tz              IANA timezone
 * @param {string|null} lastDeliveredAt ISO-8601 string of last delivery, or null
 * @param {Date}        now
 * @returns {boolean}
 */
export function shouldDeliverDigest(mode, tz, lastDeliveredAt, now) {
  if (mode === "realtime") return false;

  const { hour } = getLocalTime(tz, now);
  if (hour < 8) return false;

  // Check if already delivered today (in user's TZ)
  if (lastDeliveredAt) {
    const todayLocal = getLocalDateString(tz, now);
    const lastLocal = getLocalDateString(tz, new Date(lastDeliveredAt));
    if (todayLocal === lastLocal) return false;
  }

  if (mode === "weekly") {
    const dow = getLocalDayOfWeek(tz, now);
    return dow === 1; // Monday
  }

  // "daily"
  return true;
}

/**
 * Decide what to do with a pending notification for a given user profile.
 *
 * Returns:
 *   "send"  — deliver immediately
 *   "queue" — hold (quiet hours or digest mode)
 *
 * @param {{ notification_mode: string, quiet_hours_start: string|null, quiet_hours_end: string|null, quiet_hours_tz: string }} profile
 * @param {Date} now
 * @returns {"send"|"queue"}
 */
export function getDeliveryAction(profile, now) {
  const { notification_mode, quiet_hours_start, quiet_hours_end, quiet_hours_tz } = profile;

  // Non-realtime modes always accumulate into a digest
  if (notification_mode !== "realtime") return "queue";

  // Realtime: suppress during quiet hours
  const tz = quiet_hours_tz || "UTC";
  if (isInQuietHours(quiet_hours_start, quiet_hours_end, tz, now)) return "queue";

  return "send";
}
