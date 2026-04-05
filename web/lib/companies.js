import { getDb } from "./db.js";

let _companies = null;

export function getCompanies() {
  if (_companies) return _companies;
  const rows = getDb().prepare("SELECT company_key, company_name FROM h1b_sponsors ORDER BY company_name").all();
  _companies = rows.map((r) => ({ key: r.company_key, label: r.company_name }));
  return _companies;
}

const COMPANY_GROUPS = {
  "Big Tech": ["microsoft", "amazon", "google", "meta", "apple"],
  "Finance & Banking": ["goldmansachs", "jpmorgan", "citi", "capitalone", "wellsfargo", "bankofamerica", "usbank", "fidelity", "robinhood", "coinbase"],
  "Enterprise & Cloud": ["cisco", "salesforce", "oracle", "intel", "nvidia", "adobe", "broadcom", "dell", "servicenow"],
  "Consumer & Media": ["netflix", "disney", "spotify", "pinterest", "reddit", "snap", "discord", "roblox", "airbnb", "doordash", "instacart", "lyft", "uber"],
  "Developer Tools & Infra": ["stripe", "cloudflare", "datadog", "mongodb", "confluent", "databricks", "figma", "hashicorp"],
  "AI & ML": ["anthropic", "openai"],
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
