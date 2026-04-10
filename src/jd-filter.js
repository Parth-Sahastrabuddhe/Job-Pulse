/**
 * Keyword-based pre-filter for job descriptions.
 * Checks for red flags: no sponsorship, clearance required, excessive experience.
 * Returns an array of warning strings (empty = no issues found).
 */

const NO_SPONSORSHIP_PATTERNS = [
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bnot\s+(?:able\s+to\s+)?(?:(?:provide|offer)\s+(?:(?:visa|immigration|employment)\s+)?)?sponsor/i,
  /\bunable\s+to\s+(?:(?:provide|offer)\s+(?:(?:visa|immigration|employment)\s+)?)?sponsor/i,
  /\bwithout\s+(?:visa\s+)?sponsorship\b(?!\s+for\s+an?\s+export)/i,
  /\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?(?:visa\s+|employment\s+visa\s+)?sponsor/i,
  /\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?(?:employment\s+)?visa\s+sponsorship/i,
  /\bwill\s+not\s+(?:be\s+)?sponsor/i,
  /\bwon'?t\s+sponsor/i,
  /\bcannot\s+(?:(?:provide|offer)\s+(?:(?:visa|immigration|employment)\s+)?)?sponsor/i,
  /\bcan(?:'t| ?not)\s+(?:(?:provide|offer)\s+(?:(?:visa|immigration|employment)\s+)?)?sponsor/i,
  /\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided)/i,
  /\bno\s+immigration\s+sponsorship/i,
  /\bmust\s+be\s+(?:a\s+)?(?:US|U\.S\.)?\s*citizen/i,
  /\bmust\s+(?:already\s+)?(?:be|have)\s+(?:legally\s+)?authorized\s+to\s+work/i,
  /\brequire[sd]?\s+(?:to\s+be\s+)?(?:legally\s+)?authorized\s+to\s+work/i,
  /\bpermanent\s+resident\s+(?:status\s+)?required/i,
  /\bgreen\s+card\s+(?:holder\s+)?required/i,
  /\bUS\s+(?:work\s+)?authorization\s+required/i,
  /\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?visa\s+(?:support|assistance)/i,
  /\bno\s+visa\s+(?:support|assistance)\b/i,
  /\bvisa\s+(?:support|assistance)\s+(?:is\s+)?not\s+(?:available|offered|provided)/i,
  /\bnot\s+(?:offer|provide)\s+(?:any\s+)?(?:immigration|visa)\s+(?:support|assistance|sponsorship)/i,
  /\bonly\s+(?:US|U\.S\.)\s+citizens?\b/i,
  /\bUS\s+citizen(?:s|ship)?\s+(?:only|required)\b/i,
  /\b(?:US|U\.S\.)\s+person(?:s)?\b(?:\s+only)?\b/i,
  /\brequire[sd]?\s+(?:that\s+)?(?:the\s+)?(?:candidate|applicant)s?\s+(?:\w+\s+)*?be\s+(?:a\s+)?(?:US|U\.S\.)\s+citizen/i,
  /\bmust\s+(?:currently\s+)?(?:hold|have|possess)\s+(?:valid\s+)?(?:US|U\.S\.)\s+(?:work\s+)?authorization/i,
  /\bwithout\s+(?:the\s+)?(?:need\s+for|requiring)\s+(?:visa\s+)?sponsorship/i,
  /\bwork\s+authorization\s+(?:that\s+)?does\s+not\s+(?:now\s+or\s+in\s+the\s+future\s+)?require\s+sponsorship/i,
  /\bnow\s+or\s+in\s+the\s+future\s+require\s+sponsorship/i,
  /\bmay\s+not\s+be\s+able\s+to\s+(?:employ|hire)\s+candidates\s+(?:who\s+have\s+)?(?:.*?\s+)?(?:visa|work\s+authorization)/i,
  /\bnot\s+(?:able\s+to\s+)?(?:employ|hire)\s+(?:candidates|individuals|applicants)\s+(?:.*?\s+)?(?:visa\s+categor|work\s+authorization)/i,
  /\bnot\s+eligible\s+for\s+(?:(?:visa|employment|immigration|work)\s+)*sponsorship/i,
  /\bwill\s+not\s+(?:be\s+)?(?:(?:provide|offer)\w*\s+)?(?:(?:visa|immigration|employment)\s+)?sponsor/i,
];

