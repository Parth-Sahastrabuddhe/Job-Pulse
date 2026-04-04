import { describe, it, expect } from "vitest";
import { isInQuietHours, shouldDeliverDigest, getDeliveryAction } from "../src/mu-scheduler.js";

describe("isInQuietHours", () => {
  it("returns false when no quiet hours configured", () => {
    expect(isInQuietHours(null, null, "America/New_York", new Date())).toBe(false);
  });

  it("returns true during quiet hours (same day, e.g. 13:00-17:00, check at 15:00)", () => {
    const now = new Date("2026-04-03T15:00:00Z");
    expect(isInQuietHours("13:00", "17:00", "UTC", now)).toBe(true);
  });

  it("returns false outside quiet hours (same day)", () => {
    const now = new Date("2026-04-03T12:00:00Z");
    expect(isInQuietHours("13:00", "17:00", "UTC", now)).toBe(false);
  });

  it("handles overnight quiet hours (22:00-08:00)", () => {
    const now23 = new Date("2026-04-03T23:00:00Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", now23)).toBe(true);

    const now03 = new Date("2026-04-04T03:00:00Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", now03)).toBe(true);

    const now12 = new Date("2026-04-04T12:00:00Z");
    expect(isInQuietHours("22:00", "08:00", "UTC", now12)).toBe(false);
  });

  it("handles timezone conversion", () => {
    // 03:00 UTC = 23:00 EDT → within 22:00-08:00 ET
    const now = new Date("2026-04-04T03:00:00Z");
    expect(isInQuietHours("22:00", "08:00", "America/New_York", now)).toBe(true);
  });
});

describe("shouldDeliverDigest", () => {
  it('returns false for "realtime" mode', () => {
    expect(shouldDeliverDigest("realtime", "America/New_York", null, new Date())).toBe(false);
  });

  it('returns true for "daily" mode after 8am and not yet delivered today', () => {
    const now = new Date("2026-04-03T14:00:00Z"); // 10:00 EDT
    expect(shouldDeliverDigest("daily", "America/New_York", null, now)).toBe(true);
  });

  it('returns false for "daily" mode before 8am', () => {
    const now = new Date("2026-04-03T10:00:00Z"); // 06:00 EDT
    expect(shouldDeliverDigest("daily", "America/New_York", null, now)).toBe(false);
  });

  it('returns false for "daily" if already delivered today', () => {
    const now = new Date("2026-04-03T14:00:00Z");
    const lastDelivered = new Date("2026-04-03T12:05:00Z").toISOString();
    expect(shouldDeliverDigest("daily", "America/New_York", lastDelivered, now)).toBe(false);
  });

  it('returns true for "weekly" on Monday after 8am', () => {
    const now = new Date("2026-04-06T14:00:00Z"); // Monday
    expect(shouldDeliverDigest("weekly", "America/New_York", null, now)).toBe(true);
  });

  it('returns false for "weekly" on non-Monday', () => {
    const now = new Date("2026-04-03T14:00:00Z"); // Friday
    expect(shouldDeliverDigest("weekly", "America/New_York", null, now)).toBe(false);
  });
});

describe("getDeliveryAction", () => {
  it('returns "send" for realtime mode outside quiet hours', () => {
    const profile = { notification_mode: "realtime", quiet_hours_start: null, quiet_hours_end: null, quiet_hours_tz: "UTC" };
    expect(getDeliveryAction(profile, new Date())).toBe("send");
  });

  it('returns "queue" for realtime mode during quiet hours', () => {
    const profile = { notification_mode: "realtime", quiet_hours_start: "00:00", quiet_hours_end: "23:59", quiet_hours_tz: "UTC" };
    expect(getDeliveryAction(profile, new Date("2026-04-03T12:00:00Z"))).toBe("queue");
  });

  it('returns "queue" for daily mode', () => {
    const profile = { notification_mode: "daily", quiet_hours_start: null, quiet_hours_end: null, quiet_hours_tz: "UTC" };
    expect(getDeliveryAction(profile, new Date())).toBe("queue");
  });

  it('returns "queue" for weekly mode', () => {
    const profile = { notification_mode: "weekly", quiet_hours_start: null, quiet_hours_end: null, quiet_hours_tz: "UTC" };
    expect(getDeliveryAction(profile, new Date())).toBe("queue");
  });
});
