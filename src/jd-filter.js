/**
 * Keyword-based pre-filter for job descriptions.
 * Checks for red flags: no sponsorship, clearance required, excessive experience.
 * Returns an array of warning strings (empty = no issues found).
 */

const NO_SPONSORSHIP_PATTERNS = [
  /\bno\s+(?:visa\s+)?sponsorship\b/i,
  /\bnot\s+(?:able\s+to\s+)?sponsor/i,
  /\bunable\s+to\s+sponsor/i,
  /\bwithout\s+(?:visa\s+)?sponsorship\b(?!\s+for\s+an?\s+export)/i,
  /\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?(?:visa\s+|employment\s+visa\s+)?sponsor/i,
  /\bdo(?:es)?\s+not\s+(?:offer\s+|provide\s+)?(?:employment\s+)?visa\s+sponsorship/i,
  /\bwill\s+not\s+(?:be\s+)?sponsor/i,
  /\bwon'?t\s+sponsor/i,
  /\bcannot\s+sponsor/i,
  /\bcan(?:'t| ?not)\s+sponsor/i,
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

  for (const pattern of NO_SPONSORSHIP_PATTERNS) {
    const match = description.match(pattern);
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
      const prefix = description.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
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
