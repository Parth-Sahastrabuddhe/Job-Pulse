import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertRegularFileWithin,
  buildExportPlan,
  dependencyClosure,
  exportPlan,
  localSpecifiers,
} from "../scripts/export-open-core.mjs";

const tempDirs = [];

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
});

describe("open-core exporter filesystem boundary", () => {
  it("rejects a source symlink even when its target is a regular file", async () => {
    const root = tempDir("jobpulse-export-source-");
    const outside = path.join(tempDir("jobpulse-export-outside-"), "secret.txt");
    fs.writeFileSync(outside, "secret");
    fs.symlinkSync(outside, path.join(root, "link.txt"));

    await expect(assertRegularFileWithin(root, "link.txt"))
      .rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlinked export destination", async () => {
    const holder = tempDir("jobpulse-export-dest-");
    const outside = tempDir("jobpulse-export-target-");
    const destination = path.join(holder, "public-core");
    fs.symlinkSync(outside, destination, "dir");

    await expect(exportPlan(new Map([["LICENSE", "LICENSE"]]), destination))
      .rejects.toThrow(/symbolic link|real directory/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("rejects a destination below a symlinked ancestor", async () => {
    const holder = tempDir("jobpulse-export-parent-");
    const outside = tempDir("jobpulse-export-parent-target-");
    const linkedParent = path.join(holder, "linked");
    fs.symlinkSync(outside, linkedParent, "dir");

    await expect(exportPlan(new Map([["LICENSE", "LICENSE"]]), path.join(linkedParent, "new")))
      .rejects.toThrow(/symbolic link/i);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe("open-core exporter JavaScript boundary", () => {
  it("preserves the exact current public export plan", async () => {
    const plan = await buildExportPlan();
    expect(plan.size).toBe(58);
    expect([...plan.keys()]).not.toContain("src/private-config.js");
    expect([...plan.keys()]).not.toContain("src/multi-user.js");
  });

  it("rejects an imported JavaScript module missing from the exact allowlist", async () => {
    const sources = new Map([
      ["src/public.js", 'import "./private-new.js";'],
      ["src/private-new.js", "export const secret = true;"],
    ]);

    await expect(dependencyClosure(
      ["src/public.js"],
      new Set(),
      new Set(["src/public.js"]),
      {
        readFile: async (file) => Buffer.from(sources.get(file), "utf8"),
        resolveImport: async (_importer, specifier) => {
          expect(specifier).toBe("./private-new.js");
          return "src/private-new.js";
        },
      },
    )).rejects.toThrow(/non-allowlisted.*private-new\.js/i);
  });

  it("rejects non-literal dynamic imports", () => {
    expect(() => localSpecifiers(
      "const moduleName = './private-new.js'; await import(moduleName);",
      "src/public.js",
    )).toThrow(/non-literal dynamic import/i);
    expect(() => localSpecifiers(
      "await import(`./${moduleName}.js`);",
      "src/public.js",
    )).toThrow(/non-literal dynamic import/i);
    expect(() => localSpecifiers(
      "await import /* comments cannot bypass validation */ (moduleName);",
      "src/public.js",
    )).toThrow(/non-literal dynamic import/i);
  });

  it("allows literal ESM imports but rejects CommonJS loaders", () => {
    expect(localSpecifiers(
      'import value from "./value.js"; await import("playwright");',
      "src/public.js",
    )).toEqual(["./value.js"]);
    expect(() => localSpecifiers(
      'const value = require("./private-new.js");',
      "src/public.js",
    )).toThrow(/CommonJS require\/createRequire/i);
    expect(() => localSpecifiers(
      'const value = require /* comments cannot bypass validation */ ("./private-new.js");',
      "src/public.js",
    )).toThrow(/CommonJS require\/createRequire/i);
    expect(() => localSpecifiers(
      'import { createRequire } from "node:module";',
      "src/public.js",
    )).toThrow(/CommonJS require\/createRequire/i);
  });
});
