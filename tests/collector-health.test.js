import { describe, expect, it } from "vitest";
import {
  allWindowCollectorsFailed,
  collectorFailureReason,
  createCollectorHealthWindow,
} from "../src/collector-health.js";

function collection(totalCount, errorCount = 0, key = "failed-source") {
  return {
    totalCount,
    errorCount,
    errors: errorCount > 0
      ? [{ key, error: new Error("upstream timeout") }]
      : [],
  };
}

describe("collector health windows", () => {
  it("does not turn a singleton remainder failure into a pipeline outage", () => {
    const window = createCollectorHealthWindow();
    for (let batch = 0; batch < 9; batch += 1) window.record(collection(20));
    window.record(collection(1, 1, "appliedmaterials"));

    const result = window.take();
    expect(result).toMatchObject({ totalCount: 181, errorCount: 1 });
    expect(result.errors[0].key).toBe("appliedmaterials");
    expect(allWindowCollectorsFailed(result)).toBe(false);
  });

  it("fails health only when every attempted collector in the window failed", () => {
    const window = createCollectorHealthWindow();
    for (let batch = 0; batch < 9; batch += 1) {
      window.record(collection(20, 20, `batch-${batch + 1}`));
    }
    window.record(collection(1, 1, "appliedmaterials"));

    const result = window.take();
    expect(result).toMatchObject({ totalCount: 181, errorCount: 181 });
    expect(allWindowCollectorsFailed(result)).toBe(true);
    expect(collectorFailureReason(result, "normal rotation")).toContain("batch-1");
  });

  it("counts an empty successful response as a healthy attempted collector", () => {
    const window = createCollectorHealthWindow();
    window.record({ totalCount: 1, errorCount: 0, errors: [], jobs: [] });
    expect(window.take()).toMatchObject({ totalCount: 1, errorCount: 0 });
  });

  it("does not fail an empty window and resets cleanly between rotations", () => {
    const window = createCollectorHealthWindow();
    expect(allWindowCollectorsFailed(window.snapshot())).toBe(false);
    window.record(collection(2, 2));
    expect(allWindowCollectorsFailed(window.take())).toBe(true);
    expect(window.snapshot()).toEqual({ totalCount: 0, errorCount: 0, errors: [] });
  });
});
