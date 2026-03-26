# JobPulse

## Project Overview
Real-time job aggregation engine monitoring 88+ companies across 8 ATS platforms with Discord notifications.

## Key Files
- `src/index.js` — Main loop with batch rotation, company registry (`buildRegistry()`)
- `src/config.js` — All company configs and env var parsing
- `src/discord-bot.js` — Discord buttons, threads, slash commands, URL patterns (`JOB_URL_PATTERNS`)
- `src/state.js` — SQLite state management
- `src/job-description.js` — Job description fetching per ATS (GREENHOUSE_BOARDS, WORKDAY_SOURCES, ASHBY_SOURCES, Lever list)
- `src/sources/*.js` — One collector per ATS platform + custom scrapers
- `src/sources/shared.js` — Shared utilities including `inferCountryCodeFromLocation` (NON_US_CITIES), `finalizeJob`, `jobMatchesCountryFilter`

## Architecture
- **Fast lane**: Microsoft, Amazon (every batch cycle ~3s)
- **Normal lane**: API companies in batches of 20 (Greenhouse, Workday, Ashby, Lever, SmartRecruiters, Oracle HCM, custom APIs)
- **Slow lane**: Playwright/HTML scrapers every 5 minutes (Uber, Confluent, Apple, LinkedIn, Intuit, Bloomberg)

## Bot Management
- PID stored in `data/bot.pid`, lock in `data/bot.lock`
- Always ask user before restarting
- When restarting: read PID from `data/bot.pid`, kill only that PID, clean up, start fresh
- Start command: `nohup node src/index.js --watch > data/bot.log 2>&1 &`
- Check company queue on conversation start: `SELECT * FROM company_queue WHERE status = 'pending'`
- User runs another bot on the same machine — NEVER kill all node processes, only kill the PID from bot.pid

## Skills

### /add-company
Add a new company to the JobPulse pipeline. Follow these steps exactly:

1. **Identify the ATS platform.** Try these in order:
   - Greenhouse: `curl -s -o /dev/null -w "%{http_code}" "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"`
   - Lever: `curl -s -o /dev/null -w "%{http_code}" "https://api.lever.co/v0/postings/{slug}?mode=json"`
   - Ashby: `curl -s -o /dev/null -w "%{http_code}" "https://api.ashbyhq.com/posting-api/job-board/{slug}"`
   - SmartRecruiters: `curl -s "https://api.smartrecruiters.com/v1/companies/{Slug}/postings?limit=1" -H "accept: application/json"`
   - Workday: Check `docs/companies-future-scope.md` for verified tenant/instance/site, or search the [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator/tree/main/data) workday_companies.json
   - Oracle HCM: Check if company uses `*.oraclecloud.com/hcmRestApi`
   - If none match: check career site HTML for platform clues, try TalentBrew, Eightfold, or Playwright

2. **Verify the API returns jobs:**
   - For Greenhouse/Lever/Ashby: confirm 200 status and jobs exist
   - For Workday: `curl -s -X POST "{apiUrl}" -H "Content-Type: application/json" -d '{"limit":3,"searchText":"software engineer"}'`
   - For SmartRecruiters: check `totalFound > 0`

3. **Add config** in `src/config.js`:
   - Greenhouse: `{ sourceKey, sourceLabel, apiUrl, jobUrlBase }`
   - Workday: `{ sourceKey, sourceLabel, apiUrl, baseUrl }`
   - Lever: `{ sourceKey, sourceLabel, apiUrl }`
   - Ashby: `{ sourceKey, sourceLabel, apiUrl, boardSlug }`
   - SmartRecruiters: `{ sourceKey, sourceLabel, companySlug }`

4. **Add to registry** in `src/index.js` `buildRegistry()`:
   - Add the key to the matching platform array (greenhouse, workday, lever, ashby, smartrecruiters)
   - If custom scraper: create `src/sources/{company}.js`, import it, add `solo()` or `param()` call

5. **Add URL pattern** in `src/discord-bot.js` `JOB_URL_PATTERNS` array for Fit Check button support

