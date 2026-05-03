import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDownAlert,
  extractCheckName,
  shouldDebounce,
  shouldCap,
  readRunLog,
  appendRunLog,
} from "../scripts/outage-listener.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("isDownAlert", () => {
  it("returns true for canonical HC down message", () => {
    expect(isDownAlert("The check **jobpulse-micro** is DOWN.")).toBe(true);
  });

  it("returns true for 'is down' with any casing", () => {
    expect(isDownAlert("Check 'foo' is Down")).toBe(true);
    expect(isDownAlert("check IS DOWN now")).toBe(true);
  });

  it("returns false for up/recovery messages", () => {
    expect(isDownAlert("The check **jobpulse-micro** is UP.")).toBe(false);
    expect(isDownAlert("recovered")).toBe(false);
  });

  it("returns false for empty or null input", () => {
    expect(isDownAlert("")).toBe(false);
    expect(isDownAlert(null)).toBe(false);
    expect(isDownAlert(undefined)).toBe(false);
  });
});

describe("extractCheckName", () => {
  it("extracts name from a bolded HC message", () => {
    expect(extractCheckName("The check **jobpulse-micro** is DOWN.")).toBe(
      "jobpulse-micro"
    );
  });

  it("extracts name from quoted format", () => {
    expect(extractCheckName('Check "jobpulse-mu" is down')).toBe("jobpulse-mu");
  });

  it("returns 'unknown' when no name can be extracted", () => {
    expect(extractCheckName("Something is down somewhere")).toBe("unknown");
  });
});

describe("shouldDebounce", () => {
  it("returns true when within debounce window", () => {
    const now = 1_000_000;
    const lastRun = now - 5 * 60_000;
    expect(shouldDebounce(now, lastRun, 20 * 60_000)).toBe(true);
  });

  it("returns false when outside debounce window", () => {
    const now = 1_000_000;
    const lastRun = now - 25 * 60_000;
    expect(shouldDebounce(now, lastRun, 20 * 60_000)).toBe(false);
  });

  it("returns false when no previous run (lastRunMs = 0)", () => {
    expect(shouldDebounce(1_000_000, 0, 20 * 60_000)).toBe(false);
  });

  it("returns true at exactly the boundary (still inside window)", () => {
    const now = 1_000_000;
    const lastRun = now - 20 * 60_000;
    expect(shouldDebounce(now, lastRun, 20 * 60_000)).toBe(true);
  });
});

describe("shouldCap", () => {
  it("returns false when no runs", () => {
    expect(shouldCap([], Date.now(), 24 * 60 * 60_000, 3)).toBe(false);
  });

  it("returns false when under cap within window", () => {
    const now = Date.now();
    const runs = [now - 3 * 60 * 60_000, now - 6 * 60 * 60_000];
    expect(shouldCap(runs, now, 24 * 60 * 60_000, 3)).toBe(false);
  });

  it("returns true when at cap within window", () => {
    const now = Date.now();
    const runs = [
      now - 1 * 60 * 60_000,
      now - 5 * 60 * 60_000,
      now - 10 * 60 * 60_000,
    ];
    expect(shouldCap(runs, now, 24 * 60 * 60_000, 3)).toBe(true);
  });

  it("ignores runs outside the window", () => {
    const now = Date.now();
    const runs = [
      now - 1 * 60 * 60_000,
      now - 25 * 60 * 60_000,
      now - 26 * 60 * 60_000,
    ];
    expect(shouldCap(runs, now, 24 * 60 * 60_000, 3)).toBe(false);
  });
});

