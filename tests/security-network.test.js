import { describe, expect, it, vi } from "vitest";
import {
  assertPinnedPeer,
  assertSafeUrl,
  createSafeFetch,
} from "../src/ssrf-guard.js";
import { fetchWithTimeout } from "../src/sources/shared.js";

function fakeResponse(status, headers = {}, body = "") {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    url: "",
    redirected: false,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

describe("safeFetch URL and redirect validation", () => {
  it("rejects a mixed public/private DNS answer instead of selecting the public one", async () => {
    const lookup = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(assertSafeUrl("https://example.com/jobs/1", { lookup, requireHttps: true }))
      .rejects.toMatchObject({ blocked: true });
  });

  it("validates every redirect before issuing the next request", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const transport = vi.fn(async () => fakeResponse(302, {
      location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    }));
    const fetchSafely = createSafeFetch({ lookup, transport });

    await expect(fetchSafely("https://example.com/jobs/1", {}, { requireHttps: true }))
      .rejects.toMatchObject({ blocked: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("strips credentials when an allowed redirect crosses origins", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const transport = vi.fn()
      .mockResolvedValueOnce(fakeResponse(302, { location: "https://other.example.net/result" }))
      .mockImplementationOnce(async (_url, options) => {
        const headers = new Headers(options.headers);
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("x-api-key")).toBe(false);
        return fakeResponse(200, { "content-type": "application/json" }, "{}");
      });
    const fetchSafely = createSafeFetch({ lookup, transport });

    await fetchSafely("https://example.com/start", {
      headers: { authorization: "Bearer secret", "x-api-key": "secret" },
    }, { requireHttps: true });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("times out while DNS lookup is still pending", async () => {
    const lookup = vi.fn(() => new Promise(() => {}));
    const transport = vi.fn();
    const fetchSafely = createSafeFetch({ lookup, transport });

    await expect(fetchSafely("https://example.com/jobs/1", {}, {
      requireHttps: true,
      timeoutMs: 20,
    })).rejects.toMatchObject({ name: "AbortError", timedOut: true });
    expect(lookup).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation while DNS lookup is still pending", async () => {
    const lookup = vi.fn(() => new Promise(() => {}));
    const transport = vi.fn();
    const fetchSafely = createSafeFetch({ lookup, transport });
    const controller = new AbortController();
    const reason = new Error("caller stopped collection");
    const pending = fetchSafely("https://example.com/jobs/1", {
      signal: controller.signal,
    }, { requireHttps: true, timeoutMs: 5000 });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses one deadline for the complete redirect chain", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const transport = vi.fn(async (_url, _options, _selected, policy) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return transport.mock.calls.length === 1
        ? fakeResponse(302, { location: "https://example.com/second" })
        : fakeResponse(200, { "content-type": "text/plain" }, "ok");
    });
    const fetchSafely = createSafeFetch({ lookup, transport });

    await expect(fetchSafely("https://example.com/start", {}, {
      requireHttps: true,
      timeoutMs: 25,
    })).rejects.toMatchObject({ name: "AbortError", timedOut: true });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][3].timeoutMs).toBeLessThan(25);
  });

  it("preserves HEAD when following a 303 response", async () => {
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const transport = vi.fn()
      .mockResolvedValueOnce(fakeResponse(303, { location: "/result" }))
      .mockResolvedValueOnce(fakeResponse(200, { "content-type": "text/plain" }));
    const fetchSafely = createSafeFetch({ lookup, transport });

    await fetchSafely("https://example.com/start", { method: "HEAD" }, { requireHttps: true });
    expect(transport.mock.calls[1][1].method).toBe("HEAD");
  });

  it("rejects a connected peer that differs from the pinned DNS answer", () => {
    expect(() => assertPinnedPeer("93.184.216.35", "93.184.216.34"))
      .toThrow(/did not match/i);
    expect(() => assertPinnedPeer("100.64.0.1", "93.184.216.34"))
      .toThrow(/not a public/i);
  });
});

describe("bounded shared fetch", () => {
  it("aborts a response that exceeds the configured byte cap", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("0123456789", {
      headers: { "content-type": "text/plain" },
    }));
    try {
      const response = await fetchWithTimeout("https://example.com", { maxResponseBytes: 5 });
      await expect(response.text()).rejects.toThrow(/exceeds 5 bytes/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not allow callers to re-enable implicit redirects", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("ok"));
    try {
      const response = await fetchWithTimeout("https://example.com", { redirect: "follow" });
      await response.text();
      expect(globalThis.fetch.mock.calls[0][1].redirect).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("releases the parent abort listener immediately for an HTTP error response", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    globalThis.fetch = vi.fn(async () => new Response("upstream error", { status: 503 }));
    try {
      const response = await fetchWithTimeout("https://example.com", {
        signal: controller.signal,
      }, 5000);
      expect(response.ok).toBe(false);
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(await response.text()).toBe("upstream error");
    } finally {
      globalThis.fetch = originalFetch;
      removeListener.mockRestore();
    }
  });
});
