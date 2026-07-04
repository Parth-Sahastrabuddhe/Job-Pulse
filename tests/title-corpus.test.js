/**
 * Regression harness over the labeled title corpus
 * (tests/fixtures/title-labels.json). 100% must pass: any classifier or
 * taxonomy change that shifts a labeled title fails here first, which is the
 * safety net that lets the taxonomy grow without silently re-leveling or
 * dropping existing roles.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectSeniority, detectRoleCategories, isTargetRole } from "../src/role-taxonomy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "title-labels.json"), "utf8"));

describe("labeled title corpus", () => {
  for (const entry of corpus.entries) {
    const where = entry.source ? ` @ ${entry.source}` : "";
    it(`"${entry.title}"${where} → ${entry.level} [${entry.categories.join(", ")}]`, () => {
      expect(isTargetRole(entry.title), "passes collection gate").toBe(true);
      expect(detectSeniority(entry.title, entry.source || "")).toBe(entry.level);
      const got = detectRoleCategories(entry.title);
      for (const category of entry.categories) {
        expect(got, `expected category ${category}`).toContain(category);
      }
    });
  }

  for (const title of corpus.notCollected) {
    it(`not collected: "${title}"`, () => {
      expect(isTargetRole(title)).toBe(false);
    });
  }
});
