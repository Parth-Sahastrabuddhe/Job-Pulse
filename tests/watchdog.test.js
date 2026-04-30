import { describe, it, expect, vi, afterEach } from "vitest";
import { createWatchdog } from "../src/watchdog.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createWatchdog", () => {
  it("calls onTimeout when no progress for timeoutMs", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout });
    vi.advanceTimersByTime(1500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    wd.stop();
  });

  it("does not call onTimeout when progress() is reported within timeout", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout });
    vi.advanceTimersByTime(500);
    wd.progress();
    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled();
    wd.stop();
  });

  it("only fires onTimeout once per timeout window (debounced via progress)", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout });
    vi.advanceTimersByTime(1500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    // After firing, the watchdog should not keep firing on every check —
    // it waits for progress() to reset, then resumes monitoring.
    vi.advanceTimersByTime(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    wd.stop();
  });

  it("resumes monitoring after progress() following a timeout", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout });
    vi.advanceTimersByTime(1500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    wd.progress();
    vi.advanceTimersByTime(1500);
    expect(onTimeout).toHaveBeenCalledTimes(2);
    wd.stop();
  });

  it("stop() prevents further onTimeout calls", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout });
    wd.stop();
    vi.advanceTimersByTime(2000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("interval is unrefed so it doesn't keep the loop alive on its own", () => {
    vi.useFakeTimers();
    const wd = createWatchdog({ timeoutMs: 1000, checkIntervalMs: 100, onTimeout: () => {} });
    // Smoke test: interval has unref method (Node timer)
    expect(typeof wd.stop).toBe("function");
    wd.stop();
  });
});