6. **Register for job description fetching** in `src/job-description.js`:
   - Greenhouse: add key+slug to `GREENHOUSE_BOARDS` object
   - Workday: add key to `WORKDAY_SOURCES` array
   - Ashby: add key to `ASHBY_SOURCES` array AND `ASHBY_BOARDS` object
   - Lever: add key to the Lever array in the `fetchJobDescription` switch
   - SmartRecruiters: add key to `SMARTRECRUITERS_SLUGS` object AND the SmartRecruiters array in `fetchJobDescription`
   - Oracle HCM/Custom: verify fit check works end-to-end

7. **Verify non-US filtering**: Check that the company's location data contains recognizable US locations or non-US cities. If the API returns only city names (no country), verify `inferCountryCodeFromLocation` in `src/sources/shared.js` catches them. Add new non-US cities to `NON_US_CITIES` regex if needed.

8. **Update docs** in `docs/companies-{platform}.md` and `docs/companies-overview.md`

9. **Run /quality-check** — mandatory before deploying

10. **Ask user** if they want to restart the bot

11. **If restarting**: kill PID from `data/bot.pid`, clean up lock, start fresh, verify with logs

12. **Update `docs/companies-future-scope.md`**: remove the company from the future list

---

### /dev-check
Run BEFORE making any code change. This is a pre-flight checklist.

1. **Read the files you're about to modify** — never edit a file you haven't read in this session
2. **Understand the data flow** — trace how the change affects: collector → dedup → filter → notify → Discord
3. **Check for ripple effects** — if changing a collector, check if `job-description.js`, `discord-bot.js`, and `index.js` also need updates
4. **Identify the registration points** — every company touches 5 files:
   - `src/config.js` (company config)
   - `src/index.js` (registry array)
   - `src/discord-bot.js` (URL pattern)
   - `src/job-description.js` (description fetcher list)
   - `src/sources/shared.js` (country detection if needed)
5. **Check for hardcoded values** — search for any hardcoded company names, URLs, or IDs that should be configurable
6. **Verify ESM compatibility** — this project uses ES modules (`"type": "module"`). Never use `require()` — use `import`. If dynamic import is needed, use `await import()`

---

### /audit
Full codebase audit. Run after any significant change or when bugs are suspected.

#### Collector Audit (for each file in `src/sources/`)
1. **Error handling**: Does the collector catch ALL exceptions and return `[]`? Can any uncaught error crash the bot?
2. **API response parsing**: Does it handle null/undefined/empty/malformed responses?
3. **Country filtering**: Can non-US jobs slip through? Check `inferCountry` or `countryCode` assignment
4. **Seniority filtering**: Can senior/staff/VP/director roles slip through `isEntryMidLevelSwe`?
5. **Job URL correctness**: Will the generated URL actually open the right job page? Test by opening one
6. **Job ID stability**: Is the ID extracted from a stable field? Will it change across API calls?
7. **Function signature**: Does it match `fn(browser, config, log)` or `fn(browser, config, log, key)`?
8. **Playwright cleanup**: Is `browser.close()` in a `finally` block? Can it leak?

#### Description Fetcher Audit (`src/job-description.js`)
1. **Registration completeness**: Is EVERY company in the pipeline registered in the correct fetcher list?
   - Count companies in `GREENHOUSE_BOARDS` vs greenhouse array in `index.js`
   - Count companies in `WORKDAY_SOURCES` vs workday array in `index.js`
   - Count companies in `ASHBY_SOURCES` and `ASHBY_BOARDS` vs ashby array in `index.js`
   - Count companies in Lever array vs lever array in `index.js`
   - Count companies in `SMARTRECRUITERS_SLUGS` vs smartrecruiters array in `index.js`
2. **ID verification**: Does every fetcher that uses a search/list API verify the returned job ID matches the requested one? (The Amazon bug — blindly taking `[0]`)
3. **Playwright cleanup**: Every `chromium.launch()` must have a matching `browser.close()` in a `finally` block
4. **Null safety**: Can any fetcher crash on null/undefined response data?

#### Discord Bot Audit (`src/discord-bot.js`)
1. **Interaction timeout**: Does every handler call `deferUpdate()` or `deferReply()` within 3 seconds?
2. **Error messages**: Does every error path send a user-friendly message (no raw file paths, no stack traces)?
3. **Thread safety**: Can thread creation fail if the message already has a thread? Is `setArchived(false)` called?
4. **Button state**: After clicking Applied/Skip, are the buttons correctly updated? Can a user get stuck?

