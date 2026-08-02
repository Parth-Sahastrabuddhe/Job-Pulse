#!/usr/bin/env node

/**
 * Fail-closed exporter for the public JobPulse Core repository.
 *
 * It follows the local import graph from public entrypoints instead of copying
 * the working tree, and requires every selected JavaScript file to appear in
 * an exact public allowlist. A destination must be new or empty; this script
 * never deletes or overwrites.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_ROOT_REAL = await fs.realpath(PROJECT_ROOT);
const MANIFEST_PATH = path.join(PROJECT_ROOT, "open-core", "manifest.json");
const FORBIDDEN_PREFIXES = [
  "automation/",
  "data/",
  "deploy/",
  "docs/",
  "extension/",
  "outreach/",
  "resume/",
  "web/",
];
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+/i,
  /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  /\b[MNO][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
];
const JAVASCRIPT_FILE = /\.[cm]?js$/i;
const LOADER_TRIVIA = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*`;
const DYNAMIC_IMPORT_CALL = new RegExp(String.raw`\bimport${LOADER_TRIVIA}\(`, "g");
const COMMONJS_REQUIRE_CALL = new RegExp(String.raw`\brequire${LOADER_TRIVIA}\(`);

function normalizeRelative(file) {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

function assertSafeRelative(file, label) {
  if (typeof file !== "string" || !file || path.isAbsolute(file)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = normalizeRelative(path.normalize(file));
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} escapes the repository: ${file}`);
  }
  if (FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`${label} points into private/irrelevant scope: ${normalized}`);
  }
  return normalized;
}

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Reject symlinks and files whose resolved location escapes the selected root. */
export async function assertRegularFileWithin(root, relativeFile, label = "source") {
  const rootAbsolute = path.resolve(root);
  const rootReal = await fs.realpath(rootAbsolute);
  const absolute = path.resolve(rootAbsolute, relativeFile);
  if (!pathIsWithin(rootAbsolute, absolute)) throw new Error(`${label} escapes its root`);
  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${relativeFile}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${relativeFile}`);
  const real = await fs.realpath(absolute);
  if (!pathIsWithin(rootReal, real)) throw new Error(`${label} resolves outside its root: ${relativeFile}`);
  return absolute;
}

async function readRepoFile(relativeFile) {
  const absolute = await assertRegularFileWithin(PROJECT_ROOT_REAL, relativeFile, "public source");
  return fs.readFile(absolute);
}

async function loadManifest() {
  const manifest = JSON.parse((await readRepoFile(path.relative(PROJECT_ROOT, MANIFEST_PATH))).toString("utf8"));
  if (!Array.isArray(manifest.entrypoints) || manifest.entrypoints.length === 0) {
    throw new Error("open-core manifest requires at least one entrypoint");
  }
  if (!Array.isArray(manifest.publicJavaScript) || manifest.publicJavaScript.length === 0 ||
      !Array.isArray(manifest.copy) || !Array.isArray(manifest.forbiddenDependencies)) {
    throw new Error("open-core manifest has an invalid shape");
  }
  return manifest;
}

function isJavaScriptFile(file) {
  return JAVASCRIPT_FILE.test(file);
}

function skipLoaderTrivia(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const end = source.indexOf("*/", cursor + 2);
      if (end === -1) return source.length;
      cursor = end + 2;
      continue;
    }
    if (source.startsWith("//", cursor)) {
      const end = source.indexOf("\n", cursor + 2);
      if (end === -1) return source.length;
      cursor = end + 1;
      continue;
    }
    break;
  }
  return cursor;
}

function readLiteralDynamicImport(source, openParenIndex, label) {
  let cursor = skipLoaderTrivia(source, openParenIndex + 1);
  const quote = source[cursor];
  if (quote !== "\"" && quote !== "'") {
    throw new Error(`Non-literal dynamic import is not allowed in public JavaScript: ${label}`);
  }

  cursor += 1;
  const valueStart = cursor;
  while (cursor < source.length && source[cursor] !== quote) {
    if (source[cursor] === "\\") {
      throw new Error(`Escaped dynamic import specifiers are not allowed in public JavaScript: ${label}`);
    }
    if (source[cursor] === "\n" || source[cursor] === "\r") {
      throw new Error(`Invalid dynamic import specifier in public JavaScript: ${label}`);
    }
    cursor += 1;
  }
  if (cursor >= source.length) {
    throw new Error(`Unterminated dynamic import specifier in public JavaScript: ${label}`);
  }

  const specifier = source.slice(valueStart, cursor);
  cursor = skipLoaderTrivia(source, cursor + 1);
  if (source[cursor] !== ")") {
    throw new Error(`Dynamic imports must use exactly one literal argument in public JavaScript: ${label}`);
  }
  return specifier;
}

/** Parse local ESM imports while rejecting loaders that can bypass the closure. */
export function localSpecifiers(source, label = "public source") {
  if (COMMONJS_REQUIRE_CALL.test(source) || /\bcreateRequire\b/.test(source)) {
    throw new Error(`CommonJS require/createRequire is not allowed in public JavaScript: ${label}`);
  }

  const specs = [];
  const staticImport = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = staticImport.exec(source))) {
    if (match[1].startsWith(".")) specs.push(match[1]);
  }

  DYNAMIC_IMPORT_CALL.lastIndex = 0;
  while ((match = DYNAMIC_IMPORT_CALL.exec(source))) {
    const openParenIndex = DYNAMIC_IMPORT_CALL.lastIndex - 1;
    const specifier = readLiteralDynamicImport(source, openParenIndex, label);
    if (specifier.startsWith(".")) specs.push(specifier);
  }
  return specs;
}

async function resolveLocalImport(importer, specifier) {
  const candidate = path.resolve(PROJECT_ROOT, path.dirname(importer), specifier);
  const variants = path.extname(candidate)
    ? [candidate]
    : [candidate, `${candidate}.js`, `${candidate}.mjs`, path.join(candidate, "index.js")];
  for (const variant of variants) {
    try {
      const relative = normalizeRelative(path.relative(PROJECT_ROOT, variant));
      await assertRegularFileWithin(PROJECT_ROOT_REAL, relative, "import dependency");
      return relative;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Cannot resolve ${specifier} imported by ${importer}`);
}

