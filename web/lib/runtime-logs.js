import fs from "node:fs";
import path from "node:path";

const SERVICES = {
  web: "jobpulse-web",
  alerts: "jobpulse-mu",
  collectors: "micro-bot",
};

function redactLogText(value) {
  return String(value || "")
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,}\]]+/gi, "$1[REDACTED]")
    .replace(/((?:token|secret|password|api[_-]?key)\s*[:=]\s*)[^\s,}\]]+/gi, "$1[REDACTED]")
    .replace(/\b(?:mfa\.)?[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_DISCORD_TOKEN]");
}

function readTail(filePath, maxBytes = 128 * 1024, maxLines = 250) {
  try {
    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    if (length === 0) return "";
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buffer, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    return redactLogText(lines.slice(-maxLines).join("\n"));
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export function getRuntimeLogs(service) {
  const processName = SERVICES[service];
  if (!processName) throw new Error("INVALID_SERVICE");
  const logDir = path.resolve(process.env.PM2_LOG_DIR || "/home/ubuntu/.pm2/logs");
  return {
    service,
    processName,
    capturedAt: new Date().toISOString(),
    errorLog: readTail(path.join(logDir, `${processName}-error.log`)),
    outputLog: readTail(path.join(logDir, `${processName}-out.log`)),
  };
}
