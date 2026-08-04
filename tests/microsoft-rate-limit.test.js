import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectMicrosoftJobs,
  parseRetryAfterMs,
} from "../src/sources/microsoft.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Microsoft rate-limit metadata", () => {
  it("parses both Retry-After formats", () => {
    expect(parseRetryAfterMs("2.5", 0)).toBe(2500);
    expect(parseRetryAfterMs("Thu, 01 Jan 1970 00:01:00 GMT", 10_000)).toBe(50_000);
    expect(parseRetryAfterMs("not-a-delay", 0)).toBeNull();
  });

  it("preserves HTTP 429 and Retry-After for scheduler backoff", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", {
      status: 429,
      headers: { "Retry-After": "7" },
    })));

    await expect(collectMicrosoftJobs(null, {
      microsoft: { sourceKey: "microsoft", sourceLabel: "Microsoft" },
      maxJobsPerSource: 60,
    }, () => {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    });
  });
});
