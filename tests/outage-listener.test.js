import { describe, it, expect } from "vitest";
import {
  isDownAlert,
  extractCheckName,
  shouldDebounce,
  shouldCap,
} from "../scripts/outage-listener.js";

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
