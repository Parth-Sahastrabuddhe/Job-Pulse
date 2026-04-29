import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadEnvFile(envFilePath = path.join(PROJECT_ROOT, ".env")) {
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const content = fs.readFileSync(envFilePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value, fallback) {
  if (!value) {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveProjectPath(value, fallbackRelativePath) {
  const candidate = value?.trim() || fallbackRelativePath;
  return path.isAbsolute(candidate) ? candidate : path.resolve(PROJECT_ROOT, candidate);
}

loadEnvFile();

export function getConfig() {
  return {
    countryFilter: (process.env.COUNTRY_FILTER?.trim().toLowerCase() || "us"),
    maxJobsPerSource: parseNumber(process.env.MAX_JOBS_PER_SOURCE, 60),
    retentionDays: parseNumber(process.env.STATE_RETENTION_DAYS, 45),
    batchSize: parseNumber(process.env.BATCH_SIZE, 20),
    batchDelayMs: parseNumber(process.env.BATCH_DELAY_MS, 3000),
    slowCycleMinutes: parseNumber(process.env.SLOW_CYCLE_MINUTES, 5),
    fastTrackCompanies: parseList(process.env.FAST_TRACK_COMPANIES, ["microsoft", "amazon"]),
    maxPostAgeMinutes: parseNumber(process.env.MAX_POST_AGE_MINUTES, 180),
    maxDateOnlyAgeDays: parseNumber(process.env.MAX_DATE_ONLY_AGE_DAYS, 1),
    maxNewJobsPerNotify: parseNumber(process.env.MAX_NEW_JOBS_PER_NOTIFY, 10),
    stateFile: resolveProjectPath(process.env.STATE_FILE, "data/state.json"),
    dbFile: resolveProjectPath(process.env.DB_FILE, "data/jobs.db"),
    notifications: {
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || "",
      discordBotToken: process.env.DISCORD_BOT_TOKEN?.trim() || "",
      discordChannelId: process.env.DISCORD_CHANNEL_ID?.trim() || "",
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
      telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || ""
    },
    heartbeat: {
      micro: process.env.HEARTBEAT_URL_MICRO?.trim() || "",
      mu: process.env.HEARTBEAT_URL_MU?.trim() || ""
    },
    applicant: {
      name: process.env.APPLICANT_NAME?.trim() || "",
      email: process.env.APPLICANT_EMAIL?.trim() || "",
      phone: process.env.APPLICANT_PHONE?.trim() || "",
      linkedin: process.env.APPLICANT_LINKEDIN?.trim() || "",
      resumePath: resolveProjectPath(process.env.APPLICANT_RESUME_PATH, "resume/base.pdf"),
    },
    amazon: {
      sourceKey: "amazon",
      sourceLabel: "Amazon",
      url:
        process.env.AMAZON_URL?.trim() ||
        "https://www.amazon.jobs/en/search?category%5B%5D=Software+Development&sort=recent&country%5B%5D=USA"
    },
    microsoft: {
      sourceKey: "microsoft",
      sourceLabel: "Microsoft",
      url:
        process.env.MICROSOFT_URL?.trim() ||
        "https://apply.careers.microsoft.com/careers?start=0&sort_by=Most+recent&filter_profession=software+engineering"
    },
    google: {
      sourceKey: "google",
      sourceLabel: "Google"
    },
    meta: {
      sourceKey: "meta",
      sourceLabel: "Meta"
    },
    // Workday companies
    nvidia: {
      sourceKey: "nvidia",
      sourceLabel: "Nvidia",
      apiUrl: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
      baseUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite"
    },
    salesforce: {
      sourceKey: "salesforce",
      sourceLabel: "Salesforce",
      apiUrl: "https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/jobs",
      baseUrl: "https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
      searchText: "MTS"
    },
    adobe: {
      sourceKey: "adobe",
      sourceLabel: "Adobe",
      apiUrl: "https://adobe.wd5.myworkdayjobs.com/wday/cxs/adobe/external_experienced/jobs",
      baseUrl: "https://adobe.wd5.myworkdayjobs.com/external_experienced"
    },
    cisco: {
      sourceKey: "cisco",
      sourceLabel: "Cisco",
      apiUrl: "https://cisco.wd5.myworkdayjobs.com/wday/cxs/cisco/Cisco_Careers/jobs",
      baseUrl: "https://cisco.wd5.myworkdayjobs.com/Cisco_Careers"
    },
    // PCSX companies (same API as Microsoft)
    qualcomm: {
      sourceKey: "qualcomm",
      sourceLabel: "Qualcomm",
      apiUrl: "https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com&query=software+engineer&location=United+States&start=0&sort_by=new&pg_size=20",
      baseUrl: "https://careers.qualcomm.com"
    },
    // Workday additions
    netflix: {
      sourceKey: "netflix",
      sourceLabel: "Netflix",
      apiUrl: "https://netflix.wd1.myworkdayjobs.com/wday/cxs/netflix/Netflix/jobs",
      baseUrl: "https://netflix.wd1.myworkdayjobs.com/Netflix"
    },
    snap: {
      sourceKey: "snap",
      sourceLabel: "Snap",
      apiUrl: "https://snapchat.wd1.myworkdayjobs.com/wday/cxs/snapchat/snap/jobs",
      baseUrl: "https://snapchat.wd1.myworkdayjobs.com/snap"
    },
    // Lever companies
    palantir: {
      sourceKey: "palantir",
      sourceLabel: "Palantir",
      apiUrl: "https://api.lever.co/v0/postings/palantir?mode=json"
    },
    plaid: {
      sourceKey: "plaid",
      sourceLabel: "Plaid",
      apiUrl: "https://api.lever.co/v0/postings/plaid?mode=json"
    },
    spotify: {
      sourceKey: "spotify",
      sourceLabel: "Spotify",
      apiUrl: "https://api.lever.co/v0/postings/spotify?mode=json"
    },
    creditkarma: {
      sourceKey: "creditkarma",
      sourceLabel: "Credit Karma",
      apiUrl: "https://api.lever.co/v0/postings/creditkarma?mode=json"
    },
    quora: {
      sourceKey: "quora",
      sourceLabel: "Quora",
      apiUrl: "https://api.lever.co/v0/postings/quora?mode=json"
    },
    // Greenhouse companies
    stripe: {
      sourceKey: "stripe",
      sourceLabel: "Stripe",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs",
      jobUrlBase: "https://boards.greenhouse.io/stripe/jobs/"
    },
    databricks: {
      sourceKey: "databricks",
      sourceLabel: "Databricks",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs",
      jobUrlBase: "https://boards.greenhouse.io/databricks/jobs/"
    },
    figma: {
      sourceKey: "figma",
      sourceLabel: "Figma",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/figma/jobs",
      jobUrlBase: "https://boards.greenhouse.io/figma/jobs/"
    },
    lyft: {
      sourceKey: "lyft",
      sourceLabel: "Lyft",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/lyft/jobs",
      jobUrlBase: "https://boards.greenhouse.io/lyft/jobs/"
    },
    discord: {
      sourceKey: "discord",
      sourceLabel: "Discord",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/discord/jobs",
      jobUrlBase: "https://boards.greenhouse.io/discord/jobs/"
    },
    twilio: {
      sourceKey: "twilio",
      sourceLabel: "Twilio",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs",
      jobUrlBase: "https://boards.greenhouse.io/twilio/jobs/"
    },
    cloudflare: {
      sourceKey: "cloudflare",
      sourceLabel: "Cloudflare",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs",
      jobUrlBase: "https://boards.greenhouse.io/cloudflare/jobs/"
    },
    coinbase: {
      sourceKey: "coinbase",
      sourceLabel: "Coinbase",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs",
      jobUrlBase: "https://boards.greenhouse.io/coinbase/jobs/"
    },
    roblox: {
      sourceKey: "roblox",
      sourceLabel: "Roblox",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/roblox/jobs",
      jobUrlBase: "https://boards.greenhouse.io/roblox/jobs/"
    },
    // Greenhouse additions
    anthropic: {
      sourceKey: "anthropic",
      sourceLabel: "Anthropic",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/anthropic/jobs/"
    },
    airbnb: {
      sourceKey: "airbnb",
      sourceLabel: "Airbnb",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/airbnb/jobs",
      jobUrlBase: "https://boards.greenhouse.io/airbnb/jobs/"
    },
    doordash: {
      sourceKey: "doordash",
      sourceLabel: "DoorDash",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/doordashusa/jobs/"
    },
    reddit: {
      sourceKey: "reddit",
      sourceLabel: "Reddit",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/reddit/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/reddit/jobs/"
    },
    pinterest: {
      sourceKey: "pinterest",
      sourceLabel: "Pinterest",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/pinterest/jobs",
      jobUrlBase: "https://boards.greenhouse.io/pinterest/jobs/"
    },
    datadog: {
      sourceKey: "datadog",
      sourceLabel: "Datadog",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs",
      jobUrlBase: "https://boards.greenhouse.io/datadog/jobs/"
    },
    mongodb: {
      sourceKey: "mongodb",
      sourceLabel: "MongoDB",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs",
      jobUrlBase: "https://boards.greenhouse.io/mongodb/jobs/"
    },
    robinhood: {
      sourceKey: "robinhood",
      sourceLabel: "Robinhood",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/robinhood/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/robinhood/jobs/"
    },
    hubspot: {
      sourceKey: "hubspot",
      sourceLabel: "HubSpot",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/hubspot/jobs",
      jobUrlBase: "https://boards.greenhouse.io/hubspot/jobs/"
    },
    instacart: {
      sourceKey: "instacart",
      sourceLabel: "Instacart",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs",
      jobUrlBase: "https://boards.greenhouse.io/instacart/jobs/"
    },
    samsara: {
      sourceKey: "samsara",
      sourceLabel: "Samsara",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/samsara/jobs",
      jobUrlBase: "https://boards.greenhouse.io/samsara/jobs/"
    },
    // Ashby companies
    openai: {
      sourceKey: "openai",
      sourceLabel: "OpenAI",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/openai",
      boardSlug: "openai"
    },
    notion: {
      sourceKey: "notion",
      sourceLabel: "Notion",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/notion",
      boardSlug: "notion"
    },
    ramp: {
      sourceKey: "ramp",
      sourceLabel: "Ramp",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/ramp",
      boardSlug: "ramp"
    },
    snowflake: {
      sourceKey: "snowflake",
      sourceLabel: "Snowflake",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/snowflake",
      boardSlug: "snowflake"
    },
    cursor: {
      sourceKey: "cursor",
      sourceLabel: "Cursor",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/cursor",
      boardSlug: "cursor"
    },
    airtable: {
      sourceKey: "airtable",
      sourceLabel: "Airtable",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/airtable",
      boardSlug: "airtable"
    },
    vanta: {
      sourceKey: "vanta",
      sourceLabel: "Vanta",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/vanta",
      boardSlug: "vanta"
    },
    docker: {
      sourceKey: "docker",
      sourceLabel: "Docker",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/docker",
      boardSlug: "docker"
    },
    zapier: {
      sourceKey: "zapier",
      sourceLabel: "Zapier",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/zapier",
      boardSlug: "zapier"
    },
    sentry: {
      sourceKey: "sentry",
      sourceLabel: "Sentry",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/sentry",
      boardSlug: "sentry"
    },
    mapbox: {
      sourceKey: "mapbox",
      sourceLabel: "Mapbox",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/mapbox",
      boardSlug: "mapbox"
    },
    lambdalabs: {
      sourceKey: "lambdalabs",
      sourceLabel: "Lambda",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/lambda",
      boardSlug: "lambda"
    },
    // --- New Greenhouse companies ---
    block: {
      sourceKey: "block",
      sourceLabel: "Block",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/block/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/block/jobs/"
    },
    elastic: {
      sourceKey: "elastic",
      sourceLabel: "Elastic",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/elastic/jobs",
      jobUrlBase: "https://job-boards.greenhouse.io/elastic/jobs/"
    },
    // --- New Workday companies ---
    intel: {
      sourceKey: "intel",
      sourceLabel: "Intel",
      apiUrl: "https://intel.wd1.myworkdayjobs.com/wday/cxs/intel/External/jobs",
      baseUrl: "https://intel.wd1.myworkdayjobs.com/External"
    },
    paypal: {
      sourceKey: "paypal",
      sourceLabel: "PayPal",
      apiUrl: "https://paypal.wd1.myworkdayjobs.com/wday/cxs/paypal/jobs/jobs",
      baseUrl: "https://paypal.wd1.myworkdayjobs.com/jobs"
    },
    capitalone: {
      sourceKey: "capitalone",
      sourceLabel: "Capital One",
      apiUrl: "https://capitalone.wd12.myworkdayjobs.com/wday/cxs/capitalone/Capital_One/jobs",
      baseUrl: "https://capitalone.wd12.myworkdayjobs.com/Capital_One"
    },
    walmartglobaltech: {
      sourceKey: "walmartglobaltech",
      sourceLabel: "Walmart Global Tech",
      apiUrl: "https://walmart.wd5.myworkdayjobs.com/wday/cxs/walmart/WalmartExternal/jobs",
      baseUrl: "https://walmart.wd5.myworkdayjobs.com/WalmartExternal"
    },
    samsung: {
      sourceKey: "samsung",
      sourceLabel: "Samsung",
      apiUrl: "https://sec.wd3.myworkdayjobs.com/wday/cxs/sec/Samsung_Careers/jobs",
      baseUrl: "https://sec.wd3.myworkdayjobs.com/Samsung_Careers"
    },
    broadcom: {
      sourceKey: "broadcom",
      sourceLabel: "Broadcom",
      apiUrl: "https://broadcom.wd1.myworkdayjobs.com/wday/cxs/broadcom/External_Career/jobs",
      baseUrl: "https://broadcom.wd1.myworkdayjobs.com/External_Career"
    },
    nike: {
      sourceKey: "nike",
      sourceLabel: "Nike",
      apiUrl: "https://nike.wd1.myworkdayjobs.com/wday/cxs/nike/nke/jobs",
      baseUrl: "https://nike.wd1.myworkdayjobs.com/nke"
    },
    fidelity: {
      sourceKey: "fidelity",
      sourceLabel: "Fidelity",
      apiUrl: "https://fmr.wd1.myworkdayjobs.com/wday/cxs/fmr/fidelitycareers/jobs",
      baseUrl: "https://fmr.wd1.myworkdayjobs.com/fidelitycareers"
    },
    wellsfargo: {
      sourceKey: "wellsfargo",
      sourceLabel: "Wells Fargo",
      apiUrl: "https://wf.wd1.myworkdayjobs.com/wday/cxs/wf/wellsfargojobs/jobs",
      baseUrl: "https://wf.wd1.myworkdayjobs.com/wellsfargojobs"
    },
    bankofamerica: {
      sourceKey: "bankofamerica",
      sourceLabel: "Bank of America",
      apiUrl: "https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/lateral-us/jobs",
      baseUrl: "https://ghr.wd1.myworkdayjobs.com/lateral-us"
    },
    usbank: {
      sourceKey: "usbank",
      sourceLabel: "U.S. Bank",
      apiUrl: "https://usbank.wd1.myworkdayjobs.com/wday/cxs/usbank/us_bank_careers/jobs",
      baseUrl: "https://usbank.wd1.myworkdayjobs.com/us_bank_careers"
    },
    threeM: {
      sourceKey: "threeM",
      sourceLabel: "3M",
      apiUrl: "https://3m.wd1.myworkdayjobs.com/wday/cxs/3m/search/jobs",
      baseUrl: "https://3m.wd1.myworkdayjobs.com/search"
    },
    boeing: {
      sourceKey: "boeing",
      sourceLabel: "Boeing",
      apiUrl: "https://boeing.wd1.myworkdayjobs.com/wday/cxs/boeing/external_careers/jobs",
      baseUrl: "https://boeing.wd1.myworkdayjobs.com/external_careers"
    },
    disney: {
      sourceKey: "disney",
      sourceLabel: "Disney",
      apiUrl: "https://disney.wd5.myworkdayjobs.com/wday/cxs/disney/disneycareer/jobs",
      baseUrl: "https://disney.wd5.myworkdayjobs.com/disneycareer"
    },
    amgen: {
      sourceKey: "amgen",
      sourceLabel: "Amgen",
      apiUrl: "https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/careers/jobs",
      baseUrl: "https://amgen.wd1.myworkdayjobs.com/careers"
    },
    accenture: {
      sourceKey: "accenture",
      sourceLabel: "Accenture",
      apiUrl: "https://accenture.wd103.myworkdayjobs.com/wday/cxs/accenture/accenturecareers/jobs",
      baseUrl: "https://accenture.wd103.myworkdayjobs.com/accenturecareers"
    },
    comcast: {
      sourceKey: "comcast",
      sourceLabel: "Comcast",
      apiUrl: "https://comcast.wd5.myworkdayjobs.com/wday/cxs/comcast/comcast_careers/jobs",
      baseUrl: "https://comcast.wd5.myworkdayjobs.com/comcast_careers"
    },
    target: {
      sourceKey: "target",
      sourceLabel: "Target",
      apiUrl: "https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs",
      baseUrl: "https://target.wd5.myworkdayjobs.com/targetcareers"
    },
    // --- New Greenhouse companies ---
    polyai: {
      sourceKey: "polyai",
      sourceLabel: "PolyAI",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/polyai/jobs",
      jobUrlBase: "https://boards.greenhouse.io/polyai/jobs/"
    },
    addepar: {
      sourceKey: "addepar",
      sourceLabel: "Addepar",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/addepar1/jobs",
      jobUrlBase: "https://boards.greenhouse.io/addepar1/jobs/"
    },
    hudl: {
      sourceKey: "hudl",
      sourceLabel: "Hudl",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/hudl/jobs",
      jobUrlBase: "https://boards.greenhouse.io/hudl/jobs/"
    },
    okta: {
      sourceKey: "okta",
      sourceLabel: "Okta",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/okta/jobs",
      jobUrlBase: "https://boards.greenhouse.io/okta/jobs/"
    },
    deepmind: {
      sourceKey: "deepmind",
      sourceLabel: "DeepMind",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/deepmind/jobs",
      jobUrlBase: "https://boards.greenhouse.io/deepmind/jobs/"
    },
    waymo: {
      sourceKey: "waymo",
      sourceLabel: "Waymo",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/waymo/jobs",
      jobUrlBase: "https://boards.greenhouse.io/waymo/jobs/"
    },
    rubrik: {
      sourceKey: "rubrik",
      sourceLabel: "Rubrik",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/rubrik/jobs",
      jobUrlBase: "https://boards.greenhouse.io/rubrik/jobs/"
    },
    dropbox: {
      sourceKey: "dropbox",
      sourceLabel: "Dropbox",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/dropbox/jobs",
      jobUrlBase: "https://boards.greenhouse.io/dropbox/jobs/"
    },
    // --- New Lever companies ---
    binance: {
      sourceKey: "binance",
      sourceLabel: "Binance",
      apiUrl: "https://api.lever.co/v0/postings/binance?mode=json"
    },
    zoox: {
      sourceKey: "zoox",
      sourceLabel: "Zoox",
      apiUrl: "https://api.lever.co/v0/postings/zoox?mode=json"
    },
    veeva: {
      sourceKey: "veeva",
      sourceLabel: "Veeva Systems",
      apiUrl: "https://api.lever.co/v0/postings/veeva?mode=json"
    },
    floqast: {
      sourceKey: "floqast",
      sourceLabel: "FloQast",
      apiUrl: "https://api.lever.co/v0/postings/floqast?mode=json"
    },
    gopuff: {
      sourceKey: "gopuff",
      sourceLabel: "GoPuff",
      apiUrl: "https://api.lever.co/v0/postings/gopuff?mode=json"
    },
    highspot: {
      sourceKey: "highspot",
      sourceLabel: "Highspot",
      apiUrl: "https://api.lever.co/v0/postings/highspot?mode=json"
    },
    // --- SmartRecruiters companies ---
    servicenow: {
      sourceKey: "servicenow",
      sourceLabel: "ServiceNow",
      companySlug: "ServiceNow"
    },
    visa: {
      sourceKey: "visa",
      sourceLabel: "Visa",
      companySlug: "Visa"
    },
    aristanetworks: {
      sourceKey: "aristanetworks",
      sourceLabel: "Arista Networks",
      companySlug: "AristaNetworks"
    },
    bosch: {
      sourceKey: "bosch",
      sourceLabel: "Bosch",
      companySlug: "BoschGroup"
    },
    sanofi: {
      sourceKey: "sanofi",
      sourceLabel: "Sanofi",
      companySlug: "Sanofi"
    },
    mcdonalds: {
      sourceKey: "mcdonalds",
      sourceLabel: "McDonald's",
      companySlug: "McDonaldsCorporation"
    },
    // --- New Greenhouse companies (batch 2) ---
    duolingo: {
      sourceKey: "duolingo",
      sourceLabel: "Duolingo",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs",
      jobUrlBase: "https://boards.greenhouse.io/duolingo/jobs/"
    },
    thumbtack: {
      sourceKey: "thumbtack",
      sourceLabel: "Thumbtack",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/thumbtack/jobs",
      jobUrlBase: "https://boards.greenhouse.io/thumbtack/jobs/"
    },
    hackerrank: {
      sourceKey: "hackerrank",
      sourceLabel: "HackerRank",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/hackerrank/jobs",
      jobUrlBase: "https://boards.greenhouse.io/hackerrank/jobs/"
    },
    zoominfo: {
      sourceKey: "zoominfo",
      sourceLabel: "ZoomInfo",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/zoominfo/jobs",
      jobUrlBase: "https://boards.greenhouse.io/zoominfo/jobs/"
    },
    verisign: {
      sourceKey: "verisign",
      sourceLabel: "Verisign",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/verisign/jobs",
      jobUrlBase: "https://boards.greenhouse.io/verisign/jobs/"
    },
    fanduel: {
      sourceKey: "fanduel",
      sourceLabel: "FanDuel",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/fanduel/jobs",
      jobUrlBase: "https://boards.greenhouse.io/fanduel/jobs/"
    },
    // --- New Ashby companies (batch 2) ---
    onepassword: {
      sourceKey: "onepassword",
      sourceLabel: "1Password",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/1password",
      boardSlug: "1password"
    },
    supabase: {
      sourceKey: "supabase",
      sourceLabel: "Supabase",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/supabase",
      boardSlug: "supabase"
    },
    replit: {
      sourceKey: "replit",
      sourceLabel: "Replit",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/replit",
      boardSlug: "replit"
    },
    elevenlabs: {
      sourceKey: "elevenlabs",
      sourceLabel: "ElevenLabs",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/elevenlabs",
      boardSlug: "elevenlabs"
    },
    runway: {
      sourceKey: "runway",
      sourceLabel: "Runway",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/runway",
      boardSlug: "runway"
    },
    creditgenie: {
      sourceKey: "creditgenie",
      sourceLabel: "Credit Genie",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/creditgenie",
      boardSlug: "creditgenie"
    },
    deel: {
      sourceKey: "deel",
      sourceLabel: "Deel",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/deel",
      boardSlug: "deel"
    },
    harvey: {
      sourceKey: "harvey",
      sourceLabel: "Harvey",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/harvey",
      boardSlug: "harvey"
    },
    writer: {
      sourceKey: "writer",
      sourceLabel: "Writer",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/writer",
      boardSlug: "writer"
    },
    deepgram: {
      sourceKey: "deepgram",
      sourceLabel: "Deepgram",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/deepgram",
      boardSlug: "deepgram"
    },
    sierra: {
      sourceKey: "sierra",
      sourceLabel: "Sierra",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/sierra",
      boardSlug: "sierra"
    },
    roboflow: {
      sourceKey: "roboflow",
      sourceLabel: "Roboflow",
      apiUrl: "https://api.ashbyhq.com/posting-api/job-board/roboflow",
      boardSlug: "roboflow"
    },
    // --- New Lever companies (batch 2) ---
    anchorage: {
      sourceKey: "anchorage",
      sourceLabel: "Anchorage Digital",
      apiUrl: "https://api.lever.co/v0/postings/anchorage?mode=json"
    },
    attentive: {
      sourceKey: "attentive",
      sourceLabel: "Attentive",
      apiUrl: "https://api.lever.co/v0/postings/attentive?mode=json"
    },
    jumpcloud: {
      sourceKey: "jumpcloud",
      sourceLabel: "JumpCloud",
      apiUrl: "https://api.lever.co/v0/postings/jumpcloud?mode=json"
    },
    // --- New Workday companies (batch 2) ---
    dell: {
      sourceKey: "dell",
      sourceLabel: "Dell",
      apiUrl: "https://dell.wd1.myworkdayjobs.com/wday/cxs/dell/External/jobs",
      baseUrl: "https://dell.wd1.myworkdayjobs.com/External"
    },
    // --- Solo companies (custom APIs) ---
    mercedesbenz: {
      sourceKey: "mercedesbenz",
      sourceLabel: "Mercedes-Benz",
      apiUrl: "https://mercedes-benz-beesite-production-gjb-intranet.app.beesite.de/search",
      jobUrlBase: "https://jobs.mercedes-benz.com/?ac=jobad&id="
    },
    hexaware: {
      sourceKey: "hexaware",
      sourceLabel: "Hexaware",
      apiUrl: "https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      jobUrlBase: "https://fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/"
    },
    dynatrace: {
      sourceKey: "dynatrace",
      sourceLabel: "Dynatrace",
      apiUrl: "https://www.dynatrace.com/api/coveo/search/",
      jobUrlBase: "https://www.dynatrace.com/careers/jobs/"
    }
  };
}
