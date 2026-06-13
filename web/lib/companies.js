import { getDb } from "./db.js";

let _companies = null;

export function getCompanies() {
  if (_companies) return _companies;
  const rows = getDb().prepare("SELECT company_key, company_name FROM h1b_sponsors ORDER BY company_name").all();
  _companies = rows.map((r) => ({ key: r.company_key, label: r.company_name }));
  return _companies;
}

const COMPANY_GROUPS = {
  "Big Tech": ["microsoft", "amazon", "google", "meta", "apple", "linkedin", "netflix"],
  "AI & ML": ["anthropic", "openai", "deepmind", "xai", "mistral", "cohere", "perplexity", "scaleai", "glean", "sambanova", "baseten", "modal", "lambdalabs", "elevenlabs", "runway", "harvey", "writer", "deepgram", "sierra", "roboflow", "cursor", "polyai", "palantir"],
  "Finance & Banking": ["goldmansachs", "jpmorgan", "citi", "capitalone", "wellsfargo", "bankofamerica", "usbank", "fidelity", "robinhood", "coinbase", "morganstanley", "bloomberg", "visa"],
  "Fintech & Payments": ["paypal", "block", "plaid", "ramp", "brex", "adyen", "affirm", "sofi", "chime", "upstart", "carta", "marqeta", "intuit", "creditkarma", "creditgenie", "addepar", "floqast", "deel"],
  "Crypto & Web3": ["gemini", "kraken", "binance", "anchorage", "ripple"],
  "Trading & Market Making": ["drw", "imc", "towerresearch", "jumptrading", "akuna"],
  "Enterprise & Cloud": ["cisco", "salesforce", "oracle", "intel", "nvidia", "adobe", "broadcom", "dell", "servicenow", "accenture", "samsung", "qualcomm", "aristanetworks", "dynatrace", "hexaware", "verisign", "purestorage", "appliedmaterials", "experian", "dropbox"],
  "Developer Tools & Infra": ["stripe", "cloudflare", "datadog", "mongodb", "confluent", "databricks", "figma", "twilio", "docker", "zapier", "sentry", "mapbox", "supabase", "replit", "gitlab", "grafana", "temporal", "launchdarkly", "linear", "render", "warp", "posthog", "newrelic", "elastic"],
  "Data & Analytics": ["snowflake", "clickhouse", "fivetran", "dbtlabs", "singlestore", "neo4j", "cockroachlabs", "redpanda", "amplitude", "mixpanel"],
  "Security & Identity": ["okta", "vanta", "wiz", "verkada", "checkr", "sift", "rubrik", "onepassword", "jumpcloud"],
  "B2B & SaaS": ["hubspot", "asana", "braze", "klaviyo", "sixsense", "attentive", "highspot", "zoominfo", "squarespace", "gusto", "airtable", "notion", "veeva", "hackerrank", "hudl", "samsara", "flexport"],
  "Consumer & Media": ["disney", "spotify", "pinterest", "reddit", "snap", "discord", "roblox", "airbnb", "doordash", "instacart", "lyft", "uber", "nextdoor", "faire", "duolingo", "thumbtack", "quora", "gopuff", "fanduel", "comcast"],
  "Auto, Robotics & Industrial": ["ford", "mercedesbenz", "boeing", "bosch", "waymo", "zoox", "aurora", "motional", "nuro", "figureai", "threeM"],
  "Retail & Healthcare": ["walmartglobaltech", "target", "nike", "mcdonalds", "amgen", "sanofi"],
};

export function getGroupedCompanies() {
  const allCompanies = getCompanies();
  const grouped = {};
  const assigned = new Set();
  for (const [group, keys] of Object.entries(COMPANY_GROUPS)) {
    grouped[group] = allCompanies.filter((c) => keys.includes(c.key));
    keys.forEach((k) => assigned.add(k));
  }
  const other = allCompanies.filter((c) => !assigned.has(c.key));
  if (other.length > 0) grouped["Other"] = other;
  return grouped;
}
