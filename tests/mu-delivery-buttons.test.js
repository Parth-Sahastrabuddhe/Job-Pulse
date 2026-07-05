import { describe, expect, it } from "vitest";
import { buildDmButtons, jobButtonHash } from "../src/mu-delivery.js";

const hash = jobButtonHash("src:1");

function ids(rows) {
  return rows[0].toJSON().components.map((c) => c.custom_id ?? "link");
}

describe("buildDmButtons fit check option", () => {
  it("keeps the legacy 4-button row by default", () => {
    const rows = buildDmButtons(hash, "https://x.test/1", "pending");
    expect(rows[0].toJSON().components).toHaveLength(4);
  });

  it("appends mu_fitcheck as the 5th button when enabled", () => {
    const rows = buildDmButtons(hash, "https://x.test/1", "pending", { fitCheck: true });
    const components = rows[0].toJSON().components;
    expect(components).toHaveLength(5);
    expect(components[4].custom_id).toBe(`mu_fitcheck:${hash}`);
    expect(components[4].disabled ?? false).toBe(false);
  });

  it("keeps fit check enabled even in the applied state", () => {
    const rows = buildDmButtons(hash, "https://x.test/1", "applied", { fitCheck: true });
    const components = rows[0].toJSON().components;
    expect(components[4].custom_id).toBe(`mu_fitcheck:${hash}`);
    expect(components[4].disabled ?? false).toBe(false);
  });
});
