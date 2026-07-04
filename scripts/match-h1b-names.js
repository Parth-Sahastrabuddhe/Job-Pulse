/**
 * match-h1b-names.js: report how each registry company resolves against the
 * LCA seed, and suggest alias candidates for the misses. Curation tool for
 * H1B_NAME_ALIASES in src/h1b-matching.js; run locally after rebuilding the
 * seed. No DB access.
 *
 * Usage: node scripts/match-h1b-names.js [path/to/h1b-lca.json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANIES } from "../src/companies.js";
import { normalizeEmployerName, resolveCompanyStats } from "../src/h1b-matching.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = process.argv[2] || path.join(__dirname, "..", "seeds", "h1b-lca.json");
const { employers } = JSON.parse(fs.readFileSync(seedPath, "utf8"));

const STOPWORDS = new Set(["THE", "AI", "LABS", "GLOBAL", "TECH", "GROUP", "SYSTEMS", "DIGITAL", "DATA"]);

let matched = 0;
const misses = [];
for (const company of COMPANIES) {
  const stats = resolveCompanyStats(employers, company);
  if (stats) {
    matched++;
    console.log(`OK   ${company.key.padEnd(20)} ${String(stats.lcaCount).padStart(6)} LCAs  ~$${Math.round(stats.medianWage / 1000)}k  [${stats.matchedNames.join(" | ")}]`);
  } else {
    misses.push(company);
  }
}

console.log(`\n${matched}/${COMPANIES.length} matched. Misses with alias candidates (seed entries sharing a significant word, n >= 25):\n`);
for (const company of misses) {
  const norm = normalizeEmployerName(company.label);
  const word = norm.split(" ").find((w) => w.length >= 4 && !STOPWORDS.has(w)) || norm.split(" ")[0] || "";
  const candidates = word
    ? Object.entries(employers)
        .filter(([name, v]) => name.includes(word) && v.n >= 25)
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 4)
        .map(([name, v]) => `${name} (${v.n})`)
    : [];
  console.log(`MISS ${company.key.padEnd(20)} label="${company.label}" norm="${norm}"${candidates.length ? `\n     candidates: ${candidates.join(" | ")}` : ""}`);
}
