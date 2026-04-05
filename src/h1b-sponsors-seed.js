/**
 * h1b-sponsors-seed.js
 * Populates the h1b_sponsors table from the company registry.
 *
 * Run with: node src/h1b-sponsors-seed.js
 */

import { initDb, closeDb } from "./state.js";
import { upsertH1bSponsor } from "./multi-user-state.js";
import { COMPANIES } from "./companies.js";

// Companies known to NOT sponsor H1B
const NON_SPONSORS = new Set([
  // Most companies in our list DO sponsor. Add keys here for any that don't.
]);

function seed() {
  initDb("data/jobs.db");

  for (const company of COMPANIES) {
    upsertH1bSponsor({
      companyKey: company.key,
      companyName: company.label,
      sponsorsH1b: !NON_SPONSORS.has(company.key),
      lcaCount: 0,
      avgSalary: 0,
    });
  }

  console.log(`Seeded ${COMPANIES.length} companies into h1b_sponsors table.`);
  closeDb();
}

seed();