describe("readRunLog / appendRunLog", () => {
  let tmpFile;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `outage-runs-test-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(async () => {
    try { await fs.unlink(tmpFile); } catch {}
  });

  it("returns empty array when file does not exist", async () => {
    expect(await readRunLog(tmpFile)).toEqual([]);
  });

  it("appendRunLog persists timestamps and readRunLog returns them", async () => {
    await appendRunLog(tmpFile, 100);
    await appendRunLog(tmpFile, 200);
    expect(await readRunLog(tmpFile)).toEqual([100, 200]);
  });

  it("readRunLog returns empty array on malformed JSON", async () => {
    await fs.writeFile(tmpFile, "not json", "utf8");
    expect(await readRunLog(tmpFile)).toEqual([]);
  });

  it("readRunLog returns empty array if file is not an array", async () => {
    await fs.writeFile(tmpFile, '{"not":"array"}', "utf8");
    expect(await readRunLog(tmpFile)).toEqual([]);
  });

  it("appendRunLog creates parent directory if missing", async () => {
    const nested = path.join(os.tmpdir(), `nested-${Date.now()}`, "runs.json");
    await appendRunLog(nested, 42);
    expect(await readRunLog(nested)).toEqual([42]);
    await fs.rm(path.dirname(nested), { recursive: true, force: true });
  });
});

import { vi } from "vitest";
import { processAlert } from "../scripts/outage-listener.js";

describe("processAlert (orchestration)", () => {
  it("ignores 'is up' messages without spawning", async () => {
    const spawn = vi.fn();
    const result = await processAlert({
      content: "**jobpulse-micro** is UP.",
      now: 1_000_000,
      runLog: [],
      lockHeld: false,
      spawnImpl: spawn,
      promptTemplate: "",
      promptVars: {},
      runLogPath: "/tmp/x",
      writeRun: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(result.action).toBe("skipped:not-down");
  });

  it("skips when lock is held (concurrency)", async () => {
    const spawn = vi.fn();
    const result = await processAlert({
      content: "**jobpulse-micro** is DOWN.",
      now: 1_000_000,
      runLog: [],
      lockHeld: true,
      spawnImpl: spawn,
      promptTemplate: "",
      promptVars: {},
      runLogPath: "/tmp/x",
      writeRun: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(result.action).toBe("skipped:in-flight");
  });

  it("skips when within debounce window", async () => {
    const spawn = vi.fn();
    const now = 10_000_000;
    const result = await processAlert({
      content: "**jobpulse-micro** is DOWN.",
      now,
      runLog: [now - 5 * 60_000],
      lockHeld: false,
      spawnImpl: spawn,
      promptTemplate: "",
      promptVars: {},
      runLogPath: "/tmp/x",
      writeRun: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(result.action).toBe("skipped:debounce");
  });

  it("skips when daily cap exceeded", async () => {
    const spawn = vi.fn();
    const now = 10_000_000;
    const runLog = [
      now - 1 * 60 * 60_000,
      now - 5 * 60 * 60_000,
      now - 21 * 60 * 60_000,
    ];
    const result = await processAlert({
      content: "**jobpulse-micro** is DOWN.",
      now,
      runLog,
      lockHeld: false,
      spawnImpl: spawn,
      promptTemplate: "",
      promptVars: {},
      runLogPath: "/tmp/x",
      writeRun: vi.fn(),
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(result.action).toBe("skipped:cap");
  });

  it("spawns claude -p with substituted prompt and writes run log", async () => {
    let capturedStdin = "";
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: (s) => { capturedStdin = s; }, end: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") setTimeout(() => cb(0), 0);
      }),
      kill: vi.fn(),
    };
    const spawn = vi.fn(() => fakeChild);
    const writeRun = vi.fn();
    const acquireLock = vi.fn();
    const releaseLock = vi.fn();
    const now = 12_345_000;

    const promptTemplate = "Check: {{CHECK_NAME}} at {{TRIGGER_AT_UTC}}";
    const promptVars = {
      CHECK_NAME: "jobpulse-micro",
      TRIGGER_AT_UTC: "2026-05-03T12:00:00Z",
    };

    const result = await processAlert({
      content: "**jobpulse-micro** is DOWN.",
      now,
      runLog: [],
      lockHeld: false,
      spawnImpl: spawn,
      promptTemplate,
      promptVars,
      runLogPath: "/tmp/runs.json",
      writeRun,
      acquireLock,
      releaseLock,
    });

    expect(acquireLock).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      ["-p", "--output-format", "text"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
    );
    expect(capturedStdin).toBe(
      "Check: jobpulse-micro at 2026-05-03T12:00:00Z"
    );
    expect(writeRun).toHaveBeenCalledWith("/tmp/runs.json", now);
    expect(releaseLock).toHaveBeenCalled();
    expect(result.action).toBe("spawned");
  });
});
