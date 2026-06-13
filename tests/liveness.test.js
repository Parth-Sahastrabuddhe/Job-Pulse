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

describe("isJobUrlLive — HTTP status", () => {
  it("dead on 404", async () => {
    stubFetch({ status: 404 });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("dead on 410", async () => {
    stubFetch({ status: 410 });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("live on plain 200", async () => {
    stubFetch({ body: "<html>Apply now</html>" });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(true);
  });
});

describe("isJobUrlLive — soft 404 redirect", () => {
  it("dead when redirected to careers root", async () => {
    stubFetch({ finalUrl: "https://example.com/careers" });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("live when final URL is a Workday-style job path", async () => {
    stubFetch({ finalUrl: "https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1" });
    expect(await isJobUrlLive("https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1")).toBe(true);
  });
});

describe("isJobUrlLive — dead-text patterns", () => {
  it("dead on 'this position is no longer available'", async () => {
    stubFetch({ body: "Sorry, this position is no longer available." });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'this position has been filled'", async () => {
    stubFetch({ body: "This position has been filled." });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'job has been removed'", async () => {
    stubFetch({ body: "The job has been removed." });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  it("dead on 'page not found'", async () => {
    stubFetch({ body: "Page not found" });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(false);
  });

  // Regression: Boeing JD boilerplate rendered into Workday meta tags was
  // matched by the old, looser pattern and killed live jobs (63 dropped
  // DMs in the week of 2026-06-12).
  it("live on Boeing 'not contingent upon program award' boilerplate", async () => {
    stubFetch({
      body: "Contingent Upon Award Program This position is not contingent upon program award Shift: Shift 1",
    });
    expect(await isJobUrlLive("https://boeing.wd1.myworkdayjobs.com/external_careers/job/X_JR123-1")).toBe(true);
  });

  it("live on 'this position is not eligible for visa sponsorship'", async () => {
    stubFetch({ body: "This position is not eligible for visa sponsorship." });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(true);
  });

  it("live on 'this position has been designated as safety-sensitive'", async () => {
    stubFetch({ body: "This position has been designated as safety-sensitive." });
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(true);
  });
});

describe("isJobUrlLive — fail-open behavior", () => {
  it("live on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNRESET");
    }));
    expect(await isJobUrlLive("https://example.com/job/123")).toBe(true);
  });

  it("live on non-http URL", async () => {
    expect(await isJobUrlLive("mailto:x@y.com")).toBe(true);
  });
});