#### State Audit (`src/state.js`)
1. **SQL injection**: Are all queries parameterized? (They should be — `better-sqlite3` uses `?` params)
2. **Transaction safety**: Are multi-row operations wrapped in `db.transaction()`?
3. **Concurrent access**: Can two operations conflict? (SQLite WAL mode helps but check)

#### Index Audit (`src/index.js`)
1. **Registry count**: Count all companies in `buildRegistry()`. Must match the expected total.
2. **Batch loop safety**: Is the entire cycle body wrapped in try/catch?
3. **Timeout coverage**: Do ALL lanes (fast, normal, slow) have timeouts?
4. **Memory**: Can the loop leak memory over days of running? Check for growing arrays/maps.

#### Run these commands:
```bash
node --check src/config.js && node --check src/index.js && node --check src/discord-bot.js && node --check src/job-description.js && node --check src/state.js && node --check src/tailor.js && echo "ALL SYNTAX OK"
```

---

### /quality-check
Mandatory before ANY deployment (restart, git push, or AWS deploy). No exceptions.

#### 1. Syntax Check
```bash
for f in src/*.js src/sources/*.js src/notifiers/*.js; do node --check "$f" || echo "FAIL: $f"; done
```

#### 2. Description Fetcher Verification
Test every company that has jobs in the DB:
```bash
node -e "
const { fetchJobDescription } = require('./src/job-description.js');
const Database = require('better-sqlite3');
const db = new Database('data/jobs.db');
const sources = db.prepare('SELECT DISTINCT source_key FROM seen_jobs').all();
(async () => {
  const failed = [];
  for (const { source_key } of sources) {
    const row = db.prepare('SELECT id, url FROM seen_jobs WHERE source_key = ? ORDER BY last_seen_at DESC LIMIT 1').get(source_key);
    if (!row) continue;
    try {
      const desc = await fetchJobDescription({ sourceKey: source_key, id: row.id, url: row.url });
      if ((desc?.length || 0) < 50) failed.push(source_key + ' (' + (desc?.length || 0) + 'B)');
    } catch (e) { failed.push(source_key + ' (ERR)'); }
  }
  console.log('Passed: ' + (sources.length - failed.length) + '/' + sources.length);
  if (failed.length) console.log('FAILED:', failed.join(', '));
  db.close();
})();
"
```
If any company fails, investigate and fix before deploying.

#### 3. Country Filter Verification
```bash
node -e "
const { inferCountryCodeFromLocation } = require('./src/sources/shared.js');
const tests = [
  ['San Francisco, CA', 'US'], ['New York, NY', 'US'], ['Bengaluru', 'NON-US'],
  ['London', 'NON-US'], ['Pune', 'NON-US'], ['Amsterdam', 'NON-US'],
  ['Tokyo', 'NON-US'], ['Toronto', 'NON-US'], ['Remote', '']
];
let pass = 0, fail = 0;
for (const [input, expected] of tests) {
  const got = inferCountryCodeFromLocation(input);
  if (got === expected) { pass++; } else { fail++; console.log('FAIL: ' + input + ' expected ' + expected + ' got ' + got); }
}
console.log('Country filter: ' + pass + '/' + (pass+fail) + ' passed');
"
```

#### 4. Registry Count Verification
```bash
node -e "
const { getConfig } = require('./src/config.js');
const config = getConfig();
// Count all source keys in config
const keys = Object.keys(config).filter(k => config[k]?.sourceKey);
console.log('Config companies:', keys.length);
// This should match the buildRegistry count logged at startup
"
```

#### 5. Fit Check End-to-End Test
Pick one job from the DB and run a full fit check:
```bash
node -e "
const { fitCheckResume } = require('./src/tailor.js');
const Database = require('better-sqlite3');
const db = new Database('data/jobs.db');
const row = db.prepare('SELECT source_key, id FROM seen_jobs WHERE country_code = \"US\" ORDER BY last_seen_at DESC LIMIT 1').get();
if (row) {
  const dirId = (row.source_key + '-' + row.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  fitCheckResume(dirId, console.log).then(r => {
    console.log('Fit check result:', r.shouldApply, '(' + (r.fitAssessment?.length || 0) + 'B)');
  }).catch(e => console.log('Fit check FAILED:', e.message));
}
db.close();
"
```

