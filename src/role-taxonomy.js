/**
 * role-taxonomy.js: single source of truth for role categories, section
 * grouping, and the cross-company level rules engine.
 *
 * Dependency-free on purpose (companies.js is pure data) so collectors,
 * delivery code, scripts, and tests can all import it. The web dashboard
 * keeps a UI mirror of ROLE_SECTIONS in web/lib/role-taxonomy.js;
 * tests/role-taxonomy.test.js asserts the two stay identical.
 *
 * Level equivalences follow levels.fyi's standard-levels model and company
 * ladder comparisons (banks: Analyst -> Associate -> VP as the IC track,
 * VP ~ Senior SWE; JPMorgan dual-titles SWE I/II/III against the
 * Analyst/Associate/Sr Associate bands; Google's titled SWE II/III are
 * L3/L4). Review quarterly alongside the LCA seed refresh.
 */

import { BANKING_COMPANIES } from "./companies.js";

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

// Language/technology-prefixed titles ("Java Developer", ".NET Engineer",
// "React Developer"). Kept as named pieces so the software_engineer,
// frontend, backend, and mobile patterns can share them.
// Each token is self-bounded (leading \b) except ".net", where the dot is a
// non-word char so \b can never match before it; the dot itself separates.
const LANG_ANY = "\\bjavascript|\\bjava|\\bpython|\\bc\\+\\+|\\bc#|\\.net|\\bdotnet|\\bnode(?:\\.?js)?|\\bgolang|\\bgo|\\bruby|\\brails|\\bphp|\\bscala|\\bkotlin|\\bswift|\\brust|\\btypescript|\\breact(?:\\.?js)?|\\bangular|\\bvue(?:\\.?js)?|\\bsalesforce|\\bsap(?:\\s+abap)?|\\babap|\\bmainframe|\\bcobol|\\bservicenow|\\bmulesoft|\\bpega";
const LANG_FRONTEND = "\\breact(?:\\.?js)?|\\bangular|\\bvue(?:\\.?js)?|\\btypescript|\\bjavascript";
const LANG_BACKEND = "\\bjava\\b|\\bnode(?:\\.?js)?|\\bgolang|\\bgo|\\bruby|\\brails|\\bphp|\\bscala|\\brust|\\bc#|\\.net";
const LANG_MOBILE = "\\bswift|\\bkotlin";
const DEV_NOUN = "developer|engineer|programmer";

