import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { ping, pingFail, writeLivenessBeacon } from "../src/heartbeat.js";

let server;
let baseUrl;
let hits;
let releaseOrderedResponse;
let releaseOrderedFailureResponse;
let releaseParallelResponse;

beforeAll(async () => {
  hits = [];
  server = createServer((req, res) => {
    const hit = { method: req.method, url: req.url, body: "" };
    hits.push(hit);
    req.on("data", (chunk) => { hit.body += chunk.toString(); });
    req.on("end", () => {
      if (req.url === "/ordered" && req.method === "GET") {
        releaseOrderedResponse = () => {
          res.statusCode = 200;
          res.end("ok");
        };
        return;
      }
      if (req.url === "/ordered-failure/fail" && req.method === "POST") {
        releaseOrderedFailureResponse = () => {
          res.statusCode = 200;
          res.end("ok");
        };
        return;
      }
      if (req.url === "/parallel-blocked" && req.method === "GET") {
        releaseParallelResponse = () => {
          res.statusCode = 200;
          res.end("ok");
        };
        return;
      }
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
    expect(hits[hits.length - 1]).toEqual({ method: "GET", url: "/ok", body: "" });
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
    expect(hits[hits.length - 1].body).toBe("db locked");
  });

  it("does not throw when reason is missing", async () => {
    await expect(pingFail(`${baseUrl}/hc`)).resolves.toBeUndefined();
  });

  it("serializes updates to the same check URL", async () => {
    releaseOrderedResponse = null;
    const before = hits.length;
    const success = ping(`${baseUrl}/ordered`);
    for (let attempt = 0; attempt < 100 && !releaseOrderedResponse; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(releaseOrderedResponse).toBeTypeOf("function");

    const failure = pingFail(`${baseUrl}/ordered`, "newer failure");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(hits.slice(before).map((hit) => hit.url)).toEqual(["/ordered"]);

    releaseOrderedResponse();
    await Promise.all([success, failure]);
    expect(hits.slice(before).map((hit) => hit.url)).toEqual([
      "/ordered",
      "/ordered/fail",
    ]);
  });

  it("does not let a newer success overtake an older failure", async () => {
    releaseOrderedFailureResponse = null;
    const before = hits.length;
    const failure = pingFail(`${baseUrl}/ordered-failure`, "older failure");
    for (let attempt = 0; attempt < 100 && !releaseOrderedFailureResponse; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(releaseOrderedFailureResponse).toBeTypeOf("function");

    const success = ping(`${baseUrl}/ordered-failure`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(hits.slice(before).map((hit) => hit.url)).toEqual(["/ordered-failure/fail"]);

    releaseOrderedFailureResponse();
    await Promise.all([failure, success]);
    expect(hits.slice(before).map((hit) => hit.url)).toEqual([
      "/ordered-failure/fail",
      "/ordered-failure",
    ]);
  });

  it("does not serialize independent health checks", async () => {
    releaseParallelResponse = null;
    const before = hits.length;
    const blocked = ping(`${baseUrl}/parallel-blocked`);
    for (let attempt = 0; attempt < 100 && !releaseParallelResponse; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(releaseParallelResponse).toBeTypeOf("function");

    await ping(`${baseUrl}/parallel-free`);
    expect(hits.slice(before).map((hit) => hit.url)).toEqual([
      "/parallel-blocked",
      "/parallel-free",
    ]);

    releaseParallelResponse();
    await blocked;
  });
});

describe("writeLivenessBeacon", () => {
  it("hardens an existing permissive heartbeat file to owner-only", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "jobpulse-heartbeat-"));
    const file = path.join(directory, "mu-heartbeat");
    try {
      writeFileSync(file, "old", { mode: 0o664 });
      chmodSync(file, 0o664);

      writeLivenessBeacon(file, "2026-08-02T00:00:00.000Z");

      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readFileSync(file, "utf8")).toBe("2026-08-02T00:00:00.000Z");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