#### 6. Bot Process Verification
After restarting:
```bash
sleep 10 && grep -a "JobPulse started" data/bot.log && grep -a "error\|Error\|FAIL" data/bot.log | tail -5
```
Check: bot started, no errors in first cycle.

---

### /test
Run after code changes to verify nothing broke. Covers the critical paths.

#### 1. Collector Smoke Test
Run one cycle and check all companies report results:
```bash
node -e "
const { getConfig } = require('./src/config.js');
const config = getConfig();
// Test each ATS platform with one company
const tests = [
  ['greenhouse', 'stripe', () => require('./src/sources/greenhouse.js').collectGreenhouseJobs(null, config, console.log, 'stripe')],
  ['workday', 'nvidia', () => require('./src/sources/workday.js').collectWorkdayJobs(null, config, console.log, 'nvidia')],
  ['ashby', 'openai', () => require('./src/sources/ashby.js').collectAshbyJobs(null, config, console.log, 'openai')],
  ['lever', 'palantir', () => require('./src/sources/lever.js').collectLeverJobs(null, config, console.log, 'palantir')],
  ['smartrecruiters', 'visa', () => require('./src/sources/smartrecruiters.js').collectSmartRecruitersJobs(null, config, console.log, 'visa')],
];
(async () => {
  for (const [platform, company, fn] of tests) {
    try {
      const jobs = await fn();
      console.log(platform + '/' + company + ': ' + jobs.length + ' jobs ' + (jobs.length > 0 ? 'OK' : 'EMPTY'));
    } catch (e) { console.log(platform + '/' + company + ': FAILED - ' + e.message.slice(0, 60)); }
  }
})();
"
```

#### 2. SQLite State Test
```bash
node -e "
const { initDb, hasSeenJobs, getNewJobs, upsertJobs, closeDb } = require('./src/state.js');
initDb('data/jobs.db');
console.log('hasSeenJobs:', hasSeenJobs());
// Test dedup - existing job should not be 'new'
const Database = require('better-sqlite3');
const db = new Database('data/jobs.db');
const existing = db.prepare('SELECT * FROM seen_jobs LIMIT 1').get();
if (existing) {
  const fakeJob = { key: existing.key, sourceKey: existing.source_key, id: existing.id, title: existing.title };
  const newJobs = getNewJobs([fakeJob]);
  console.log('Dedup test:', newJobs.length === 0 ? 'PASS' : 'FAIL (existing job detected as new)');
}
db.close();
closeDb();
"
```

#### 3. Gemini API Test
```bash
node -e "
const key = process.env.GEMINI_API_KEY || require('fs').readFileSync('.env','utf8').match(/GEMINI_API_KEY=(.+)/)?.[1]?.trim();
if (!key) { console.log('No Gemini key'); process.exit(); }
fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+key, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({contents:[{parts:[{text:'Say OK'}]}]})
}).then(r=>r.json()).then(d=>{
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('Gemini API:', text ? 'OK' : 'FAILED');
}).catch(e=>console.log('Gemini API: FAILED -', e.message));
"
```

#### 4. Discord Bot Connection Test
After restart, verify in logs:
```bash
grep -a "Discord bot connected\|Slash commands registered" data/bot.log | tail -2
```

#### 5. Full Pipeline Trace
Watch one complete batch cycle:
```bash
grep -a "batch 1/\|Amazon\|Microsoft\|new job\|Suppressed\|error" data/bot.log | tail -20
```

---

## Automatic Skill Triggers

**IMPORTANT: These skills are NOT optional. They MUST be followed.**

- **Before ANY code edit**: Run `/dev-check` mentally — verify you've read the files, understand the data flow, and checked for ripple effects
- **After adding a company**: Run `/add-company` skill completely — all 12 steps, no shortcuts
- **After ANY code change**: Run `/quality-check` before telling the user to restart
- **After a bug is found**: Run `/audit` on the affected subsystem before fixing — understand the full scope
- **Before git push**: Run `/quality-check` — no pushing broken code
- **Before AWS deployment**: Run `/audit` + `/quality-check` + `/test` — full pipeline verification
- **If user reports an issue**: Run `/audit` on the affected area FIRST, then fix ALL related issues, not just the reported one
