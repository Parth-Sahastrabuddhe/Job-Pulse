/**
 * h1b-matching.js: match JobPulse registry companies to DOL LCA employer names.
 *
 * seeds/h1b-lca.json (built by scripts/build-h1b-seed.py from the DOL LCA
 * disclosure files) keys employers by a normalized legal name.
 * normalizeEmployerName() here MUST mirror the Python normalization exactly;
 * if one changes, change the other and rebuild the seed.
 */

const LEGAL_SUFFIXES = new Set([
  "INC", "LLC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED",
  "LP", "LLP", "PLC", "PC", "PLLC", "PBC", "INCORPORATED", "&",
]);

export function normalizeEmployerName(name) {
  if (!name) return "";
  let s = String(name).toUpperCase();
  s = s.replace(/[.,'"()]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  // Collapse spaced-out legal forms so the suffix strip catches them
  // ("BLOOMBERG L P" -> "BLOOMBERG LP" -> "BLOOMBERG").
  s = s.replace(/\bL L C\b/g, "LLC");
  s = s.replace(/\bL L P\b/g, "LLP");
  s = s.replace(/\bL P\b/g, "LP");
  const parts = s.split(" ");
  while (parts.length && LEGAL_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

// Explicit overrides where the brand label differs from the LCA filing
// entity/entities. Values are NORMALIZED employer names (post-normalize).
// Curated against the 2025 seed via scripts/match-h1b-names.js; extend when
// the report shows a big employer a label doesn't auto-match.
export const H1B_NAME_ALIASES = {
  amazon: [
    "AMAZON COM SERVICES",
    "AMAZON WEB SERVICES",
    "AMAZON DEVELOPMENT CENTER U S",
    "AMAZON DATA SERVICES",
  ],
  meta: ["META PLATFORMS"],
  openai: ["OPENAI OPCO", "OPENAI"],
  xai: ["X AI"],
  walmartglobaltech: ["WAL-MART ASSOCIATES"],
  usbank: ["U S BANK NATIONAL ASSOCIATION"],
  jpmorgan: ["JPMORGAN CHASE", "JPMORGAN CHASE BANK NATIONAL ASSOCIATION"],
  goldmansachs: ["GOLDMAN SACHS", "GOLDMAN SACHS SERVICES"],
  morganstanley: ["MORGAN STANLEY", "MORGAN STANLEY SERVICES GROUP"],
  oracle: ["ORACLE AMERICA"],
  citi: ["CITIBANK N A", "CITIGROUP GLOBAL MARKETS", "CITIGROUP TECHNOLOGY"],
  mercedesbenz: ["MERCEDES-BENZ RESEARCH & DEVELOPMENT NORTH AMERICA"],
  hexaware: ["HEXAWARE TECHNOLOGIES"],
  uber: ["UBER TECHNOLOGIES"],
  cisco: ["CISCO SYSTEMS"],
  capitalone: ["CAPITAL ONE SERVICES", "CAPITAL ONE NATIONAL ASSOCIATION"],
  samsung: [
    "SAMSUNG ELECTRONICS AMERICA",
    "SAMSUNG SEMICONDUCTOR",
    "SAMSUNG RESEARCH AMERICA",
    "SAMSUNG AUSTIN SEMICONDUCTOR",
  ],
  fidelity: [
    "FIDELITY TECHNOLOGY GROUP LLC D/B/A FIDELITY INVESTMENTS",
    "FMR LLC D/B/A FIDELITY INVESTMENTS",
  ],
  wellsfargo: ["WELLS FARGO BANK N A"],
  boeing: ["THE BOEING"],
  disney: ["DISNEY PARKS TECHNOLOGY SERVICES", "DISNEY STREAMING SERVICES", "DISNEY WORLDWIDE SERVICES"],
  dell: ["DELL USA", "DELL PRODUCTS"],
  comcast: ["COMCAST CABLE COMMUNICATIONS"],
  target: ["TARGET ENTERPRISE"],
  qualcomm: ["QUALCOMM TECHNOLOGIES"],
  robinhood: ["ROBINHOOD MARKETS"],
  instacart: ["MAPLEBEAR"], // Instacart's legal filing entity
  elastic: ["ELASTICSEARCH"],
  zoominfo: ["ZOOMINFO TECHNOLOGIES"],
  hudl: ["AGILE SPORTS TECHNOLOGIES"],
  hackerrank: ["INTERVIEWSTREET"],
  palantir: ["PALANTIR TECHNOLOGIES"],
  spotify: ["SPOTIFY USA"],
  anchorage: ["ANCHOR LABS"],
  attentive: ["ATTENTIVE MOBILE"],
  gopuff: ["GOBRANDS"],
  notion: ["NOTION LABS"],
  ramp: ["RAMP BUSINESS"],
  cursor: ["ANYSPHERE"], // Cursor's legal filing entity
  airtable: ["FORMAGRID"],
  sentry: ["FUNCTIONAL SOFTWARE"],
  elevenlabs: ["ELEVEN LABS"],
  runway: ["RUNWAY AI"],
  deel: ["DEEL US"],
  harvey: ["COUNSEL AI"],
  visa: ["VISA TECHNOLOGY & OPERATIONS", "VISA U S A"],
  bosch: ["ROBERT BOSCH"],
  sanofi: ["SANOFI US SERVICES", "SANOFI PASTEUR"],
  adyen: ["ADYEN N V"],
  glean: ["GLEAN TECHNOLOGIES"],
  aurora: ["AURORA OPERATIONS", "AURORA INNOVATION"],
  drw: ["DRW HOLDINGS"],
  ripple: ["RIPPLE LABS"],
  sofi: ["SOCIAL FINANCE"],
  motional: ["MOTIONAL AD"],
  upstart: ["UPSTART NETWORK"],
  faire: ["FAIRE WHOLESALE"],
  chime: ["CHIME FINANCIAL"],
  towerresearch: ["TOWER RESEARCH CAPITAL"],
  jumptrading: ["JUMP OPERATIONS"],
  kraken: ["PAYWARD"], // Kraken's legal filing entity
  perplexity: ["PERPLEXITY AI"],
  modal: ["MODAL LABS"],
  sift: ["SIFT SCIENCE"],
  experian: ["EXPERIAN INFORMATION SOLUTIONS"],
  gemini: ["GEMINI TRUST"],
  sambanova: ["SAMBANOVA SYSTEMS"],
  cockroachlabs: ["COCKROACH LABS"],
  dbtlabs: ["DBT LABS"],
  sixsense: ["6SENSE INSIGHTS"],
  temporal: ["TEMPORAL TECHNOLOGIES"],
  carta: ["ESHARES"], // Carta's legal filing entity
  // Deliberately unmatched: deepmind (US hires file under GOOGLE), cohere
  // (COHERE HEALTH in the data is a different company). Small remote-first
  // shops (zapier, supabase, posthog, linear, render, warp, ...) simply have
  // no meaningful US LCA volume; they show no H-1B line rather than a wrong one.
};

export function candidateNamesFor(company) {
  const names = new Set(H1B_NAME_ALIASES[company.key] ?? []);
  names.add(normalizeEmployerName(company.label));
  names.delete("");
  return [...names];
}

/**
 * Aggregate seed stats across all candidate employer names for a company.
 * Wage is the LCA-count-weighted average of per-entity median wages, which
 * tracks "typical certified wage" closely enough for a one-line embed hint.
 *
 * @param {Record<string, {n: number, w: number}>} employers seed employers map
 * @param {{key: string, label: string}} company registry entry
 * @returns {{lcaCount: number, medianWage: number, matchedNames: string[]}|null}
 */
export function resolveCompanyStats(employers, company) {
  let count = 0;
  let wageWeighted = 0;
  let wageCount = 0;
  const matchedNames = [];
  for (const name of candidateNamesFor(company)) {
    const entry = employers[name];
    if (!entry) continue;
    matchedNames.push(name);
    count += entry.n;
    if (entry.w > 0) {
      wageWeighted += entry.w * entry.n;
      wageCount += entry.n;
    }
  }
  if (count === 0) return null;
  return {
    lcaCount: count,
    medianWage: wageCount > 0 ? Math.round(wageWeighted / wageCount) : 0,
    matchedNames,
  };
}
