import { describe, expect, it, vi } from "vitest";
import {
  allCollectorsFailed,
  buildCollectorRegistry,
  collectBatch,
  inspectJobs,
  runPipelineOnce,
} from "../src/pipeline.js";
import { parseCoreFlags } from "../src/core-cli.js";

function job(overrides = {}) {
  return {
    key: "job-key",
    id: "42",
    sourceKey: "example",
    sourceLabel: "Example",
    title: "Software Engineer",
    location: "New York, NY",
    countryCode: "US",
    url: "https://jobs.example.com/42",
    postedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("public pipeline boundary", () => {
  it("treats only an attempted, all-error collection as completely failed", () => {
    expect(allCollectorsFailed({ totalCount: 2, errorCount: 2 })).toBe(true);
    expect(allCollectorsFailed({ totalCount: 2, errorCount: 1 })).toBe(false);
    expect(allCollectorsFailed({ totalCount: 0, errorCount: 0 })).toBe(false);
  });

  it("strictly validates public CLI arguments", () => {
    expect(parseCoreFlags(["--source", "meta", "--lane", "normal", "--limit", "5"]))
      .toMatchObject({ sourceKeys: ["meta"], lanes: ["normal"], limit: 5 });
    expect(() => parseCoreFlags(["--lane", "sometimes"])).toThrow(/fast, normal, or slow/);
    expect(() => parseCoreFlags(["--limit", "5x"])).toThrow(/non-negative integer/);
  });

  it("builds one canonical, uniquely keyed collector registry", () => {
    const registry = buildCollectorRegistry({ fastTrackCompanies: [] });
    expect(registry.length).toBeGreaterThan(100);
    expect(new Set(registry.map((entry) => entry.key)).size).toBe(registry.length);
    expect(registry.every((entry) => typeof entry.collect === "function")).toBe(true);
  });

  it("reports collector failures separately from legitimate empty results", async () => {
    const expected = job();
    const logger = vi.fn();
    const result = await collectBatch({}, [
      { key: "ok", collect: async () => [expected] },
      { key: "empty", collect: async () => [] },
      { key: "broken", collect: async () => { throw new Error("upstream failed"); } },
    ], { logger });

    expect(result.jobs).toEqual([expected]);
    expect(result.totalCount).toBe(3);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].key).toBe("broken");
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("upstream failed"));
  });

  it("classifies invalid collector output as a source failure", async () => {
    const result = await collectBatch({}, [
      { key: "invalid", collect: async () => null },
    ]);
    expect(result.jobs).toEqual([]);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].error.message).toMatch(/invalid job list/);
  });

  it("bounds collector concurrency while still running every source", async () => {
    let active = 0;
    let maxActive = 0;
    const completed = [];
    const entries = Array.from({ length: 8 }, (_, index) => ({
      key: `source-${index}`,
      async collect() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        completed.push(index);
        return [];
      },
    }));

    const result = await collectBatch({ collectorConcurrency: 2 }, entries);
    expect(maxActive).toBe(2);
    expect(completed).toHaveLength(entries.length);
    expect(result).toMatchObject({ totalCount: entries.length, errorCount: 0 });
  });

  it("uses a bounded concurrency default for a large public run", async () => {
    let active = 0;
    let maxActive = 0;
    const entries = Array.from({ length: 15 }, (_, index) => ({
      key: `default-source-${index}`,
      async collect() {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return [];
      },
    }));

    await collectBatch({}, entries);
    expect(maxActive).toBe(10);
  });

  it("rejects unsafe collector concurrency values", async () => {
    await expect(collectBatch({ collectorConcurrency: 0 }, []))
      .rejects.toThrow(/between 1 and 50/);
    await expect(collectBatch({ collectorConcurrency: 500 }, []))
      .rejects.toThrow(/between 1 and 50/);
  });

  it("inspects descriptions through injected persistence callbacks", async () => {
    const persistDescription = vi.fn();
    const recordLegitimacy = vi.fn();
    const [result] = await inspectJobs([job()], {
      profile: { education_level: "bachelors" },
      isLive: async () => true,
      fetchDescription: async () => "Bachelor's degree. Two years of experience.",
      persistDescriptions: true,
      persistDescription,
      recordLegitimacy,
    });

    expect(result.description).toContain("Bachelor's degree");
    expect(persistDescription).toHaveBeenCalledOnce();
    expect(recordLegitimacy).toHaveBeenCalledOnce();
  });

  it("does not write description caches unless a consumer opts in", async () => {
    const persistDescription = vi.fn();
    await inspectJobs([job()], {
      isLive: async () => true,
      fetchDescription: async () => "Description",
      persistDescription,
    });
    expect(persistDescription).not.toHaveBeenCalled();
  });

  it("runs collection and pure filtering without a delivery adapter", async () => {
    const accepted = job();
    const rejected = job({ id: "43", key: "foreign", countryCode: "CA", location: "Toronto, ON" });
    const result = await runPipelineOnce({
      countryFilter: "us",
      maxPostAgeMinutes: 180,
      maxDateOnlyAgeDays: 1,
    }, {
      registry: [{ key: "fixture", lane: "normal", collect: async () => [accepted, rejected] }],
      sourceKeys: [],
      lanes: [],
    });

    expect(result.jobs).toEqual([accepted]);
    expect(result.inspected[0].job).toEqual(accepted);
  });

  it("rejects a source filter that matches nothing", async () => {
    await expect(runPipelineOnce({ countryFilter: "all" }, {
      registry: [{ key: "fixture", lane: "normal", collect: async () => [] }],
      sourceKeys: ["typo"],
    })).rejects.toThrow(/No collectors matched/);
  });
});
