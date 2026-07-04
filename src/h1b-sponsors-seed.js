/**
 * h1b-sponsors-seed.js
 * Populates the h1b_sponsors table from the company registry, enriched with
 * real DOL LCA disclosure stats (seeds/h1b-lca.json, built locally by
 * scripts/build-h1b-seed.py). Companies with no seed match keep
 * lca_count = 0 and simply show no H-1B history line in embeds.
 *
 * Run with: node src/h1b-sponsors-seed.js   (a.k.a. npm run seed:sponsors)
 * Safe to re-run any time; it upserts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, closeDb } from "./state.js";
import { upsertH1bSponsor } from "./multi-user-state.js";
import { COMPANIES } from "./companies.js";
import { resolveCompanyStats } from "./h1b-matching.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "..", "seeds", "h1b-lca.json");

// Companies known to NOT sponsor H1B
const NON_SPONSORS = new Set([
  // Most companies in our list DO sponsor. Add keys here for any that don't.
]);

function loadLcaSeed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
    if (parsed && typeof parsed.employers === "object") return parsed;
  } catch (err) {
    console.warn(`[seed] No usable LCA seed at ${SEED_PATH} (${err.message}); seeding with zero stats.`);
  }
  return { meta: { window: "" }, employers: {} };
}

function seed() {
  initDb("data/jobs.db");
  const { meta, employers } = loadLcaSeed();

  let withStats = 0;
  for (const company of COMPANIES) {
    const stats = resolveCompanyStats(employers, company);
    if (stats) withStats++;
    upsertH1bSponsor({
      companyKey: company.key,
      companyName: company.label,
      sponsorsH1b: !NON_SPONSORS.has(company.key),
      lcaCount: stats?.lcaCount ?? 0,
      avgSalary: stats?.medianWage ?? 0,
      lcaFy: stats ? String(meta.window || "") : "",
    });
  }

  console.log(`Seeded ${COMPANIES.length} companies into h1b_sponsors (${withStats} with LCA stats, window=${meta.window || "n/a"}).`);
  closeDb();
}

seed();
