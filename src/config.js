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
    keywords: parseList(process.env.JOB_TITLE_KEYWORDS, [
      "software engineer",
      "software development engineer",
      "sde",
      "software developer"
    ]),
    headless: parseBoolean(process.env.HEADLESS, true),
    debugBrowser: parseBoolean(process.env.DEBUG_BROWSER, false),
    pageTimeoutMs: parseNumber(process.env.PAGE_TIMEOUT_MS, 45000),
    networkSettleMs: parseNumber(process.env.NETWORK_SETTLE_MS, 4000),
    maxScrollSteps: parseNumber(process.env.MAX_SCROLL_STEPS, 5),
    maxLoadMoreClicks: parseNumber(process.env.MAX_LOAD_MORE_CLICKS, 2),
    maxJobsPerSource: parseNumber(process.env.MAX_JOBS_PER_SOURCE, 60),
    retentionDays: parseNumber(process.env.STATE_RETENTION_DAYS, 45),
    pollIntervalSeconds: parseNumber(process.env.POLL_INTERVAL_SECONDS, 15),
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
      jobUrlBase: "https://stripe.com/jobs/search?gh_jid="
    },
    databricks: {
      sourceKey: "databricks",
      sourceLabel: "Databricks",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/databricks/jobs",
      jobUrlBase: "https://www.databricks.com/company/careers/open-positions?gh_jid="
    },
    figma: {
      sourceKey: "figma",
      sourceLabel: "Figma",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/figma/jobs",
      jobUrlBase: "https://www.figma.com/careers/?gh_jid="
    },
    lyft: {
      sourceKey: "lyft",
      sourceLabel: "Lyft",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/lyft/jobs",
      jobUrlBase: "https://www.lyft.com/careers/?gh_jid="
    },
    discord: {
      sourceKey: "discord",
      sourceLabel: "Discord",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/discord/jobs",
      jobUrlBase: "https://discord.com/careers/?gh_jid="
    },
    twilio: {
      sourceKey: "twilio",
      sourceLabel: "Twilio",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/twilio/jobs",
      jobUrlBase: "https://www.twilio.com/company/jobs/?gh_jid="
    },
    cloudflare: {
      sourceKey: "cloudflare",
      sourceLabel: "Cloudflare",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs",
      jobUrlBase: "https://www.cloudflare.com/careers/jobs/?gh_jid="
    },
    coinbase: {
      sourceKey: "coinbase",
      sourceLabel: "Coinbase",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/coinbase/jobs",
      jobUrlBase: "https://www.coinbase.com/careers/positions/?gh_jid="
    },
    roblox: {
      sourceKey: "roblox",
      sourceLabel: "Roblox",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/roblox/jobs",
      jobUrlBase: "https://careers.roblox.com/jobs/?gh_jid="
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
      jobUrlBase: "https://careers.airbnb.com/positions/?gh_jid="
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
      jobUrlBase: "https://www.pinterestcareers.com/jobs/?gh_jid="
    },
    datadog: {
      sourceKey: "datadog",
      sourceLabel: "Datadog",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/datadog/jobs",
      jobUrlBase: "https://careers.datadoghq.com/detail/?gh_jid="
    },
    mongodb: {
      sourceKey: "mongodb",
      sourceLabel: "MongoDB",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/mongodb/jobs",
      jobUrlBase: "https://www.mongodb.com/careers/job/?gh_jid="
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
      jobUrlBase: "https://www.hubspot.com/careers/jobs/?gh_jid="
    },
    instacart: {
      sourceKey: "instacart",
      sourceLabel: "Instacart",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/instacart/jobs",
      jobUrlBase: "https://instacart.careers/?gh_jid="
    },
    samsara: {
      sourceKey: "samsara",
      sourceLabel: "Samsara",
      apiUrl: "https://boards-api.greenhouse.io/v1/boards/samsara/jobs",
      jobUrlBase: "https://www.samsara.com/company/careers/?gh_jid="
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
    }
  };
}
