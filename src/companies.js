// Central company registry — SINGLE SOURCE OF TRUTH
// Adding a company = adding ONE entry here. No other file needs manual updates.
//
// Each entry: { key, label, ats, lane, urlPattern, board/slug }
//   key:        sourceKey used in DB and throughout the pipeline
//   label:      display name for Discord notifications
//   ats:        "greenhouse" | "workday" | "lever" | "ashby" | "smartrecruiters" | "pcsx" | "solo"
//   lane:       "fast" | "normal" | "slow"
//   urlPattern: regex for Fit Check button URL matching (captures job ID)
//   board:      Greenhouse board slug, Ashby board slug, or SmartRecruiters company slug
//   banking:    true if company uses VP/SVP/MD seniority titles

export const COMPANIES = [
  // === Fast lane (checked every batch cycle) ===
  { key: "microsoft", label: "Microsoft", ats: "solo", lane: "fast", urlPattern: /apply\.careers\.microsoft\.com\/careers\/job\/(\d+)/i },
  { key: "amazon", label: "Amazon", ats: "solo", lane: "fast", urlPattern: /amazon\.jobs\/(?:[a-z]{2}\/)?jobs\/(\d+)/i },

  // === Normal lane — standalone collectors ===
  { key: "google", label: "Google", ats: "solo", lane: "normal", urlPattern: /google\.com\/about\/careers\/applications\/jobs\/results\/(\d+)/i },
  { key: "meta", label: "Meta", ats: "solo", lane: "normal", urlPattern: /metacareers\.com\/jobs\/(\d+)/i },
  { key: "goldmansachs", label: "Goldman Sachs", ats: "solo", lane: "normal", banking: true, urlPattern: /higher\.gs\.com\/roles\/(\d+)/i },
  { key: "oracle", label: "Oracle", ats: "solo", lane: "normal", urlPattern: /oraclecloud\.com\/.*?job\/(\d+)/i },
  { key: "jpmorgan", label: "JPMorgan Chase", ats: "solo", lane: "normal", banking: true, urlPattern: /jpmc\.fa\.oraclecloud\.com\/.*?job\/(\d+)/i },
  { key: "ford", label: "Ford Motor", ats: "solo", lane: "normal", urlPattern: /efds\.fa\.em5\.oraclecloud\.com\/.*?job\/(\d+)/i },
  { key: "citi", label: "Citi", ats: "solo", lane: "normal", banking: true, urlPattern: /jobs\.citi\.com\/job\/[^/]+\/[^/]+\/287\/(\d+)/i },
  { key: "mercedesbenz", label: "Mercedes-Benz", ats: "solo", lane: "normal", urlPattern: /jobs\.mercedes-benz\.com\/.*?(?:\?ac=jobad&id=|---)(\d+)/i },
  { key: "hexaware", label: "Hexaware", ats: "solo", lane: "normal", urlPattern: /fa-etqo-saasfaprod1\.fa\.ocs\.oraclecloud\.com\/.*?job\/(\d+)/i },
  { key: "dynatrace", label: "Dynatrace", ats: "solo", lane: "normal", urlPattern: /dynatrace\.com\/careers\/jobs\/(\d+)/i },

  // === Slow lane — Playwright/HTML scrapers ===
  { key: "apple", label: "Apple", ats: "solo", lane: "slow", urlPattern: /jobs\.apple\.com\/en-us\/details\/(\d+)/i },
  { key: "uber", label: "Uber", ats: "solo", lane: "slow", urlPattern: /uber\.com\/.*?careers\/list\/(\d+)/i },
  { key: "confluent", label: "Confluent", ats: "solo", lane: "slow", urlPattern: /careers\.confluent\.io\/jobs\/job\/([a-f0-9-]+)/i },
  { key: "linkedin", label: "LinkedIn", ats: "solo", lane: "normal", urlPattern: /linkedin\.com\/jobs\/view\/(?:[^/]*-)?(\d+)/i },
  { key: "intuit", label: "Intuit", ats: "solo", lane: "normal", urlPattern: /jobs\.intuit\.com\/job\/[^/]+\/[^/]+\/27595\/(\d+)/i },
  { key: "bloomberg", label: "Bloomberg", ats: "solo", lane: "normal", urlPattern: /bloomberg\.avature\.net\/careers\/JobDetail\/[^/]+\/(\d+)/i },

  // === Workday companies ===
  { key: "nvidia", label: "Nvidia", ats: "workday", lane: "normal", urlPattern: /nvidia\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "salesforce", label: "Salesforce", ats: "workday", lane: "normal", urlPattern: /salesforce\.wd12\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "adobe", label: "Adobe", ats: "workday", lane: "normal", urlPattern: /adobe\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "cisco", label: "Cisco", ats: "workday", lane: "normal", urlPattern: /cisco\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "netflix", label: "Netflix", ats: "workday", lane: "normal", urlPattern: /netflix\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "snap", label: "Snap", ats: "workday", lane: "normal", urlPattern: /snapchat\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "intel", label: "Intel", ats: "workday", lane: "normal", urlPattern: /intel\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "paypal", label: "PayPal", ats: "workday", lane: "normal", urlPattern: /paypal\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "capitalone", label: "Capital One", ats: "workday", lane: "normal", urlPattern: /capitalone\.wd12\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "walmartglobaltech", label: "Walmart Global Tech", ats: "workday", lane: "normal", urlPattern: /walmart\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "samsung", label: "Samsung", ats: "workday", lane: "normal", urlPattern: /sec\.wd3\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "broadcom", label: "Broadcom", ats: "workday", lane: "normal", urlPattern: /broadcom\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "nike", label: "Nike", ats: "workday", lane: "normal", urlPattern: /nike\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "usbank", label: "U.S. Bank", ats: "workday", lane: "normal", urlPattern: /usbank\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "fidelity", label: "Fidelity", ats: "workday", lane: "normal", urlPattern: /fmr\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "wellsfargo", label: "Wells Fargo", ats: "workday", lane: "normal", urlPattern: /wf\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "bankofamerica", label: "Bank of America", ats: "workday", lane: "normal", urlPattern: /ghr\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "threeM", label: "3M", ats: "workday", lane: "normal", urlPattern: /3m\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "boeing", label: "Boeing", ats: "workday", lane: "normal", urlPattern: /boeing\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "disney", label: "Disney", ats: "workday", lane: "normal", urlPattern: /disney\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "amgen", label: "Amgen", ats: "workday", lane: "normal", urlPattern: /amgen\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "accenture", label: "Accenture", ats: "workday", lane: "normal", urlPattern: /accenture\.wd103\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "dell", label: "Dell", ats: "workday", lane: "normal", urlPattern: /dell\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "comcast", label: "Comcast", ats: "workday", lane: "normal", urlPattern: /comcast\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "target", label: "Target", ats: "workday", lane: "normal", urlPattern: /target\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
  { key: "morganstanley", label: "Morgan Stanley", ats: "workday", lane: "normal", banking: true, urlPattern: /ms\.wd5\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },

  // === Greenhouse companies ===
  { key: "stripe", label: "Stripe", ats: "greenhouse", lane: "normal", board: "stripe", urlPattern: /(?:stripe\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "databricks", label: "Databricks", ats: "greenhouse", lane: "normal", board: "databricks", urlPattern: /(?:databricks\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "figma", label: "Figma", ats: "greenhouse", lane: "normal", board: "figma", urlPattern: /(?:figma\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "lyft", label: "Lyft", ats: "greenhouse", lane: "normal", board: "lyft", urlPattern: /(?:lyft\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "discord", label: "Discord", ats: "greenhouse", lane: "normal", board: "discord", urlPattern: /(?:discord\.com\/careers|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "twilio", label: "Twilio", ats: "greenhouse", lane: "normal", board: "twilio", urlPattern: /(?:twilio\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "cloudflare", label: "Cloudflare", ats: "greenhouse", lane: "normal", board: "cloudflare", urlPattern: /(?:cloudflare\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "coinbase", label: "Coinbase", ats: "greenhouse", lane: "normal", board: "coinbase", urlPattern: /(?:coinbase\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "roblox", label: "Roblox", ats: "greenhouse", lane: "normal", board: "roblox", urlPattern: /(?:roblox\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "anthropic", label: "Anthropic", ats: "greenhouse", lane: "normal", board: "anthropic", urlPattern: /(?:anthropic\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "airbnb", label: "Airbnb", ats: "greenhouse", lane: "normal", board: "airbnb", urlPattern: /(?:airbnb\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "doordash", label: "DoorDash", ats: "greenhouse", lane: "normal", board: "doordashusa", urlPattern: /(?:doordash\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "reddit", label: "Reddit", ats: "greenhouse", lane: "normal", board: "reddit", urlPattern: /(?:reddit\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "pinterest", label: "Pinterest", ats: "greenhouse", lane: "normal", board: "pinterest", urlPattern: /(?:pinterest\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "datadog", label: "Datadog", ats: "greenhouse", lane: "normal", board: "datadog", urlPattern: /(?:datadoghq\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "mongodb", label: "MongoDB", ats: "greenhouse", lane: "normal", board: "mongodb", urlPattern: /(?:mongodb\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "robinhood", label: "Robinhood", ats: "greenhouse", lane: "normal", board: "robinhood", urlPattern: /(?:robinhood\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "hubspot", label: "HubSpot", ats: "greenhouse", lane: "normal", board: "hubspot", urlPattern: /(?:hubspot\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "instacart", label: "Instacart", ats: "greenhouse", lane: "normal", board: "instacart", urlPattern: /(?:instacart\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "samsara", label: "Samsara", ats: "greenhouse", lane: "normal", board: "samsara", urlPattern: /(?:samsara\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "block", label: "Block", ats: "greenhouse", lane: "normal", board: "block", urlPattern: /(?:block\.xyz|squareup\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "elastic", label: "Elastic", ats: "greenhouse", lane: "normal", board: "elastic", urlPattern: /(?:elastic\.co|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "waymo", label: "Waymo", ats: "greenhouse", lane: "normal", board: "waymo", urlPattern: /(?:waymo\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "rubrik", label: "Rubrik", ats: "greenhouse", lane: "normal", board: "rubrik", urlPattern: /(?:rubrik\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "dropbox", label: "Dropbox", ats: "greenhouse", lane: "normal", board: "dropbox", urlPattern: /(?:dropbox\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "okta", label: "Okta", ats: "greenhouse", lane: "normal", board: "okta", urlPattern: /(?:okta\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "deepmind", label: "DeepMind", ats: "greenhouse", lane: "normal", board: "deepmind", urlPattern: /(?:deepmind\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "duolingo", label: "Duolingo", ats: "greenhouse", lane: "normal", board: "duolingo", urlPattern: /(?:duolingo\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "thumbtack", label: "Thumbtack", ats: "greenhouse", lane: "normal", board: "thumbtack", urlPattern: /(?:thumbtack\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "hackerrank", label: "HackerRank", ats: "greenhouse", lane: "normal", board: "hackerrank", urlPattern: /(?:hackerrank\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "zoominfo", label: "ZoomInfo", ats: "greenhouse", lane: "normal", board: "zoominfo", urlPattern: /(?:zoominfo\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "verisign", label: "Verisign", ats: "greenhouse", lane: "normal", board: "verisign", urlPattern: /(?:verisign\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "fanduel", label: "FanDuel", ats: "greenhouse", lane: "normal", board: "fanduel", urlPattern: /(?:fanduel\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "polyai", label: "PolyAI", ats: "greenhouse", lane: "normal", board: "polyai", urlPattern: /(?:poly\.ai|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "addepar", label: "Addepar", ats: "greenhouse", lane: "normal", board: "addepar1", urlPattern: /(?:addepar\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "hudl", label: "Hudl", ats: "greenhouse", lane: "normal", board: "hudl", urlPattern: /(?:hudl\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },

  // === PCSX companies ===
  { key: "qualcomm", label: "Qualcomm", ats: "pcsx", lane: "normal", urlPattern: /careers\.qualcomm\.com\/.*?jobs\/(\d+)/i },

  // === Lever companies ===
  { key: "palantir", label: "Palantir", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/palantir\/([a-f0-9-]+)/i },
  { key: "plaid", label: "Plaid", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/plaid\/([a-f0-9-]+)/i },
  { key: "spotify", label: "Spotify", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/spotify\/([a-f0-9-]+)/i },
  { key: "creditkarma", label: "Credit Karma", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/creditkarma\/([a-f0-9-]+)/i },
  { key: "quora", label: "Quora", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/quora\/([a-f0-9-]+)/i },
  { key: "zoox", label: "Zoox", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/zoox\/([a-f0-9-]+)/i },
  { key: "binance", label: "Binance", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/binance\/([a-f0-9-]+)/i },
  { key: "anchorage", label: "Anchorage Digital", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/anchorage\/([a-f0-9-]+)/i },
  { key: "attentive", label: "Attentive", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/attentive\/([a-f0-9-]+)/i },
  { key: "jumpcloud", label: "JumpCloud", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/jumpcloud\/([a-f0-9-]+)/i },
  { key: "veeva", label: "Veeva Systems", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/veeva\/([a-f0-9-]+)/i },
  { key: "floqast", label: "FloQast", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/floqast\/([a-f0-9-]+)/i },
  { key: "gopuff", label: "GoPuff", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/gopuff\/([a-f0-9-]+)/i },
  { key: "highspot", label: "Highspot", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/highspot\/([a-f0-9-]+)/i },

  // === Ashby companies ===
  { key: "openai", label: "OpenAI", ats: "ashby", lane: "normal", board: "openai", urlPattern: /jobs\.ashbyhq\.com\/openai\/([a-f0-9-]+)/i },
  { key: "notion", label: "Notion", ats: "ashby", lane: "normal", board: "notion", urlPattern: /jobs\.ashbyhq\.com\/notion\/([a-f0-9-]+)/i },
  { key: "ramp", label: "Ramp", ats: "ashby", lane: "normal", board: "ramp", urlPattern: /jobs\.ashbyhq\.com\/ramp\/([a-f0-9-]+)/i },
  { key: "snowflake", label: "Snowflake", ats: "ashby", lane: "normal", board: "snowflake", urlPattern: /jobs\.ashbyhq\.com\/snowflake\/([a-f0-9-]+)/i },
  { key: "cursor", label: "Cursor", ats: "ashby", lane: "normal", board: "cursor", urlPattern: /jobs\.ashbyhq\.com\/cursor\/([a-f0-9-]+)/i },
  { key: "airtable", label: "Airtable", ats: "ashby", lane: "normal", board: "airtable", urlPattern: /jobs\.ashbyhq\.com\/airtable\/([a-f0-9-]+)/i },
  { key: "vanta", label: "Vanta", ats: "ashby", lane: "normal", board: "vanta", urlPattern: /jobs\.ashbyhq\.com\/vanta\/([a-f0-9-]+)/i },
  { key: "docker", label: "Docker", ats: "ashby", lane: "normal", board: "docker", urlPattern: /jobs\.ashbyhq\.com\/docker\/([a-f0-9-]+)/i },
  { key: "zapier", label: "Zapier", ats: "ashby", lane: "normal", board: "zapier", urlPattern: /jobs\.ashbyhq\.com\/zapier\/([a-f0-9-]+)/i },
  { key: "sentry", label: "Sentry", ats: "ashby", lane: "normal", board: "sentry", urlPattern: /jobs\.ashbyhq\.com\/sentry\/([a-f0-9-]+)/i },
  { key: "mapbox", label: "Mapbox", ats: "ashby", lane: "normal", board: "mapbox", urlPattern: /jobs\.ashbyhq\.com\/mapbox\/([a-f0-9-]+)/i },
  { key: "lambdalabs", label: "Lambda", ats: "ashby", lane: "normal", board: "lambda", urlPattern: /jobs\.ashbyhq\.com\/lambda\/([a-f0-9-]+)/i },
  { key: "onepassword", label: "1Password", ats: "ashby", lane: "normal", board: "1password", urlPattern: /jobs\.ashbyhq\.com\/1password\/([a-f0-9-]+)/i },
  { key: "supabase", label: "Supabase", ats: "ashby", lane: "normal", board: "supabase", urlPattern: /jobs\.ashbyhq\.com\/supabase\/([a-f0-9-]+)/i },
  { key: "replit", label: "Replit", ats: "ashby", lane: "normal", board: "replit", urlPattern: /jobs\.ashbyhq\.com\/replit\/([a-f0-9-]+)/i },
  { key: "elevenlabs", label: "ElevenLabs", ats: "ashby", lane: "normal", board: "elevenlabs", urlPattern: /jobs\.ashbyhq\.com\/elevenlabs\/([a-f0-9-]+)/i },
  { key: "runway", label: "Runway", ats: "ashby", lane: "normal", board: "runway", urlPattern: /jobs\.ashbyhq\.com\/runway\/([a-f0-9-]+)/i },
  { key: "creditgenie", label: "Credit Genie", ats: "ashby", lane: "normal", board: "creditgenie", urlPattern: /jobs\.ashbyhq\.com\/creditgenie\/([a-f0-9-]+)/i },
  { key: "deel", label: "Deel", ats: "ashby", lane: "normal", board: "deel", urlPattern: /jobs\.ashbyhq\.com\/deel\/([a-f0-9-]+)/i },
  { key: "harvey", label: "Harvey", ats: "ashby", lane: "normal", board: "harvey", urlPattern: /jobs\.ashbyhq\.com\/harvey\/([a-f0-9-]+)/i },
  { key: "writer", label: "Writer", ats: "ashby", lane: "normal", board: "writer", urlPattern: /jobs\.ashbyhq\.com\/writer\/([a-f0-9-]+)/i },
  { key: "deepgram", label: "Deepgram", ats: "ashby", lane: "normal", board: "deepgram", urlPattern: /jobs\.ashbyhq\.com\/deepgram\/([a-f0-9-]+)/i },
  { key: "sierra", label: "Sierra", ats: "ashby", lane: "normal", board: "sierra", urlPattern: /jobs\.ashbyhq\.com\/sierra\/([a-f0-9-]+)/i },
  { key: "roboflow", label: "Roboflow", ats: "ashby", lane: "normal", board: "roboflow", urlPattern: /jobs\.ashbyhq\.com\/roboflow\/([a-f0-9-]+)/i },

  // === SmartRecruiters companies ===
  { key: "servicenow", label: "ServiceNow", ats: "smartrecruiters", lane: "normal", board: "ServiceNow", urlPattern: /jobs\.smartrecruiters\.com\/ServiceNow\/([a-f0-9-]+)/i },
  { key: "visa", label: "Visa", ats: "smartrecruiters", lane: "normal", board: "Visa", urlPattern: /jobs\.smartrecruiters\.com\/Visa\/([a-f0-9-]+)/i },
  { key: "aristanetworks", label: "Arista Networks", ats: "smartrecruiters", lane: "normal", board: "AristaNetworks", urlPattern: /jobs\.smartrecruiters\.com\/AristaNetworks\/([a-f0-9-]+)/i },
  { key: "bosch", label: "Bosch", ats: "smartrecruiters", lane: "normal", board: "BoschGroup", urlPattern: /jobs\.smartrecruiters\.com\/BoschGroup\/([a-f0-9-]+)/i },
  { key: "sanofi", label: "Sanofi", ats: "smartrecruiters", lane: "normal", board: "Sanofi", urlPattern: /jobs\.smartrecruiters\.com\/Sanofi\/([a-f0-9-]+)/i },
  { key: "mcdonalds", label: "McDonald's", ats: "smartrecruiters", lane: "normal", board: "McDonaldsCorporation", urlPattern: /jobs\.smartrecruiters\.com\/McDonaldsCorporation\/([a-f0-9-]+)/i },

  // === 2026-06 expansion batch (endpoints live-verified before adding) ===
  // Greenhouse
  { key: "brex", label: "Brex", ats: "greenhouse", lane: "normal", board: "brex", urlPattern: /(?:brex\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "xai", label: "xAI", ats: "greenhouse", lane: "normal", board: "xai", urlPattern: /(?:x\.ai|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "adyen", label: "Adyen", ats: "greenhouse", lane: "normal", board: "adyen", urlPattern: /(?:adyen\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "braze", label: "Braze", ats: "greenhouse", lane: "normal", board: "braze", urlPattern: /(?:braze\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "scaleai", label: "Scale AI", ats: "greenhouse", lane: "normal", board: "scaleai", urlPattern: /(?:scale\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "clickhouse", label: "ClickHouse", ats: "greenhouse", lane: "normal", board: "clickhouse", urlPattern: /(?:clickhouse\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "glean", label: "Glean", ats: "greenhouse", lane: "normal", board: "gleanwork", urlPattern: /(?:glean\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "wiz", label: "Wiz", ats: "greenhouse", lane: "normal", board: "wizinc", urlPattern: /(?:wiz\.io|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "klaviyo", label: "Klaviyo", ats: "greenhouse", lane: "normal", board: "klaviyo", urlPattern: /(?:klaviyo\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "affirm", label: "Affirm", ats: "greenhouse", lane: "normal", board: "affirm", urlPattern: /(?:affirm\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "aurora", label: "Aurora", ats: "greenhouse", lane: "normal", board: "aurorainnovation", urlPattern: /(?:aurora\.tech|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "drw", label: "DRW", ats: "greenhouse", lane: "normal", board: "drweng", urlPattern: /(?:drw\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "gitlab", label: "GitLab", ats: "greenhouse", lane: "normal", board: "gitlab", urlPattern: /(?:gitlab\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "ripple", label: "Ripple", ats: "greenhouse", lane: "normal", board: "ripple", urlPattern: /(?:ripple\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "asana", label: "Asana", ats: "greenhouse", lane: "normal", board: "asana", urlPattern: /(?:asana\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "imc", label: "IMC Trading", ats: "greenhouse", lane: "normal", board: "imc", urlPattern: /(?:imc\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "sofi", label: "SoFi", ats: "greenhouse", lane: "normal", board: "sofi", urlPattern: /(?:sofi\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "figureai", label: "Figure AI", ats: "greenhouse", lane: "normal", board: "figureai", urlPattern: /(?:figure\.ai|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "fivetran", label: "Fivetran", ats: "greenhouse", lane: "normal", board: "fivetran", urlPattern: /(?:fivetran\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "grafana", label: "Grafana Labs", ats: "greenhouse", lane: "normal", board: "grafanalabs", urlPattern: /(?:grafana\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "flexport", label: "Flexport", ats: "greenhouse", lane: "normal", board: "flexport", urlPattern: /(?:flexport\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "motional", label: "Motional", ats: "greenhouse", lane: "normal", board: "motional", urlPattern: /(?:motional\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "nuro", label: "Nuro", ats: "greenhouse", lane: "normal", board: "nuro", urlPattern: /(?:nuro\.ai|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "purestorage", label: "Pure Storage", ats: "greenhouse", lane: "normal", board: "purestorage", urlPattern: /(?:purestorage\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "verkada", label: "Verkada", ats: "greenhouse", lane: "normal", board: "verkada", urlPattern: /(?:verkada\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "gusto", label: "Gusto", ats: "greenhouse", lane: "normal", board: "gusto", urlPattern: /(?:gusto\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "upstart", label: "Upstart", ats: "greenhouse", lane: "normal", board: "upstart", urlPattern: /(?:upstart\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "faire", label: "Faire", ats: "greenhouse", lane: "normal", board: "faire", urlPattern: /(?:faire\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "chime", label: "Chime", ats: "greenhouse", lane: "normal", board: "chime", urlPattern: /(?:chime\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "newrelic", label: "New Relic", ats: "greenhouse", lane: "normal", board: "newrelic", urlPattern: /(?:newrelic\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "towerresearch", label: "Tower Research", ats: "greenhouse", lane: "normal", board: "towerresearchcapital", urlPattern: /(?:tower\-research\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "jumptrading", label: "Jump Trading", ats: "greenhouse", lane: "normal", board: "jumptrading", urlPattern: /(?:jumptrading\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "checkr", label: "Checkr", ats: "greenhouse", lane: "normal", board: "checkr", urlPattern: /(?:checkr\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "carta", label: "Carta", ats: "greenhouse", lane: "normal", board: "carta", urlPattern: /(?:carta\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "amplitude", label: "Amplitude", ats: "greenhouse", lane: "normal", board: "amplitude", urlPattern: /(?:amplitude\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "temporal", label: "Temporal", ats: "greenhouse", lane: "normal", board: "temporaltechnologies", urlPattern: /(?:temporal\.io|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "launchdarkly", label: "LaunchDarkly", ats: "greenhouse", lane: "normal", board: "launchdarkly", urlPattern: /(?:launchdarkly\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "singlestore", label: "SingleStore", ats: "greenhouse", lane: "normal", board: "singlestore", urlPattern: /(?:singlestore\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "neo4j", label: "Neo4j", ats: "greenhouse", lane: "normal", board: "neo4j", urlPattern: /(?:neo4j\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "sixsense", label: "6sense", ats: "greenhouse", lane: "normal", board: "6sense", urlPattern: /(?:6sense\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "mixpanel", label: "Mixpanel", ats: "greenhouse", lane: "normal", board: "mixpanel", urlPattern: /(?:mixpanel\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "dbtlabs", label: "dbt Labs", ats: "greenhouse", lane: "normal", board: "dbtlabsinc", urlPattern: /(?:getdbt\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "cockroachlabs", label: "Cockroach Labs", ats: "greenhouse", lane: "normal", board: "cockroachlabs", urlPattern: /(?:cockroachlabs\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "marqeta", label: "Marqeta", ats: "greenhouse", lane: "normal", board: "marqeta", urlPattern: /(?:marqeta\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "akuna", label: "Akuna Capital", ats: "greenhouse", lane: "normal", board: "akunacapital", urlPattern: /(?:akunacapital\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "gemini", label: "Gemini", ats: "greenhouse", lane: "normal", board: "gemini", urlPattern: /(?:gemini\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "squarespace", label: "Squarespace", ats: "greenhouse", lane: "normal", board: "squarespace", urlPattern: /(?:squarespace\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "redpanda", label: "Redpanda", ats: "greenhouse", lane: "normal", board: "redpandadata", urlPattern: /(?:redpanda\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "sambanova", label: "SambaNova", ats: "greenhouse", lane: "normal", board: "sambanovasystems", urlPattern: /(?:sambanova\.ai|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  { key: "nextdoor", label: "Nextdoor", ats: "greenhouse", lane: "normal", board: "nextdoor", urlPattern: /(?:nextdoor\.com|greenhouse\.io).*?(?:gh_jid=|jobs\/)(\d+)/i },
  // Lever
  { key: "mistral", label: "Mistral AI", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/mistral\/([a-f0-9-]+)/i },
  { key: "kraken", label: "Kraken", ats: "lever", lane: "normal", urlPattern: /jobs\.lever\.co\/kraken123\/([a-f0-9-]+)/i },
  // Ashby
  { key: "cohere", label: "Cohere", ats: "ashby", lane: "normal", board: "cohere", urlPattern: /jobs\.ashbyhq\.com\/cohere\/([a-f0-9-]+)/i },
  { key: "perplexity", label: "Perplexity", ats: "ashby", lane: "normal", board: "perplexity", urlPattern: /jobs\.ashbyhq\.com\/perplexity\/([a-f0-9-]+)/i },
  { key: "baseten", label: "Baseten", ats: "ashby", lane: "normal", board: "baseten", urlPattern: /jobs\.ashbyhq\.com\/baseten\/([a-f0-9-]+)/i },
  { key: "modal", label: "Modal", ats: "ashby", lane: "normal", board: "modal", urlPattern: /jobs\.ashbyhq\.com\/modal\/([a-f0-9-]+)/i },
  { key: "linear", label: "Linear", ats: "ashby", lane: "normal", board: "linear", urlPattern: /jobs\.ashbyhq\.com\/linear\/([a-f0-9-]+)/i },
  { key: "render", label: "Render", ats: "ashby", lane: "normal", board: "render", urlPattern: /jobs\.ashbyhq\.com\/render\/([a-f0-9-]+)/i },
  { key: "warp", label: "Warp", ats: "ashby", lane: "normal", board: "warp", urlPattern: /jobs\.ashbyhq\.com\/warp\/([a-f0-9-]+)/i },
  { key: "posthog", label: "PostHog", ats: "ashby", lane: "normal", board: "posthog", urlPattern: /jobs\.ashbyhq\.com\/posthog\/([a-f0-9-]+)/i },
  { key: "sift", label: "Sift", ats: "ashby", lane: "normal", board: "sift", urlPattern: /jobs\.ashbyhq\.com\/sift\/([a-f0-9-]+)/i },
  // SmartRecruiters
  { key: "experian", label: "Experian", ats: "smartrecruiters", lane: "normal", board: "Experian", urlPattern: /jobs\.smartrecruiters\.com\/Experian\/([a-f0-9-]+)/i },
  // Workday
  { key: "appliedmaterials", label: "Applied Materials", ats: "workday", lane: "normal", urlPattern: /amat\.wd1\.myworkdayjobs\.com\/.*?\/job\/[^/]*\/([^/\s?]+)/i },
];

// === Derived lists (auto-generated from COMPANIES) ===

export const JOB_URL_PATTERNS = COMPANIES.map((c) => ({
  source: c.key,
  sourceLabel: c.label,
  regex: c.urlPattern
}));

export const GREENHOUSE_KEYS = COMPANIES.filter((c) => c.ats === "greenhouse").map((c) => c.key);
export const WORKDAY_KEYS = COMPANIES.filter((c) => c.ats === "workday").map((c) => c.key);
export const LEVER_KEYS = COMPANIES.filter((c) => c.ats === "lever").map((c) => c.key);
export const ASHBY_KEYS = COMPANIES.filter((c) => c.ats === "ashby").map((c) => c.key);
export const PCSX_KEYS = COMPANIES.filter((c) => c.ats === "pcsx").map((c) => c.key);
export const SMARTRECRUITERS_KEYS = COMPANIES.filter((c) => c.ats === "smartrecruiters").map((c) => c.key);

export const GREENHOUSE_BOARDS = Object.fromEntries(
  COMPANIES.filter((c) => c.ats === "greenhouse").map((c) => [c.key, c.board])
);

export const ASHBY_BOARDS = Object.fromEntries(
  COMPANIES.filter((c) => c.ats === "ashby").map((c) => [c.key, c.board])
);

export const SMARTRECRUITERS_SLUGS = Object.fromEntries(
  COMPANIES.filter((c) => c.ats === "smartrecruiters").map((c) => [c.key, c.board])
);

export const SOLO_COMPANIES = COMPANIES.filter((c) => c.ats === "solo");
export const BANKING_COMPANIES = new Set(COMPANIES.filter((c) => c.banking).map((c) => c.key));
