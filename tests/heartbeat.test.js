import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import { ping, pingFail } from "../src/heartbeat.js";

let server;
let baseUrl;
let hits;

beforeAll(async () => {
  hits = [];
  server = createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    // Simulate slow endpoint for timeout test
    if (req.url === "/slow") {
      setTimeout(() => {
        res.statusCode = 200;
        res.end("ok");
      }, 10_000);
      return;
    }
    if (req.url === "/boom") {
      res.statusCode = 500;
      res.end("err");
      return;
    }
    res.statusCode = 200;
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("heartbeat.ping", () => {
  it("no-ops when url is empty", async () => {
    const before = hits.length;
    await ping("");
    await ping(null);
    await ping(undefined);
    expect(hits.length).toBe(before);
  });

  it("sends GET to the configured url", async () => {
    const before = hits.length;
    await ping(`${baseUrl}/ok`);
    expect(hits.length).toBe(before + 1);
    expect(hits[hits.length - 1]).toEqual({ method: "GET", url: "/ok" });
  });

  it("does not throw on non-2xx response", async () => {
    await expect(ping(`${baseUrl}/boom`)).resolves.toBeUndefined();
  });

  it("does not throw on unreachable host", async () => {
    await expect(ping("http://127.0.0.1:1/nope")).resolves.toBeUndefined();
  });

  it("aborts after 5s timeout without throwing", async () => {
    const start = Date.now();
    await ping(`${baseUrl}/slow`);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(7_000);
    expect(elapsed).toBeGreaterThanOrEqual(4_900);
  }, 10_000);
});

describe("heartbeat.pingFail", () => {
  it("no-ops when url is empty", async () => {
    const before = hits.length;
    await pingFail("", "reason");
    expect(hits.length).toBe(before);
  });

  it("appends /fail to the url and sends reason in body", async () => {
    const before = hits.length;
    await pingFail(`${baseUrl}/hc`, "db locked");
    expect(hits.length).toBe(before + 1);
    expect(hits[hits.length - 1].url).toBe("/hc/fail");
    expect(hits[hits.length - 1].method).toBe("POST");
  });

  it("does not throw when reason is missing", async () => {
    await expect(pingFail(`${baseUrl}/hc`)).resolves.toBeUndefined();
  });
});
