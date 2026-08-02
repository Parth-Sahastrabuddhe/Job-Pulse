import { afterEach, describe, expect, it, vi } from "vitest";
import { isEntrypoint, runBatchLoop } from "../src/index.js";

function config(overrides = {}) {
  return {
    batchSize: 1,
    batchDelayMs: 0,
    dbBusyBackoffMs: 0,
    fastTrackIntervalSeconds: 60,
    slowCycleMinutes: 60,
    retentionDays: 30,
    countryFilter: "all",
    heartbeat: { micro: "https://health.invalid/test" },
    ...overrides,
  };
}

function flags() {
  return {
    dryRun: true,
    notifyExisting: false,
    seedOnly: false,
    watch: true,
  };
}

function services(overrides = {}) {
  return {
    delay: vi.fn(async () => {}),
    expireSavedJobPosts: vi.fn(() => 0),
    hasSeenJobs: vi.fn(() => true),
    ping: vi.fn(async () => {}),
    pingFail: vi.fn(async () => {}),
    processBatchResults: vi.fn(async () => {}),
    pruneState: vi.fn(() => {}),
    upsertJobs: vi.fn(() => {}),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("batch-loop collector health", () => {
  it("resets a failed final batch, latches a full outage, and clears only after a completed recovery", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const calls = { alpha: 0, beta: 0 };
    const registry = ["alpha", "beta"].map((key) => ({
      key,
      lane: "normal",
      async collect() {
        calls[key]++;
        if (calls[key] === 2 || (calls[key] === 3 && key === "alpha")) {
          throw new Error(`${key} upstream unavailable`);
        }
        return [];
      },
    }));

    const heartbeats = [];
    let processingCalls = 0;
    const runtime = services({
      ping: vi.fn(async () => { heartbeats.push({ kind: "ok" }); }),
      pingFail: vi.fn(async (_url, reason) => { heartbeats.push({ kind: "fail", reason }); }),
      async processBatchResults(_config, _flags, _jobs, label) {
        processingCalls++;
        if (processingCalls === 2) {
          throw new Error("processor failed");
        }
        if (processingCalls === 5) {
          throw new Error("operational failure while recovery was incomplete");
        }
      },
    });

    await runBatchLoop(config(), flags(), registry, {
      maxCycles: 6,
      services: runtime,
    });

    // One state update per cycle: success, operational failure, partial-window
    // success, full-rotation outage, latched outage, completed recovery.
    expect(heartbeats).toHaveLength(6);
    expect(heartbeats.map(({ kind }) => kind)).toEqual([
      "ok", "fail", "ok", "fail", "fail", "ok",
    ]);
    expect(heartbeats[1].reason).toBe("batch 2/2: processor failed");
    expect(heartbeats[3].reason).toContain("all 2 collectors in normal rotation failed");
    expect(heartbeats[4].reason).toBe(
      "batch 1/2: operational failure while recovery was incomplete",
    );
    expect(calls).toEqual({ alpha: 3, beta: 3 });
  });

  it.each(["fast", "slow"])("latches a complete %s-lane failure until that lane recovers", async (lane) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const registry = [
      {
        key: "healthy-normal",
        lane: "normal",
        collect: async () => [],
      },
      ...["one", "two"].map((suffix) => {
        let attempts = 0;
        return {
          key: `${lane}-${suffix}`,
          lane,
          async collect() {
            attempts++;
            if (attempts === 1) throw new Error("upstream unavailable");
            return [];
          },
        };
      }),
    ];
    const heartbeats = [];
    const runtime = services({
      ping: vi.fn(async () => { heartbeats.push("ok"); }),
      pingFail: vi.fn(async () => { heartbeats.push("fail"); }),
    });

    await runBatchLoop(config({
      batchSize: 20,
      fastTrackIntervalSeconds: 0,
      slowCycleMinutes: 0,
    }), flags(), registry, {
      maxCycles: 2,
      services: runtime,
    });

    expect(runtime.ping).toHaveBeenCalledOnce();
    expect(runtime.pingFail).toHaveBeenCalledOnce();
    expect(runtime.pingFail.mock.calls[0][1]).toContain(`all 2 collectors in ${lane} lane failed`);
    expect(heartbeats).toEqual(["fail", "ok"]);
  });

  it.each(["fast", "slow"])("keeps health green when only part of the %s lane fails", async (lane) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const registry = [
      { key: "healthy-normal", lane: "normal", collect: async () => [] },
      { key: `${lane}-failed`, lane, collect: async () => { throw new Error("upstream unavailable"); } },
      { key: `${lane}-healthy`, lane, collect: async () => [] },
    ];
    const runtime = services();

    await runBatchLoop(config({ batchSize: 20 }), flags(), registry, {
      maxCycles: 1,
      services: runtime,
    });

    expect(runtime.ping).toHaveBeenCalledOnce();
    expect(runtime.pingFail).not.toHaveBeenCalled();
  });
});

describe("micro-bot entrypoint detection", () => {
  const moduleUrl = "file:///srv/job-pulse/src/index.js";

  it("starts when Node executes the module directly", () => {
    expect(isEntrypoint(moduleUrl, {
      argvPath: "/srv/job-pulse/src/index.js",
      pmExecPath: "",
    })).toBe(true);
  });

  it("starts when PM2 imports the configured script through its wrapper", () => {
    expect(isEntrypoint(moduleUrl, {
      argvPath: "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
      pmExecPath: "/srv/job-pulse/src/index.js",
    })).toBe(true);
  });

  it("does not start for an ordinary library or test import", () => {
    expect(isEntrypoint(moduleUrl, {
      argvPath: "/srv/job-pulse/tests/collector-health-loop.test.js",
      pmExecPath: "",
    })).toBe(false);
  });

  it("does not start for a different application managed by PM2", () => {
    expect(isEntrypoint(moduleUrl, {
      argvPath: "/usr/lib/node_modules/pm2/lib/ProcessContainerFork.js",
      pmExecPath: "/srv/job-pulse/src/multi-user.js",
    })).toBe(false);
  });
});
