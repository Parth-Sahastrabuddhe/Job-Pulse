import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendNotifications } from "../src/index.js";
import { closeDb, getDb, initDb, upsertJobs } from "../src/state.js";

let tempDir;
let priorTelegramEnabled;

function candidate(key = "source:job-1") {
  return {
    key,
    sourceKey: "source",
    sourceLabel: "Source",
    id: "job-1",
    title: "Software Engineer",
    location: "Remote",
    url: "https://example.com/jobs/job-1",
  };
}

function config() {
  return {
    notifications: {
      discordBotToken: "bot-token",
      discordChannelId: "discord-channel",
      discordWebhookUrl: "https://example.com/webhook",
      telegramBotToken: "telegram-token",
      telegramChatId: "telegram-chat",
    },
  };
}

function result(field, jobs) {
  return {
    deliveredJobs: field === "deliveredJobs" ? jobs : [],
    failedJobs: field === "failedJobs" ? jobs : [],
    uncertainJobs: field === "uncertainJobs" ? jobs : [],
    errors: [],
  };
}

beforeEach(() => {
  priorTelegramEnabled = process.env.TELEGRAM_ENABLED;
  process.env.TELEGRAM_ENABLED = "1";
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpulse-personal-orchestration-"));
  initDb(path.join(tempDir, "jobs.db"));
});

afterEach(() => {
  closeDb();
  if (priorTelegramEnabled === undefined) delete process.env.TELEGRAM_ENABLED;
  else process.env.TELEGRAM_ENABLED = priorTelegramEnabled;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("personal delivery orchestration", () => {
  it("preserves an uncertain bot claim and never invokes fallbacks", async () => {
    const job = candidate();
    upsertJobs([job], "2026-01-01T00:00:00.000Z");
    let webhookCalls = 0;
    let telegramCalls = 0;

    const summary = await sendNotifications(config(), [job], [{ job, warnings: [] }], {
      deliveryAdapters: {
        isDiscordBotConnected: () => true,
        sendDiscordBotNotification: async (jobs) => result("uncertainJobs", jobs),
        sendDiscordNotification: async () => {
          webhookCalls++;
          throw new Error("webhook must not run");
        },
        sendTelegramNotification: async () => {
          telegramCalls++;
          throw new Error("Telegram must not run");
        },
      },
    });

    expect(summary.uncertain).toEqual([job]);
    expect(webhookCalls).toBe(0);
    expect(telegramCalls).toBe(0);
    expect(getDb().prepare("SELECT status, delivery_claim_token FROM job_posts").get())
      .toMatchObject({ status: "delivery_claimed", delivery_claim_token: expect.any(String) });
  });

  it("finalizes a known bot failure through the webhook and skips Telegram", async () => {
    const job = candidate();
    upsertJobs([job], "2026-01-01T00:00:00.000Z");
    let telegramCalls = 0;

    const summary = await sendNotifications(config(), [job], [{ job, warnings: [] }], {
      deliveryAdapters: {
        isDiscordBotConnected: () => true,
        sendDiscordBotNotification: async (jobs) => result("failedJobs", jobs),
        sendDiscordNotification: async (_url, jobs, options) => {
          await options.onChunkDelivered(jobs);
          return result("deliveredJobs", jobs);
        },
        sendTelegramNotification: async () => {
          telegramCalls++;
          return result("deliveredJobs", [job]);
        },
      },
    });

    expect(summary.delivered).toEqual([job]);
    expect(summary.uncertain).toEqual([]);
    expect(telegramCalls).toBe(0);
    expect(getDb().prepare(`
      SELECT status, message_id, channel_id, delivery_claim_token
        FROM job_posts WHERE job_key = ?
    `).get(job.key)).toEqual({
      status: "pending",
      message_id: "",
      channel_id: "discord-channel",
      delivery_claim_token: null,
    });
  });

  it("releases only its own claim after every channel reports a known failure", async () => {
    const job = candidate();
    upsertJobs([job], "2026-01-01T00:00:00.000Z");

    const summary = await sendNotifications(config(), [job], [{ job, warnings: [] }], {
      deliveryAdapters: {
        isDiscordBotConnected: () => true,
        sendDiscordBotNotification: async (jobs) => result("failedJobs", jobs),
        sendDiscordNotification: async (_url, jobs) => result("failedJobs", jobs),
        sendTelegramNotification: async (_token, _chat, jobs) => result("failedJobs", jobs),
      },
    });

    expect(summary.failed).toEqual([job]);
    expect(getDb().prepare("SELECT 1 FROM job_posts WHERE job_key = ?").get(job.key)).toBeUndefined();
  });

  it("does not invoke Telegram after an ambiguous webhook outcome", async () => {
    const job = candidate();
    upsertJobs([job], "2026-01-01T00:00:00.000Z");
    let telegramCalls = 0;

    const summary = await sendNotifications(config(), [job], [{ job, warnings: [] }], {
      deliveryAdapters: {
        isDiscordBotConnected: () => false,
        sendDiscordNotification: async (_url, jobs) => result("uncertainJobs", jobs),
        sendTelegramNotification: async () => {
          telegramCalls++;
          throw new Error("Telegram must not run");
        },
      },
    });

    expect(summary.uncertain).toEqual([job]);
    expect(telegramCalls).toBe(0);
    expect(getDb().prepare("SELECT status FROM job_posts WHERE job_key = ?").get(job.key))
      .toEqual({ status: "delivery_claimed" });
  });
});
