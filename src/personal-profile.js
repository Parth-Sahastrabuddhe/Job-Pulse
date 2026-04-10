/**
 * Synthetic profile representing the personal bot's preferences.
 *
 * Lives in its own file (rather than inline in index.js) so that test files
 * like tests/filter-parity.test.js can import it without triggering the
 * top-level main() side effect in src/index.js.
 *
 * Fields are JSON-stringified to match the shape that filterJobForUser
 * expects when reading DB user profiles — so the same function handles
 * both the personal bot and the multi-user bot.
 */
export const PERSONAL_PROFILE = {
  id: "personal",
  role_categories: JSON.stringify(["software_engineer"]),
  seniority_levels: JSON.stringify(["entry", "mid"]),
  company_selections: JSON.stringify(["all"]),
  country: "US",
  requires_sponsorship: 1,
  education_level: "masters",
};
