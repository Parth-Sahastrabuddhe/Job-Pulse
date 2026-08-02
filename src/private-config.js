/** Private application configuration layered over the public core config. */

import path from "node:path";
import {
  getConfig as getCoreConfig,
  parseBoundedInteger,
  PROJECT_ROOT,
} from "./config.js";
import { resolveDbFile } from "./db-path.js";

export { PROJECT_ROOT };

function resolveProjectPath(value, fallbackRelativePath) {
  const candidate = value?.trim() || fallbackRelativePath;
  return path.isAbsolute(candidate) ? candidate : path.resolve(PROJECT_ROOT, candidate);
}

export function getConfig() {
  return {
    ...getCoreConfig(),
    retentionDays: parseBoundedInteger(process.env.STATE_RETENTION_DAYS, 45, {
      name: "STATE_RETENTION_DAYS", min: 1, max: 3650,
    }),
    dbBusyBackoffMs: parseBoundedInteger(process.env.DB_BUSY_BACKOFF_MS, 10000, {
      name: "DB_BUSY_BACKOFF_MS", min: 0, max: 300000,
    }),
    maxNewJobsPerNotify: parseBoundedInteger(process.env.MAX_NEW_JOBS_PER_NOTIFY, 10, {
      name: "MAX_NEW_JOBS_PER_NOTIFY", min: 1, max: 100,
    }),
    stateFile: resolveProjectPath(process.env.STATE_FILE, "data/state.json"),
    dbFile: resolveDbFile(),
    notifications: {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || "",
      discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim() || "",
      discordChannelId: process.env.DISCORD_CHANNEL_ID?.trim() || "",
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
      telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
    },
    heartbeat: {
      micro: process.env.HEARTBEAT_URL_MICRO?.trim() || "",
      mu: process.env.HEARTBEAT_URL_MU?.trim() || "",
    },
    applicant: {
      name: process.env.APPLICANT_NAME?.trim() || "",
      email: process.env.APPLICANT_EMAIL?.trim() || "",
      phone: process.env.APPLICANT_PHONE?.trim() || "",
      linkedin: process.env.APPLICANT_LINKEDIN?.trim() || "",
      resumePath: resolveProjectPath(process.env.APPLICANT_RESUME_PATH, "resume/base.pdf"),
    },
  };
}