export const ROLE_CATEGORY_PATTERNS = {
  software_engineer: new RegExp(
    "(?:(?:software|backend|back[\\s-]?end|full[\\s-]?stack|systems|cloud|production|founding)\\s+(?:engineer|develop)" +
    "|\\bSW\\s+(?:engineer|develop)|applications?\\s+(?:software\\s+)?develop" +
    "|\\b(?:MTS|AMTS|SDE|SWE)\\b|member\\s+of\\s+technical\\s+staff" +
    "|\\bprogrammer\\s+analyst\\b|\\bquant(?:itative)?\\s+developer\\b" +
    `|(?:${LANG_ANY})\\s+(?:${DEV_NOUN})\\b)`, "i"),
  data_engineer: /(?:data\s+(?:engineer|platform|infrastructure)|analytics\s+engineer|\bETL\b|data\s+model(?:er|ing)|database\s+(?:engineer|developer|administrator)|\bDBA\b)/i,
  data_analyst: /(?:data\s+analyst|business\s+(?:intelligence\s+)?analyst|\bBI\s+analyst\b|analytics\s+analyst|product\s+analyst)/i,
  data_scientist: /(?:data\s+scientist|applied\s+scientist|research\s+scientist)/i,
  ml_engineer: /(?:machine\s+learning|(?:ML|AI)\s+engineer|deep\s+learning|\bNLP\b|computer\s+vision|\bGenAI\b|generative\s+AI|LLM\s+engineer|prompt\s+engineer|foundation\s+model)/i,
  research_engineer: /(?:\bresearch\s+engineer\b|\b(?:AI|ML)\s+researcher\b|\bmember\s+of\s+research\s+staff\b)/i,
  frontend: new RegExp(`(?:front[\\s-]?end|UI\\s+engineer|web\\s+develop|(?:${LANG_FRONTEND})\\s+(?:${DEV_NOUN})\\b)`, "i"),
  backend: new RegExp(`(?:back[\\s-]?end|server\\s+engineer|API\\s+engineer|(?:${LANG_BACKEND})\\s+(?:${DEV_NOUN})\\b)`, "i"),
  devops_sre: /(?:\bdevops\b|\bSRE\b|site\s+reliability|(?:infrastructure|cloud)\s+engineer)/i,
  mobile: new RegExp(`(?:(?:iOS|Android|mobile)\\s+(?:engineer|develop)|React\\s+Native|Flutter|(?:${LANG_MOBILE})\\s+(?:${DEV_NOUN})\\b)`, "i"),
  security: /(?:(?:security|application\s+security|product\s+security|cyber\s*security|infosec|appsec|offensive\s+security|cloud\s+security)\s+(?:engineer|analyst|architect|develop\w*|researcher|specialist)|\bpenetration\s+tester\b|\bred\s+team\s+(?:engineer|operator)\b|\bSOC\s+analyst\b)/i,
  qa_sdet: /(?:\bSDET\b|\b(?:QA|quality\s+assurance)\s+(?:engineer|analyst|automation|lead)\b|\btest\s+(?:engineer|automation)\b|\bsoftware\s+(?:development\s+)?engineer\s+in\s+test\b|\bautomation\s+(?:test\s+)?engineer\b)/i,
  embedded: /(?:\b(?:embedded|firmware)\s+(?:software\s+)?(?:engineer|developer)\b|\bembedded\s+systems?\s+(?:engineer|developer)\b)/i,
  solutions: /(?:\bsolutions?\s+(?:architect|engineer|consultant)\b|\bsales\s+engineer\b|\bforward\s+deployed\s+(?:software\s+)?engineer\b|\bpre[\s-]?sales\s+engineer\b|\bcustomer\s+engineer\b)/i,
  product_manager: /(?:product\s+manager|product\s+owner|program\s+manager|\bTPM\b|technical\s+program)/i,
  program_manager: /(?:\b(?:technical\s+|engineering\s+)?program\s+manager\b|\bTPM\b)/i,
  // The "Manager, X" comma form excludes project/program/product prefixes so
  // "Project Manager, Infrastructure" stays a PjM, not a people-manager.
  engineering_manager: /(?:\b(?:engineering|software\s+engineering|software\s+development|technology|platform|infrastructure|data\s+engineering|machine\s+learning|ML|security|QA|test)\s+manager\b|(?<!(?:project|program|product)\s)\bmanager\s*,\s*(?:software|engineering|machine\s+learning|data|platform|infrastructure|security)\b|\bdev\s+manager\b)/i,
  project_manager: /(?:\b(?:technical\s+|IT\s+)?project\s+manager\b|\bscrum\s+master\b|\bdelivery\s+manager\b|\bagile\s+coach\b)/i,
  quant: /(?:\bquant(?:itative)?\s+(?:research(?:er)?|analyst|developer|engineer|strategist|trader)\b)/i,
  financial_analyst: /(?:\bfinancial\s+analyst\b|\bfinance\s+(?:analyst|associate|manager|business\s+partner)\b|\bFP&A\b|\bcorporate\s+finance\b|\binvestment\s+banking\s+(?:analyst|associate)\b|\bequity\s+research\s+(?:analyst|associate)\b|\bcredit\s+analyst\b|\btreasury\s+(?:analyst|manager|associate)\b)/i,
  risk: /(?:\b(?:credit|market|operational|enterprise|model|liquidity|counterparty)\s+risk\b|\brisk\s+(?:analyst|manager|management|associate|officer|specialist)\b)/i,
  fpa_accounting: /(?:\baccountant\b|\baccounting\s+(?:analyst|manager|associate|specialist)\b|\bfinancial\s+controller\b|\b(?:internal|financial|tax|IT)\s+audit(?:or)?\b|\baudit\s+(?:analyst|associate|manager)\b|\btax\s+(?:analyst|associate|manager|accountant)\b|\bpayroll\s+(?:analyst|specialist|manager)\b|\baccounts\s+(?:payable|receivable)\b)/i,
};

export const PLATFORM_ENGINEER_PATTERN = /\bplatform\s+engineer/i;

const BROAD_ROLE_PATTERN = new RegExp(
  Object.values(ROLE_CATEGORY_PATTERNS).map((r) => r.source).join("|"),
  "i"
);

// Centralized title filter: the collection gate. Derived from the category
// map (never hand-edited) so a title can never enter the pipeline without
// classifying into at least one category.
export function isTargetRole(title) {
  if (!title) return false;
  const t = title.trim();
  return BROAD_ROLE_PATTERN.test(t) || PLATFORM_ENGINEER_PATTERN.test(t);
}