export async function dependencyClosure(
  seedFiles,
  forbidden,
  allowedJavaScript,
  { readFile = readRepoFile, resolveImport = resolveLocalImport } = {},
) {
  const pending = [...seedFiles];
  const included = new Set();

  while (pending.length) {
    const file = assertSafeRelative(pending.pop(), "public source");
    if (included.has(file)) continue;
    if (forbidden.has(file)) throw new Error(`Public import graph reached private module: ${file}`);
    if (!isJavaScriptFile(file) || !allowedJavaScript.has(file)) {
      throw new Error(`Public import graph reached non-allowlisted JavaScript module: ${file}`);
    }

    const source = (await readFile(file)).toString("utf8");
    included.add(file);
    for (const specifier of localSpecifiers(source, file)) {
      pending.push(await resolveImport(file, specifier));
    }
  }
  return included;
}

async function assertReleaseMetadata() {
  const pkg = JSON.parse((await readRepoFile("open-core/package.json")).toString("utf8"));
  if (pkg.private !== false) throw new Error("Public package template must set private=false");
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const privateDependency of ["better-sqlite3", "discord.js", "next", "nodemailer"]) {
    if (dependencies[privateDependency]) {
      throw new Error(`Public package must not include private dependency ${privateDependency}`);
    }
  }
}

