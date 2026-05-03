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

// ─── Orchestration ───────────────────────────────────────────────────────────

const DEBOUNCE_MS = 20 * 60_000;
const CAP_WINDOW_MS = 24 * 60 * 60_000;
const CAP_MAX_RUNS = 3;
const CLAUDE_TIMEOUT_MS = 15 * 60_000;

function fillPrompt(template, vars) {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.split(`{{${k}}}`).join(v),
    template
  );
}

export async function processAlert({
  content,
  now,
  runLog,
  lockHeld,
  spawnImpl,
  promptTemplate,
  promptVars,
  runLogPath,
  writeRun,
  acquireLock,
  releaseLock,
}) {
  if (!isDownAlert(content)) {
    return { action: "skipped:not-down" };
  }
  if (lockHeld) {
    return { action: "skipped:in-flight" };
  }
  const lastRun = runLog.length > 0 ? Math.max(...runLog) : 0;
  if (shouldDebounce(now, lastRun, DEBOUNCE_MS)) {
    return { action: "skipped:debounce" };
  }
  if (shouldCap(runLog, now, CAP_WINDOW_MS, CAP_MAX_RUNS)) {
    return { action: "skipped:cap" };
  }

  acquireLock();
  const prompt = fillPrompt(promptTemplate, promptVars);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout = null;

    let child;
    try {
      child = spawnImpl("claude", ["-p", "--output-format", "text"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      releaseLock();
      resolve({
        action: "spawn-error",
        stdout: "",
        stderr: "",
        error: err.message,
      });
      return;
    }

    // Persist the run timestamp now that the child is live. If writeRun fails,
    // we still proceed — losing one entry from the cap log is preferable to
    // skipping the diagnosis.
    writeRun(runLogPath, now).catch((err) => {
      stderr += `[outage-listener] writeRun failed: ${err?.message ?? err}\n`;
    });

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    // Swallow stdin errors. If the child exits before we finish writing,
    // discord.js / Node can emit an 'error' on stdin that would otherwise
    // crash the process. The 'error'/'close' on the child handles state.
    child.stdin.on("error", () => {});

    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      releaseLock();
      resolve({
        action: "timeout",
        stdout,
        stderr,
        error: `Claude timed out after ${CLAUDE_TIMEOUT_MS}ms`,
      });
    }, CLAUDE_TIMEOUT_MS);
    if (typeof timeout.unref === "function") timeout.unref();

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      releaseLock();
      resolve({
        action: "spawn-error",
        stdout,
        stderr,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      releaseLock();
      resolve({
        action: "spawned",
        exitCode: code,
        stdout,
        stderr,
      });
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch {
      // Already-destroyed stream — child 'error'/'close' will resolve.
    }
  });
}
