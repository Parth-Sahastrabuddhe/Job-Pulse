import { describe, expect, it } from "vitest";
import { sendDiscordNotification } from "../src/notifiers/discord.js";
import { sendTelegramNotification } from "../src/notifiers/telegram.js";

function job(key = "job-1") {
  return {
    key,
    sourceLabel: "Example",
    title: "Software Engineer",
    location: "Remote",
    url: `https://example.com/jobs/${key}`,
  };
}

function response(status, body = "", retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "retry-after" ? retryAfter : null;
      },
    },
    text: async () => body,
  };
}

const notifiers = [
  {
    name: "Discord webhook",
    send: (jobs, options) => sendDiscordNotification("https://example.com/webhook", jobs, options),
  },
  {
    name: "Telegram",
    send: (jobs, options) => sendTelegramNotification("token", "chat", jobs, options),
  },
];

describe.each(notifiers)("$name transport outcomes", ({ send }) => {
  it("retries an explicit HTTP 429 and records a later success", async () => {
    const candidate = job();
    let calls = 0;
    const delays = [];

    const result = await send([candidate], {
      maxRetries: 3,
      fetchFn: async () => (++calls === 1 ? response(429, "rate limited", "0") : response(204)),
      delayFn: async (delayMs) => delays.push(delayMs),
    });

    expect(calls).toBe(2);
    expect(delays).toEqual([0]);
    expect(result.deliveredJobs).toEqual([candidate]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs).toEqual([]);
  });

  it("reports an exhausted HTTP 429 as a known failure", async () => {
    const candidate = job();
    let calls = 0;

    const result = await send([candidate], {
      maxRetries: 1,
      fetchFn: async () => {
        calls++;
        return response(429, "rate limited", "0");
      },
      delayFn: async () => {},
    });

    expect(calls).toBe(2);
    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([candidate]);
    expect(result.uncertainJobs).toEqual([]);
  });

  it("does not retry a network exception and reports it as uncertain", async () => {
    const candidate = job();
    let calls = 0;
    let delays = 0;

    const result = await send([candidate], {
      maxRetries: 3,
      fetchFn: async () => {
        calls++;
        throw new Error("socket reset after request body");
      },
      delayFn: async () => {
        delays++;
      },
    });

    expect(calls).toBe(1);
    expect(delays).toBe(0);
    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs).toEqual([candidate]);
    expect(result.errors[0].message).toContain("socket reset after request body");
  });

  it("does not retry HTTP 5xx and reports it as uncertain", async () => {
    const candidate = job();
    let calls = 0;

    const result = await send([candidate], {
      maxRetries: 3,
      fetchFn: async () => {
        calls++;
        return response(503, "temporarily unavailable");
      },
      delayFn: async () => {
        throw new Error("5xx must not schedule a retry");
      },
    });

    expect(calls).toBe(1);
    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs).toEqual([candidate]);
  });

  it("reports a non-429 HTTP 4xx as a known failure", async () => {
    const candidate = job();
    let calls = 0;

    const result = await send([candidate], {
      maxRetries: 3,
      fetchFn: async () => {
        calls++;
        return response(400, "bad request");
      },
      delayFn: async () => {
        throw new Error("4xx must not schedule a retry");
      },
    });

    expect(calls).toBe(1);
    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([candidate]);
    expect(result.uncertainJobs).toEqual([]);
  });

  it("reports a successful remote send with a failed ledger callback as uncertain", async () => {
    const candidate = job();
    const result = await send([candidate], {
      fetchFn: async () => response(204),
      onChunkDelivered: async () => {
        throw new Error("database locked");
      },
    });

    expect(result.deliveredJobs).toEqual([]);
    expect(result.failedJobs).toEqual([]);
    expect(result.uncertainJobs).toEqual([candidate]);
    expect(result.errors[0].message).toBe("database locked");
  });
});