export async function buildExportPlan() {
  const manifest = await loadManifest();
  const forbidden = new Set(manifest.forbiddenDependencies.map((file) =>
    assertSafeRelative(file, "forbidden dependency")
  ));
  const allowedJavaScriptList = manifest.publicJavaScript.map((file) => {
    const normalized = assertSafeRelative(file, "public JavaScript allowlist entry");
    if (!isJavaScriptFile(normalized)) {
      throw new Error(`Public JavaScript allowlist entry is not JavaScript: ${normalized}`);
    }
    return normalized;
  });
  const allowedJavaScript = new Set(allowedJavaScriptList);
  if (allowedJavaScript.size !== allowedJavaScriptList.length) {
    throw new Error("Public JavaScript allowlist contains duplicate entries");
  }
  for (const file of allowedJavaScript) {
    if (forbidden.has(file)) {
      throw new Error(`Public JavaScript allowlist includes a forbidden dependency: ${file}`);
    }
  }

  const explicit = new Map();
  const jsSeeds = [];
  for (const mapping of manifest.copy) {
    const from = assertSafeRelative(mapping.from, "copy source");
    const to = assertSafeRelative(mapping.to, "copy destination");
    if (explicit.has(to)) throw new Error(`Duplicate public destination: ${to}`);
    if (isJavaScriptFile(to) !== isJavaScriptFile(from)) {
      throw new Error(`Copy mapping cannot change JavaScript file type: ${from} -> ${to}`);
    }
    explicit.set(to, from);
    if (isJavaScriptFile(from)) {
      if (!allowedJavaScript.has(from)) {
        throw new Error(`Explicit public JavaScript is not allowlisted: ${from}`);
      }
      jsSeeds.push(from);
    }
  }

  const entrypoints = manifest.entrypoints.map((file) => assertSafeRelative(file, "entrypoint"));
  for (const entrypoint of entrypoints) {
    if (!isJavaScriptFile(entrypoint) || !allowedJavaScript.has(entrypoint)) {
      throw new Error(`Public entrypoint is not allowlisted JavaScript: ${entrypoint}`);
    }
  }
  const closure = await dependencyClosure(
    [...entrypoints, ...jsSeeds],
    forbidden,
    allowedJavaScript,
  );
  const unselectedAllowed = [...allowedJavaScript].filter((file) => !closure.has(file));
  if (unselectedAllowed.length > 0) {
    throw new Error(`Public JavaScript allowlist contains unselected files: ${unselectedAllowed.join(", ")}`);
  }
  const plan = new Map(explicit);
  for (const file of closure) {
    if (plan.has(file) && plan.get(file) !== file) {
      throw new Error(`Generated source collides with explicit destination: ${file}`);
    }
    plan.set(file, file);
  }

  await assertReleaseMetadata();
  for (const [to, from] of plan) {
    const contents = await readRepoFile(from);
    const text = contents.toString("utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) throw new Error(`Potential secret in public export source: ${from}`);
    }
    assertSafeRelative(to, "planned destination");
  }

  return new Map([...plan.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function assertSeparateDestination(destination) {
  const relativeFromRoot = path.relative(PROJECT_ROOT, destination);
  const relativeToRoot = path.relative(destination, PROJECT_ROOT);
  if (
    destination === PROJECT_ROOT ||
    (!relativeFromRoot.startsWith("..") && !path.isAbsolute(relativeFromRoot)) ||
    (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))
  ) {
    throw new Error("Export destination must be separate from this repository and its parents");
  }
}

async function nearestExistingPath(candidate) {
  let current = candidate;
  const missing = [];
  for (;;) {
    try {
      await fs.lstat(current);
      return { existing: current, missing };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`No existing parent for destination ${candidate}`);
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function assertSafeDestination(destination) {
  assertSeparateDestination(destination);
  const { existing, missing } = await nearestExistingPath(destination);
  const stat = await fs.lstat(existing);
  if (stat.isSymbolicLink()) throw new Error("Export destination must not traverse a symbolic link");
  if (!stat.isDirectory()) throw new Error("Export destination parent must be a directory");
  const existingReal = await fs.realpath(existing);
  if (existingReal !== path.resolve(existing)) {
    throw new Error("Export destination must not traverse symbolic-link ancestors");
  }
  const projected = path.join(existingReal, ...missing);
  assertSeparateDestination(projected);
}

export async function exportPlan(plan, destination) {
  await assertSafeDestination(destination);
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Export destination must be a real directory");
    }
    const existing = await fs.readdir(destination);
    if (existing.length > 0) throw new Error("Export destination must be empty");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(destination, { recursive: true, mode: 0o755 });
  }

  const destinationReal = await fs.realpath(destination);
  assertSeparateDestination(destinationReal);

  for (const [to, from] of plan) {
    const output = path.join(destination, to);
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o755 });
    const source = await assertRegularFileWithin(PROJECT_ROOT_REAL, from, "copy source");
    await fs.copyFile(source, output, fs.constants.COPYFILE_EXCL);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.length === 1 && args[0] === "--check";
  if (!checkOnly && args.length !== 1) {
    throw new Error("Usage: node scripts/export-open-core.mjs --check | <empty-destination>");
  }

  const plan = await buildExportPlan();
  if (checkOnly) {
    console.log(`Open-core boundary valid: ${plan.size} files`);
    return;
  }

  const destination = path.resolve(args[0]);
  await exportPlan(plan, destination);
  console.log(`Exported ${plan.size} files to ${destination}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[open-core] ${error.message}`);
    process.exitCode = 1;
  });
}