export function detectRoleCategories(title) {
  if (!title) return [];
  const t = title.trim();
  const categories = [];
  for (const [category, pattern] of Object.entries(ROLE_CATEGORY_PATTERNS)) {
    if (pattern.test(t)) {
      categories.push(category);
    }
  }
  if (PLATFORM_ENGINEER_PATTERN.test(t) && !categories.includes("software_engineer")) {
    categories.push("software_engineer");
  }
  return categories;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections (UI grouping; categories stay the granular filter unit)
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_SECTIONS = {
  software_engineering: {
    label: "Software Engineering",
    categories: [
      { value: "software_engineer", label: "Software Engineer" },
      { value: "frontend", label: "Frontend" },
      { value: "backend", label: "Backend" },
      { value: "mobile", label: "Mobile" },
      { value: "devops_sre", label: "DevOps / SRE" },
      { value: "security", label: "Security" },
      { value: "qa_sdet", label: "QA / SDET" },
      { value: "embedded", label: "Embedded / Firmware" },
      { value: "solutions", label: "Solutions Architect / Engineer" },
    ],
  },
  data_ai: {
    label: "Data Science & AI",
    categories: [
      { value: "data_scientist", label: "Data Scientist" },
      { value: "data_analyst", label: "Data Analyst" },
      { value: "data_engineer", label: "Data Engineer / Modeling" },
      { value: "ml_engineer", label: "ML / AI Engineer" },
      { value: "research_engineer", label: "Research Engineer" },
    ],
  },
  management: {
    label: "Management",
    categories: [
      { value: "product_manager", label: "Product Manager" },
      { value: "program_manager", label: "Program Manager / TPM" },
      { value: "engineering_manager", label: "Engineering Manager" },
      { value: "project_manager", label: "Project Manager / Scrum" },
    ],
  },
  finance: {
    label: "Finance",
    categories: [
      { value: "quant", label: "Quantitative Research / Dev" },
      { value: "financial_analyst", label: "Financial Analyst / IB" },
      { value: "risk", label: "Risk" },
      { value: "fpa_accounting", label: "Accounting / FP&A / Audit" },
    ],
  },
};

export function sectionForCategory(category) {
  for (const [key, section] of Object.entries(ROLE_SECTIONS)) {
    if (section.categories.some((c) => c.value === category)) return key;
  }
  return null;
}

// Priority order: most specific archetype wins
export const ARCHETYPE_PRIORITY = [
  ["data_scientist", "DS"],
  ["data_analyst", "DA"],
  ["ml_engineer", "ML/AI"],
  ["research_engineer", "Research"],
  ["data_engineer", "Data"],
  ["security", "Security"],
  ["qa_sdet", "QA"],
  ["embedded", "Embedded"],
  ["mobile", "Mobile"],
  ["devops_sre", "DevOps"],
  ["frontend", "Frontend"],
  ["backend", "Backend"],
  ["solutions", "Solutions"],
  ["engineering_manager", "EM"],
  ["program_manager", "TPM"],
  ["project_manager", "PjM"],
  ["product_manager", "PM"],
  ["quant", "Quant"],
  ["risk", "Risk"],
  ["financial_analyst", "Finance"],
  ["fpa_accounting", "Accounting"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Level rules engine
// ─────────────────────────────────────────────────────────────────────────────
// Reference: levels.fyi standard levels. Rung equivalences:
//   entry     ~ SDE I  / Google L3 / Meta E3 / MSFT 59-60 / bank Analyst
//   mid       ~ SDE II / Google L4 / Meta E4 / MSFT 61-62 / bank Associate
//   senior    ~ SDE III / Google L5 / Meta E5 / MSFT 63-64 / bank VP (IC)
//   staff     ~ Principal / L6+ / E6 / bank ED band (ED itself is blocked
//               by the generic director rule)

export const LEVEL_EQUIVALENCE = {
  intern: "internship",
  entry: "entry, SDE 1 / L3 equivalent",
  entry_mid: "entry to mid, SDE 1-2",
  mid: "mid, SDE 2 / L4 equivalent",
  senior: "senior, SDE 3 / L5 equivalent",
  staff: "Staff+, L6+ equivalent",
};

// Corporate-band titles at banks (Analyst -> Associate -> VP IC track shared
// by GS / MS / JPM / Citi). Order matters: more specific bands first.
const BANK_LEVEL_RULES = [
  { re: /\bsummer\s+(?:analyst|associate)\b/i, level: "intern", marker: "Summer Analyst" },
  { re: /\bsenior\s+associate\b/i, level: "mid", marker: "Senior Associate" },
  { re: /\bAVP\b|\bassistant\s+vice\s+president\b/i, level: "mid", marker: "AVP" },
  { re: /\bvice\s+president\b|\bVP\b/, level: "senior", marker: "VP" },
  { re: /\bassociate\b/i, level: "mid", marker: "Associate" },
  { re: /\banalyst\b/i, level: "entry_mid", marker: "Analyst" },
];

// Per-company overrides for numeral conventions that differ from the generic
// mapping below (keyed by sourceKey).
const COMPANY_LEVEL_RULES = {
  google: [
    { re: /\b(?:engineer|developer)\s+III\b/i, level: "mid", marker: "SWE III (Google L4)" },
    { re: /\b(?:engineer|developer)\s+II\b(?!I)/i, level: "entry", marker: "SWE II (Google L3)" },
  ],
  // JPMorgan dual-titles: SWE I/II/III sit in the Analyst/Associate/Sr
  // Associate bands (501/601/602); Lead (603) is the VP band.
  jpmorgan: [
    { re: /\b(?:engineer|developer)\s+III\b/i, level: "mid", marker: "SWE III (JPMC 602 band)" },
    { re: /\b(?:engineer|developer)\s+II\b(?!I)/i, level: "mid", marker: "SWE II (JPMC 601 band)" },
    { re: /\b(?:engineer|developer)\s+I\b(?!I)/i, level: "entry", marker: "SWE I (JPMC analyst band)" },
  ],
};

// Generic numeral conventions (role noun required so stray numerals in team
// names don't level a job).
const LEVEL_NOUN = "engineer|developer|analyst|scientist|architect|programmer|manager|consultant";
const GENERIC_LEVEL_RULES = [
  { re: new RegExp(`\\b(?:${LEVEL_NOUN})\\s+IV\\b|\\b(?:SWE|SDE)\\s*IV\\b`, "i"), level: "staff", marker: "Level IV" },
  { re: new RegExp(`\\b(?:${LEVEL_NOUN})\\s+(?:III|3)\\b|\\b(?:SWE|SDE)\\s*(?:III|3)\\b`, "i"), level: "senior", marker: "Level III" },
  { re: new RegExp(`\\b(?:${LEVEL_NOUN})\\s+(?:II|2)\\b(?!I)|\\b(?:SWE|SDE)\\s*(?:II|2)\\b(?!I)`, "i"), level: "mid", marker: "Level II" },
  { re: new RegExp(`\\b(?:${LEVEL_NOUN})\\s+(?:I|1)\\b(?!I)|\\b(?:SWE|SDE)\\s*(?:I|1)\\b(?!I)`, "i"), level: "entry_mid", marker: "Level I" },
];

/**
 * Company-aware level resolution. Returns { level, marker } when an explicit
 * convention matched (bank band, company numeral override, generic numeral),
 * else null. detectSeniority() consumes the level; embeds display the marker.
 *
 * opts.companyRules / opts.generic let detectSeniority stage the passes
 * (bands before the senior keyword, numerals after it).
 */
export function resolveLevel(title, sourceKey = "", { companyRules = true, generic = true } = {}) {
  if (!title) return null;
  const t = String(title).trim();
  if (!t) return null;

  if (companyRules) {
    if (sourceKey && BANKING_COMPANIES.has(sourceKey)) {
      for (const rule of BANK_LEVEL_RULES) {
        if (rule.re.test(t)) return { level: rule.level, marker: rule.marker };
      }
    }
    for (const rule of COMPANY_LEVEL_RULES[sourceKey] ?? []) {
      if (rule.re.test(t)) return { level: rule.level, marker: rule.marker };
    }
  }
  if (generic) {
    for (const rule of GENERIC_LEVEL_RULES) {
      if (rule.re.test(t)) return { level: rule.level, marker: rule.marker };
    }
  }
  return null;
}

/**
 * Title-level classifier. Rungs: intern, entry, entry_mid, mid (default),
 * senior, staff, director (always blocked downstream).
 *
 * Ordering rationale:
 * - Bank/company band rules run BEFORE the generic keyword rules so
 *   "Senior Associate" at a bank resolves to its band (mid) instead of
 *   tripping the "senior" keyword.
 * - Generic numeral rules run AFTER the keyword rules so "Senior Product
 *   Manager II" stays senior.
 * - The old blanket "manager -> senior" is gone: people-manager titles
 *   (engineering_manager pattern) are senior, while the product/program/
 *   project ladder levels from its own modifiers, so entry/mid PM users
 *   actually receive plain PM roles.
 */
export function detectSeniority(title, sourceKey = "") {
  if (!title) return "mid";
  const t = title.trim();
  if (!t) return "mid";

  // Director / Chief / MD: always blocked (also catches the banks'
  // Executive Director band via \bdirector\b).
  if (/\b(director|chief)\b/i.test(t)) return "director";
  if (/\bMD\b/.test(t)) return "director";

  // Staff / Principal (check before senior: most specific). "Staff
  // Accountant" / "Staff Auditor" are entry-band finance titles, not the
  // engineering Staff+ rung.
  if (/\b((?<!technical\s)staff(?!\s+account|\s+audit)|princ\w*|distinguished|fellow)\b/i.test(t)) return "staff";
  if (/\barchitect\b/i.test(t) && !/\bsolution/i.test(t)) return "staff";
  if (/\bSVP\b/.test(t)) return "staff";

  // Intern (incl. bank summer programs)
  if (/\b(intern|internship|co[\s-]?op)\b/i.test(t)) return "intern";
  if (/\bsummer\s+(?:analyst|associate)\b/i.test(t)) return "intern";

  // Bank corporate bands + per-company numeral overrides.
  const ruled = resolveLevel(t, sourceKey, { generic: false });
  if (ruled) return ruled.level;

  // Senior keywords
  if (/\b(senior|sr\.?)\b/i.test(t)) return "senior";
  if (/\blead\w*\b/i.test(t)) return "senior";
  if (/\bvice\s+president\b|\bVP\b/i.test(t)) return "senior";
  if (/\bAVP\b/.test(t)) return "senior";

  // Management ladders
  if (ROLE_CATEGORY_PATTERNS.engineering_manager.test(t)) return "senior";
  if (/\b(?:associate|assistant)\s+product\s+manager\b/i.test(t) || /\bAPM\b/.test(t)) return "entry";
  if (/\bgroup\s+product\s+manager\b/i.test(t) || /\bGPM\b/.test(t)) return "staff";
  if (/\b(?:product|program|project)\s+manager\b|\bproduct\s+owner\b|\bscrum\s+master\b|\bTPM\b/i.test(t)) return "mid";

  // Generic numeral conventions (SDE II, Engineer III, ...)
  const numeral = resolveLevel(t, sourceKey, { generic: true, companyRules: false });
  if (numeral) return numeral.level;

  // Entry markers
  if (/\b(new\s+grad|university\s+grad\w*|college\s+grad\w*|campus\s+hire|graduate\s+(?:software\s+)?(?:engineer|developer|analyst)|early[\s-]?career|early\s+in\s+career|entry[\s-]?level|junior|jr\.?)\b/i.test(t)) return "entry";
  if (/\bmid[\s-]?career\b/i.test(t)) return "mid";

  // Plain Software Engineer / Software Development Engineer / Software
  // Engineering titles without explicit level markers -> entry_mid so
  // entry-only users also match. I / 1 is handled by the numeral rules.
  if (/\b(software\s+(?:development\s+)?engineer|software\s+engineering)\b/i.test(t)
      && !/\b(?:II|III)\b/.test(t)
      && !/\bengineer\s+[23]\b/i.test(t)) {
    return "entry_mid";
  }

  return "mid";
}

export function detectArchetype(title) {
  if (!title) return null;
  const categories = detectRoleCategories(title);
  if (categories.length === 0) return null;

  if (PLATFORM_ENGINEER_PATTERN.test(title.trim())) return "Platform";

  for (const [cat, label] of ARCHETYPE_PRIORITY) {
    if (categories.includes(cat)) return label;
  }

  // Fallback: generic software_engineer -> "Fullstack"
  if (categories.includes("software_engineer")) return "Fullstack";
  return null;
}

/**
 * One-line level hint for job embeds, e.g.
 * "Level: Associate (~ mid, SDE 2 / L4 equivalent)".
 * Returns null unless an explicit convention matched AND agrees with the
 * seniority classifier (no guessing, no contradictory hints: "Senior
 * Product Manager II" shows nothing rather than claiming mid).
 */
export function formatLevelLine(title, sourceKey = "") {
  const info = resolveLevel(title, sourceKey);
  if (!info) return null;
  if (detectSeniority(title, sourceKey) !== info.level) return null;
  const equiv = LEVEL_EQUIVALENCE[info.level];
  if (!equiv) return null;
  return `Level: ${info.marker} (≈ ${equiv})`;
}
