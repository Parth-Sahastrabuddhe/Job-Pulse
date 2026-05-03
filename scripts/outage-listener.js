import fs from "node:fs/promises";
import path from "node:path";

// Outage listener — Discord WS subscriber that triggers claude -p on
// healthchecks.io "is DOWN" alerts. See docs/superpowers/specs/2026-05-03-outage-listener-design.md.

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

const DOWN_RE = /\bis\s+down\b/i;

export function isDownAlert(content) {
  if (typeof content !== "string" || content.length === 0) return false;
  return DOWN_RE.test(content);
}

export function extractCheckName(content) {
  if (typeof content !== "string") return "unknown";
  const bold = content.match(/\*\*([^*]+)\*\*/);
  if (bold) return bold[1].trim();
  const quoted = content.match(/"([^"]+)"/) || content.match(/'([^']+)'/);
  if (quoted) return quoted[1].trim();
  return "unknown";
}

export function shouldDebounce(nowMs, lastRunMs, debounceMs) {
  if (!lastRunMs) return false;
  return nowMs - lastRunMs <= debounceMs;
}

export function shouldCap(runTimestampsMs, nowMs, windowMs, maxRuns) {
  const cutoff = nowMs - windowMs;
  const recent = runTimestampsMs.filter((t) => t >= cutoff);
  return recent.length >= maxRuns;
}

// ─── Run-log persistence (sliding-window cap state) ──────────────────────────

export async function readRunLog(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendRunLog(filePath, timestampMs) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readRunLog(filePath);
  existing.push(timestampMs);
  await fs.writeFile(filePath, JSON.stringify(existing), "utf8");
}
