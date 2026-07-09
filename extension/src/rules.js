/* JobPulse LinkedIn Scout: ALL classification data lives here.
 * Tune by editing lists; pin every tune with a fixture in tests/fixtures.json first.
 * Regexes run on NORMALIZED text (lowercase, '#' stripped, curly quotes straightened,
 * whitespace collapsed) EXCEPT usMarkerRe, which runs on the ORIGINAL text because
 * case distinguishes "US" from the pronoun "us". Dash variants (hyphen, en dash,
 * em dash) are matched via the \u2013 and \u2014 escapes in DASH.
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});
  const DASH = "[-\\u2013\\u2014]";
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameList = (names) => new RegExp("\\b(?:" + names.map(esc).join("|") + ")\\b", "i");
  // Firm lists must not fire on credentials like "ex-Accenture" / "former TCS".
  const firmList = (names) =>
    new RegExp("(?<!ex[-\\s])(?<!former\\s)(?<!formerly\\s)\\b(?:" + names.map(esc).join("|") + ")\\b", "i");
  // Allowlist companies count only in an employment position: "at X", "@X", "| X".
  // This blocks "Ex-Google Recruiter" and generic-word hits ("chase your dream").
  const atCompanyList = (names) =>
    new RegExp("(?:\\bat\\s+|@\\s*|\\|\\s*)(?:" + names.map(esc).join("|") + ")\\b", "i");

  const junkRules = [
    { id: "c2c", label: "C2C", re: new RegExp("\\bc2c\\b|\\bcorp\\s*" + DASH + "?\\s*to\\s*" + DASH + "?\\s*corp\\b", "i") },
    { id: "w2", label: "W2 staffing term", re: /\bw-?2\b/i },
    { id: "1099", label: "1099", re: /\b1099\b/i },
    { id: "c2h", label: "contract-to-hire", re: new RegExp("\\bc2h\\b|\\bcontract\\s*" + DASH + "?\\s*to\\s*" + DASH + "?\\s*hire\\b", "i") },
    { id: "contract", label: "contract role", re: /\b(?:\d{1,2}|six|twelve)\s*(?:\+\s*)?months?\s+contract\b|\bcontract\s+(?:role|position|opportunity|opening|job|basis|only|assignment)\b|\bon\s+contract\b(?!\s+terms?)|\blong[-\s]term\s+contract\b/i },
    { id: "rate", label: "hourly rate", re: /\b(?:bill|pay|hourly)\s+rate\b|\$\s?\d{2,3}\s*(?:\/|per\s+)h(?:ou)?r\b/i },
    { id: "duration", label: "duration block", re: /\bduration\s*:\s*\d/i },
    { id: "tax-terms", label: "tax terms", re: /\btax\s+terms?\b/i },
    { id: "client", label: "staffing client-speak", re: /\b(?:our|my|direct)\s+client\b|\bclient\s+location\b/i },
    { id: "vendor", label: "vendor-speak", re: /\bprime\s+vendor\b|\bimplementation\s+partner\b|\bstaffing\s+(?:firm|agency|partner)\b/i },
    { id: "bench", label: "bench/hotlist", re: /\bbench\s+(?:sales|candidates?|list|strength)\b|\bhotlist\b|\bavailable\s+consultants\b/i },
    { id: "joiners", label: "immediate joiners", re: /\bimmediate\s+joiners?\b/i },
    { id: "share-resume", label: "share-resume-speak", re: /\b(?:share|send|submit)\s+(?:your\s+|me\s+)?(?:resume|cv|profile)s?\s+(?:at|to)\b/i },
    { id: "no-sponsor", label: "no sponsorship", re: /\bno\s+(?:visa\s+|h-?1b\s+)?sponsorship\b|\bsponsorship\s+(?:is\s+)?(?:not|un)avail|\b(?:cannot|can't|unable\s+to|won't|will\s+not|not\s+able\s+to)\s+(?:currently\s+)?(?:provide\s+|offer\s+)?sponsor|\bwithout\s+(?:visa\s+)?sponsorship\b/i },
    { id: "citizen-only", label: "USC/GC only", re: /\b(?:usc|us\s+citizens?|gc|green\s*card(?:\s+holders?)?)(?:[\s\/,]+(?:or\s+|and\s+)?(?:usc|us\s+citizens?|gc|green\s*card(?:\s+holders?)?))*\s+only\b|\bmust\s+be\s+(?:a\s+)?(?:us\s+citizen|permanent\s+resident|green\s*card\s+holder)\b|\bcitizenship\s+required\b/i },
    { id: "clearance", label: "clearance required", re: /\b(?:security\s+clearance|ts\/?sci|top\s*secret)\b[^.]{0,30}\b(?:required|must|needed)\b|\b(?:active|current)\s+(?:secret|top\s*secret|ts\/?sci)\b|\bmust\s+(?:hold|have|possess)\b[^.]{0,30}\bclearance\b|\bclearance\s+required\b|\b(?:secret|ts)\s+clearance\b[^.]{0,20}\b(?:required|needed)\b|\bpolygraph\b/i },
    { id: "staffing-headline", label: "staffing recruiter", scope: "headline", re: /\bbench\s+sales\b|\bus\s+it\s+(?:recruiter|staffing|hiring)\b/i }
  ];

  // Bodyshop / staffing agencies: hard junk, label "staffing firm".
  const staffingFirms = [
    "teksystems", "insight global", "apex systems", "kforce", "robert half",
    "cybercoders", "jobot", "motion recruitment", "collabera", "mastech",
    "diverse lynx", "randstad", "adecco", "aerotek", "actalent", "brooksource",
    "judge group", "mindlance", "artech", "pyramid consulting", "compunnel",
    "spectraforce", "akraya", "intelliswift", "genesis10", "softworld",
    "cynet systems", "eteam", "stellent it", "tanisha systems", "infovision",
    "htc global", "tekwissen", "lorven technologies"
  ];
  // Big consultancies: junk per the non-IT-consulting requirement, but with a
  // DISTINCT label so the sponsorship-insurance play (e.g. Capgemini) stays
  // findable in dimmed posts. Hexaware/EXL stay listed even though the bot
  // tracks their direct postings; their LinkedIn recruiter posts are bulk noise.
  const consultingFirms = [
    "infosys", "tata consultancy", "tcs", "wipro", "cognizant", "accenture",
    "capgemini", "hcl", "tech mahindra", "ltimindtree", "mindtree", "mphasis",
    "hexaware", "exl", "virtusa", "zensar", "persistent systems", "birlasoft",
    "dxc", "ust global", "epam", "globallogic", "luxoft"
  ];
  // Product/target companies: a recruiter/TA headline at one of these is a
  // GENUINE signal (in-house recruiter). Seeded from the bot's tracked list.
  const allowCompanies = [
    "amazon", "google", "meta", "microsoft", "apple", "bloomberg", "citi",
    "goldman sachs", "intuit", "uber", "oracle", "jpmorgan", "jp morgan",
    "chase", "ford", "mercedes-benz", "confluent", "dynatrace", "netflix",
    "stripe", "datadog", "airbnb", "salesforce", "adobe", "nvidia", "linkedin",
    "snowflake", "databricks", "walmart", "target", "best buy", "capital one",
    "american express", "paypal", "block", "doordash", "instacart", "pinterest",
    "snap", "coinbase", "atlassian", "cloudflare", "mongodb", "elastic",
    "spotify", "expedia", "zillow", "wayfair", "etsy", "ebay", "intel", "amd",
    "qualcomm", "cisco", "broadcom", "servicenow", "workday", "okta",
    "crowdstrike", "twilio", "hubspot", "zoom", "dropbox", "asana", "notion",
    "figma", "plaid", "affirm", "gitlab", "github", "hashicorp", "digitalocean",
    "palantir", "tesla", "rivian", "general motors"
  ];

  // Strong non-US markers only. A post with NO location signal is never junked
  // for location; a US marker (usMarkerRe, original text) or an allowed-region
  // marker (allowedPlaces: Canada is a target region per Parth) vetoes the junk.
  const nonUsPlaces = [
    "india", "bengaluru", "bangalore", "hyderabad", "pune", "chennai", "noida",
    "gurgaon", "gurugram", "mumbai", "new delhi", "kolkata", "ahmedabad",
    "kochi", "coimbatore", "jaipur", "indore", "united kingdom", "london",
    "dublin", "ireland", "europe", "emea", "singapore", "dubai", "uae", "latam",
    "brazil", "philippines", "manila", "vietnam", "poland", "romania", "ukraine",
    "germany", "berlin", "netherlands", "amsterdam", "australia", "sydney",
    "melbourne", "japan", "tokyo"
  ];
  const allowedPlaces = [
    "canada", "toronto", "vancouver", "montreal", "ottawa", "calgary",
    "mississauga", "waterloo"
  ];

  JP.rules = {
    junkRules,
    staffingRe: firmList(staffingFirms),
    consultingRe: firmList(consultingFirms),
    nonUsRe: nameList(nonUsPlaces),
    // Case-sensitive; runs on ORIGINAL text. Matches U.S. / USA / United States
    // and ", TX"-style state abbreviations (all 50 + DC).
    usMarkerRe: /\bU\.?S\.?A?\.?\b|\bUnited States\b|,\s*(?:A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY])\b/,
    // First-person job-seeker language only. The role-noun must follow "looking
    // for" within a couple of filler words ("a new role", "opportunities"), so an
    // EM "looking for a senior engineer to fill this role" is NOT a seeker. The
    // bare "seeking ..." branch is blocked when preceded by we-forms, so employer
    // "We are (actively) seeking engineers for multiple roles" is NOT a seeker.
    seekerRe: /\b(?:i\s*'?m|i\s+am)\s+(?:actively\s+)?(?:looking|searching)\s+for\s+(?:a\s+|an\s+|my\s+|new\s+|next\s+|full[-\s]?time\s+)*(?:sde|swe|job|role|position|opportunit\w*)s?\b|\bopen\s+to\s+work\b|\bopentowork\b|(?<!\bwe\s+are\s)(?<!\bwe\s*'re\s)\b(?:i\s*'?m\s+|i\s+am\s+)?(?:actively\s+)?seeking\s+(?:a\s+|my\s+|new\s+|full[-\s]?time\s+)*(?:[\w#+.-]+\s+){0,2}(?:roles?|opportunit\w*|positions?)\b/i,
    genuineRules: [
      { id: "first-person", label: "first-person hiring", re: /\bi\s*'?m\s+hiring\b|\bi\s+am\s+hiring\b|\bmy\s+team\s+is\s+hiring\b|\bwe\s*'?re\s+hiring\s+(?:for|on)\s+(?:my|our)\s+team\b|\bjoin\s+(?:my|our)\s+team\b|\bhiring\s+(?:for|on)\s+my\s+team\b|\b(?:openings?|roles?|positions?)\s+on\s+(?:my|our)\s+team\b|\b(?:i\s*'?m|i\s+am)\s+looking\s+for\b[^.]{0,50}\b(?:engineers?|developers?|swes?|sdes?)\b|\blooking\s+for\s+a\s+founding\s+engineer\b/i },
      { id: "referral", label: "referral offer", re: /\bhappy\s+to\s+refer\b|\bcan\s+refer\b|\bglad\s+to\s+refer\b|\bdm\s+me\b|\bmessage\s+me\b|\breach\s+out\s+to\s+me\b|\bmy\s+dms?\s+are\s+open\b|\bfeel\s+free\s+to\s+(?:dm|message|reach\s+out)\b/i },
      { id: "headline-role", label: "hiring-side headline", scope: "headline", re: /\bengineering\s+manager\b|\bhiring\s+manager\b|\b(?:director|vp|vice\s+president|head)\s+(?:of\s+)?(?:software|engineering|platform|technology|data|product)\b|\bcto\b|\bco-?founder\b|\bfounder\b|\btech(?:nical)?\s+lead\b|\bteam\s+lead\b|\b(?:staff|principal|senior|sr\.?|lead)\s+[\w#+.]+\s+engineers?\b|\b(?:staff|principal|senior|sr\.?|lead)\s+(?:software\s+)?engineer\b|\bsoftware\s+engineer\b|\bswe\b|\bengineering\s+lead\b|\bsoftware\s+development\s+manager\b|\bmanager,?\s+software\s+(?:development|engineering)\b/i }
    ],
    allowedPlacesRe: nameList(allowedPlaces),
    recruiterRe: /\brecruit(?:er|ing|ment)\b|\btalent\s+acquisition\b|\bsourcer\b/i,
    allowAtRe: atCompanyList(allowCompanies),
    // For user-taught firm overrides (content.js compiles trust/block lists).
    buildFirmRe: (names) => (names && names.length ? firmList(names) : null)
  };

  if (typeof module === "object" && module.exports) module.exports = JP.rules;
})(typeof self !== "undefined" ? self : globalThis);