const CLEARANCE_PATTERNS = [
  /(?<!\bno\s+)(?<!\bnot\s+)\bsecurity\s+clearance\s+(?:is\s+)?required/i,
  /\brequire[sd]?\s+(?:a\s+)?(?:active\s+)?(?:TS|top\s+secret|secret|SCI|TS\/SCI)\s*(?:clearance|security)/i,
  /\b(?:TS|top\s+secret|secret|SCI|TS\/SCI)\s+clearance\s+(?:is\s+)?required/i,
  /\bmust\s+(?:hold|have|possess|maintain)\s+(?:an?\s+)?(?:active\s+)?(?:TS|top\s+secret|secret|SCI|TS\/SCI)/i,
  /\bactive\s+(?:TS|top\s+secret|secret|SCI|TS\/SCI)\s+clearance/i,
  /\beligible\s+(?:for|to\s+obtain)\s+(?:a\s+)?security\s+clearance/i,
  /\bgovernment\s+clearance/i,
  /\bDOD\s+(?:security\s+)?clearance/i,
  /\b(?:ability|able)\s+to\s+(?:obtain|get|acquire|receive)\s+(?:and\s+maintain\s+)?(?:a\s+)?(?:(?:U\.?S\.?\s+)?(?:government\s+)?)?(?:security\s+)?clearance/i,
  /\bmust\s+(?:be\s+)?(?:able\s+to\s+)?(?:obtain|get|acquire)\s+(?:a\s+)?(?:security\s+)?clearance/i,
  /(?<!\bno\s+)(?<!\bnot\s+)\bclearance\s+(?:is\s+)?(?:required|mandatory|necessary)\b/i,
  /(?<!\bno\s+)(?<!\bnot\s+)(?<!\bdoes\s+not\s+)\brequire[sd]?\s+(?:a\s+|an\s+)?(?:active\s+)?(?:(?:TS|top\s+secret|secret|SCI|TS\/SCI)\s+)?(?:security\s+)?clearance/i,
];

const EXPERIENCE_PATTERNS = [
  /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:(?:relevant|professional|industry|hands-on|software|engineering|development|work|related|direct|proven|progressive|practical)\s+)*experience/gi,
  /(?:minimum|min|at\s+least)\s+(?:of\s+)?(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:\w+\s+)*?experience/gi,
  /\((\d+)\+?\s*(?:years?|yrs?)\)\s+(?:of\s+)?(?:\w+\s+)*?experience/gi,
  /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:\w+\s+)*?(?:exp\b|experience)/gi,
];

export function checkJobDescription(description) {
  const warnings = [];

  if (!description) return warnings;

  // Normalize common misspellings of "sponsor" so patterns match
  const normalized = description.replace(/\bsponser/gi, "sponsor").replace(/\bsponsership/gi, "sponsorship");

  for (const pattern of NO_SPONSORSHIP_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      warnings.push({ text: `No sponsorship: "${match[0].trim()}"`, severity: "hard" });
      break;
    }
  }

  // Use a negation-aware approach: search with exec() to get index, then check prefix
  for (const pattern of CLEARANCE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    re.lastIndex = 0;
    let match;
    let found = false;
    while ((match = re.exec(description)) !== null) {
      const prefix = description.slice(Math.max(0, match.index - 80), match.index).toLowerCase();
      if (/\b(no|not|don'?t|doesn'?t|without|neither)\b/.test(prefix)) {
        continue;
      }
      warnings.push({ text: `Clearance required: "${match[0].trim()}"`, severity: "hard" });
      found = true;
      break;
    }
    if (found) break;
  }

  // Find the highest experience requirement mentioned
  let maxYears = 0;
  let maxMatch = "";
  for (const pattern of EXPERIENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const years = parseInt(match[1], 10);
      if (years > maxYears) {
        maxYears = years;
        maxMatch = match[0].trim();
      }
    }
  }
  if (maxYears >= 5) {
    warnings.push({ text: `${maxYears}+ years required: "${maxMatch}"`, severity: "soft" });
  }

  return warnings;
}

// --- Education-aware experience tier extraction -----------------------------
//
// Parses education-tiered experience requirements from job descriptions, e.g.
// "Bachelor's + 5 years OR Master's + 3 years". Returns structured tiers so
// the mu bot can pick the one matching each user's education level.

const DEGREE_ALT = "(?:bachelor'?s?|b\\.?\\s?[sa]\\b|master'?s?|m\\.?\\s?[sa]\\b|mba|ph\\.?\\s*d\\.?|doctorate|doctoral)";

// Patterns where capture group 1 = degree, capture group 2 = years
const DEGREE_THEN_YEARS_PATTERNS = [
  // "Bachelor's + 5 years", "BS + 5 years", "MS+3 years", "Master's degree + 5 years"
  new RegExp(`(${DEGREE_ALT})(?:\\s+degree)?\\s*\\+\\s*(\\d+)\\+?\\s*(?:years?|yrs?)`, "gi"),
  // "Bachelor's and 5+ years", "BS degree and 5 years", "Master's with 3 years"
  new RegExp(`(${DEGREE_ALT})(?:\\s+degree)?\\s+(?:and|with)\\s+(\\d+)\\+?\\s*(?:years?|yrs?)`, "gi"),
  // "Bachelor's degree (5+ years)", "MS (3 years)"
  new RegExp(`(${DEGREE_ALT})(?:\\s+degree)?\\s*\\(\\s*(\\d+)\\+?\\s*(?:years?|yrs?)`, "gi"),
  // "BS/5 years", "MS / 3 years", "Master's degree / 3 years"
  new RegExp(`(${DEGREE_ALT})(?:\\s+degree)?\\s*\\/\\s*(\\d+)\\+?\\s*(?:years?|yrs?)`, "gi"),
  // "Bachelor's degree in Computer Science and 5+ years" (up to 40 chars between)
  new RegExp(`(${DEGREE_ALT})(?:\\s+degree)?\\s+in\\s+[\\w\\s,]{1,40}?(?:and|with|,)\\s+(\\d+)\\+?\\s*(?:years?|yrs?)`, "gi"),
];

