/* Seen-post memory logic (pure; storage I/O lives in content.js).
 * Chip shows only when first seen > 20 min ago so LinkedIn's scroll-recycling
 * within one session never marks a post "seen". Prune by LAST seen at 7 days.
 * Entry shape: { t: firstSeenMs, l: lastSeenMs, v: verdict, c: copiedBool }
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});
  const CHIP_AFTER_MS = 20 * 60 * 1000;
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  // content.js validates URNs, but this module must be safe for any caller:
  // these keys would read/write Object.prototype on a plain-object map.
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  function chipInfo(entry, now) {
    if (!entry) return null;
    return now - entry.t > CHIP_AFTER_MS ? { firstSeen: entry.t } : null;
  }
  function record(map, urn, verdict, now) {
    if (!urn || BAD_KEYS.has(urn)) return { t: now, l: now, v: verdict, c: false };
    const e = Object.prototype.hasOwnProperty.call(map, urn) ? map[urn] : null;
    if (e) { e.l = now; e.v = verdict; return e; }
    return (map[urn] = { t: now, l: now, v: verdict, c: false });
  }
  function markCopied(map, urn, now) {
    if (!urn || BAD_KEYS.has(urn)) return { t: now, l: now, v: "genuine", c: true };
    const e = record(map, urn, (map[urn] && map[urn].v) || "genuine", now);
    e.c = true;
    return e;
  }
  function prune(map, now) {
    let removed = 0;
    for (const k of Object.keys(map)) {
      if (now - map[k].l > MAX_AGE_MS) { delete map[k]; removed++; }
    }
    return removed;
  }

  JP.seen = { CHIP_AFTER_MS, MAX_AGE_MS, chipInfo, record, markCopied, prune };
  if (typeof module === "object" && module.exports) module.exports = JP.seen;
})(typeof self !== "undefined" ? self : globalThis);
