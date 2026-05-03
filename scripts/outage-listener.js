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

// ─── Discord client + start() entrypoint ─────────────────────────────────────

import { Client, GatewayIntentBits, Events } from "discord.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    console.error(`[outage-listener] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

function loadDotEnv() {
  // Minimal .env loader (matches src/config.js pattern; no dotenv dep)
  const require_ = createRequire(import.meta.url);
  const fsSync = require_("node:fs");
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fsSync.existsSync(envPath)) return;
  const content = fsSync.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function extractDiscordSummary(stdout, result) {
  const m = stdout.match(/--- BEGIN DISCORD_SUMMARY ---([\s\S]*?)--- END DISCORD_SUMMARY ---/);
  if (m) return m[1].trim().slice(0, 1900);
  if (result.action === "timeout") return `Diagnostic run timed out (15 min). stderr tail:\n\`\`\`\n${(result.stderr || "").slice(-500)}\n\`\`\``;
  if (result.action === "spawn-error") return `claude spawn failed: ${result.error}`;
  if (result.exitCode !== 0) return `claude -p exited ${result.exitCode}, no DISCORD_SUMMARY block found.\nstderr tail:\n\`\`\`\n${(result.stderr || "").slice(-500)}\n\`\`\``;
  return "Diagnostic run completed but produced no DISCORD_SUMMARY block.";
}

export async function start() {
  loadDotEnv();

  const token = requireEnv("WATCHDOG_BOT_TOKEN");
  const channelId = requireEnv("WATCHDOG_CHANNEL_ID");
  const ec2SshKeyPath = requireEnv("EC2_SSH_KEY_PATH");
  const ec2Host = requireEnv("EC2_HOST");
  const githubRepo = requireEnv("GITHUB_REPO");

  const promptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "outage-prompt.md"
  );
  const promptTemplate = await fs.readFile(promptPath, "utf8");
  const runLogPath = path.resolve(process.cwd(), "data", "outage-runs.json");

  let lockHeld = false;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[outage-listener] Ready as ${c.user.tag}, watching channel ${channelId}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    if (message.channelId !== channelId) return;
    // Accept HC alert messages (which come from a webhook bot) but ignore
    // the listener's own bot-posted summaries to avoid loops.
    if (message.author.id === client.user?.id) return;

    const content = message.content || "";
    const now = Date.now();
    const runLog = await readRunLog(runLogPath);
    const checkName = extractCheckName(content);

    const result = await processAlert({
      content,
      now,
      runLog,
      lockHeld,
      spawnImpl: spawn,
      promptTemplate,
      promptVars: {
        CHECK_NAME: checkName,
        TRIGGER_AT_UTC: new Date(now).toISOString(),
        EC2_HOST: ec2Host,
        EC2_SSH_KEY_PATH: ec2SshKeyPath,
        GITHUB_REPO: githubRepo,
        UNIX_TS: String(Math.floor(now / 1000)),
      },
      runLogPath,
      writeRun: appendRunLog,
      acquireLock: () => { lockHeld = true; },
      releaseLock: () => { lockHeld = false; },
    });

    console.log(`[outage-listener] alert "${checkName}" → ${result.action}`);

    if (result.action === "spawned" || result.action === "timeout" || result.action === "spawn-error") {
      const summary = extractDiscordSummary(result.stdout, result);
      try {
        const channel = await client.channels.fetch(channelId);
        await channel.send(summary);
      } catch (err) {
        console.error(`[outage-listener] failed to post summary: ${err.message}`);
      }
    }
  });

  await client.login(token);
}

// Auto-start when run directly
const isDirectRun = process.argv[1] && process.argv[1].endsWith("outage-listener.js");
if (isDirectRun) {
  start().catch((err) => {
    console.error(`[outage-listener] fatal: ${err.message}`);
    process.exit(1);
  });
}
