import { describe, it, expect, vi, afterEach } from "vitest";
import { isJobUrlLive } from "../src/liveness.js";

function stubFetch({ status = 200, body = "", finalUrl = "https://example.com/job/123" } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      url: finalUrl,
      body: null,
      text: async () => body,
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function check(url) {
  return isJobUrlLive(url, { fetchImpl: globalThis.fetch });
}

describe("isJobUrlLive — HTTP status", () => {
  it("dead on 404", async () => {
    stubFetch({ status: 404 });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("dead on 410", async () => {
    stubFetch({ status: 410 });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("live on plain 200", async () => {
    stubFetch({ body: "<html>Apply now</html>" });
    expect(await check("https://example.com/job/123")).toBe(true);
  });
});

describe("isJobUrlLive — soft 404 redirect", () => {
  it("dead when redirected to careers root", async () => {
    stubFetch({ finalUrl: "https://example.com/careers" });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("live when final URL is a Workday-style job path", async () => {
    stubFetch({ finalUrl: "https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1" });
    expect(await check("https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1")).toBe(true);
  });
});

describe("isJobUrlLive — dead-text patterns", () => {
  it("dead on 'this position is no longer available'", async () => {
    stubFetch({ body: "Sorry, this position is no longer available." });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'this position has been filled'", async () => {
    stubFetch({ body: "This position has been filled." });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'job has been removed'", async () => {
    stubFetch({ body: "The job has been removed." });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'page not found'", async () => {
    stubFetch({ body: "Page not found" });
    expect(await check("https://example.com/job/123")).toBe(false);
  });

  // Regression: Boeing JD boilerplate rendered into Workday meta tags was
  // matched by the old, looser pattern and killed live jobs (63 dropped
  // DMs in the week of 2026-06-12).
  it("live on Boeing 'not contingent upon program award' boilerplate", async () => {
    stubFetch({
      body: "Contingent Upon Award Program This position is not contingent upon program award Shift: Shift 1",
    });
    expect(await check("https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1")).toBe(true);
  });

  it("live on 'this position is not eligible for visa sponsorship'", async () => {
    stubFetch({ body: "This position is not eligible for visa sponsorship." });
    expect(await check("https://example.com/job/123")).toBe(true);
  });

  it("live on 'this position has been designated as safety-sensitive'", async () => {
    stubFetch({ body: "This position has been designated as safety-sensitive." });
    expect(await check("https://example.com/job/123")).toBe(true);
  });
});

describe("isJobUrlLive — fail-open behavior", () => {
  it("live on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET");
    }));
    expect(await check("https://example.com/job/123")).toBe(true);
  });

  it("fails closed on non-http URLs", async () => {
    expect(await check("mailto:x@y.com")).toBe(false);
  });

  it("fails closed when the network guard blocks the destination", async () => {
    const blockedFetch = vi.fn(async () => {
      const error = new Error("blocked");
      error.blocked = true;
      error.code = "BLOCKED_URL";
      throw error;
    });
    expect(await isJobUrlLive("https://example.com/job/123", { fetchImpl: blockedFetch })).toBe(false);
  });

  it("propagates caller cancellation instead of treating it as a live URL", async () => {
    const controller = new AbortController();
    const reason = new Error("cycle cancelled");
    controller.abort(reason);
    const abortedFetch = vi.fn(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    await expect(isJobUrlLive("https://example.com/job/123", {
      fetchImpl: abortedFetch,
      signal: controller.signal,
    })).rejects.toBe(reason);
  });
});