// Patterns where capture group 1 = years, capture group 2 = degree
const YEARS_THEN_DEGREE_PATTERNS = [
  // "5 years with a Bachelor's", "3+ years with an MS degree"
  new RegExp(`(\\d+)\\+?\\s*(?:years?|yrs?)(?:\\s+(?:of\\s+)?(?:relevant\\s+|professional\\s+|work\\s+)?experience)?\\s+with\\s+(?:an?\\s+)?(${DEGREE_ALT})`, "gi"),
  // "5 years + Bachelor's"
  new RegExp(`(\\d+)\\+?\\s*(?:years?|yrs?)\\s*\\+\\s*(${DEGREE_ALT})`, "gi"),
];

function normalizeEducation(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/\./g, "").replace(/'/g, "").replace(/\s+/g, " ").trim();
  // Strip trailing 's' (bachelors → bachelor)
  if (/^bachelor/.test(lower)) return "bachelors";
  if (/^master/.test(lower) || /^mba$/.test(lower)) return "masters";
  if (/^ph\s*d$/.test(lower) || /^doctorate$/.test(lower) || /^doctoral$/.test(lower)) return "phd";
  // Single-letter abbreviations
  if (/^b\s?[sa]$/.test(lower)) return "bachelors";
  if (/^m\s?[sa]$/.test(lower)) return "masters";
  return null;
}

export function extractExperienceTiers(description) {
  if (!description) return { tiers: [], fallbackMax: 0 };

  try {
    // Map: education → min years across duplicates (most lenient for user)
    const tierMap = new Map();
    // Track max years seen across ALL tier matches (for fallbackMax, most conservative)
    let maxTierYears = 0;

    const recordTier = (edu, years) => {
      if (!edu || !Number.isFinite(years)) return;
      if (years > maxTierYears) maxTierYears = years;
      if (!tierMap.has(edu) || tierMap.get(edu) > years) {
        tierMap.set(edu, years);
      }
    };

    for (const pattern of DEGREE_THEN_YEARS_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(description)) !== null) {
        recordTier(normalizeEducation(m[1]), parseInt(m[2], 10));
      }
    }

    for (const pattern of YEARS_THEN_DEGREE_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(description)) !== null) {
        recordTier(normalizeEducation(m[2]), parseInt(m[1], 10));
      }
    }

    // Compute fallbackMax: max of generic EXPERIENCE_PATTERNS AND any parsed tier years.
    // Tier years need to be considered because the generic patterns require the keyword
    // "experience" which may not appear next to years inside parenthesized or tiered clauses.
    let maxYears = 0;
    for (const pattern of EXPERIENCE_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(description)) !== null) {
        const years = parseInt(m[1], 10);
        if (Number.isFinite(years) && years > maxYears) maxYears = years;
      }
    }
    if (maxTierYears > maxYears) maxYears = maxTierYears;

    const tiers = Array.from(tierMap.entries()).map(([education, years]) => ({ education, years }));
    return { tiers, fallbackMax: maxYears };
  } catch {
    return { tiers: [], fallbackMax: 0 };
  }
}

// Education rank: higher rank = more advanced degree.
// A user with a higher rank qualifies for all tiers at or below their rank.
const EDUCATION_RANK = { bachelors: 1, masters: 2, phd: 3 };

/**
 * Pick the experience year requirement that applies to a given user.
 *
 * Rule: find all tiers the user qualifies for (user rank >= tier rank), then
 * return the tier with the HIGHEST rank (which typically has the fewest years).
 * If no tiers match, fall back to the generic max years from the description.
 *
 * @param {Array<{education: string, years: number}>} tiers
 * @param {number} fallbackMax
 * @param {string} userEducation  "bachelors" | "masters" | "phd" | ""
 * @returns {number}
 */
export function pickTierYearsForUser(tiers, fallbackMax, userEducation) {
  if (!userEducation || !Array.isArray(tiers) || tiers.length === 0) {
    return fallbackMax;
  }

  const userRank = EDUCATION_RANK[userEducation] || 0;
  if (userRank === 0) return fallbackMax;

  const eligible = tiers
    .filter((t) => EDUCATION_RANK[t.education] && EDUCATION_RANK[t.education] <= userRank)
    .sort((a, b) => EDUCATION_RANK[b.education] - EDUCATION_RANK[a.education]);

  return eligible.length > 0 ? eligible[0].years : fallbackMax;
}
