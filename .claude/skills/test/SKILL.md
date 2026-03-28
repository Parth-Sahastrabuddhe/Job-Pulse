---
name: test
description: Smoke tests for the JobPulse pipeline after code changes. Use this skill after ANY code modification to verify nothing broke — collectors still return data, SQLite dedup works, Gemini API responds, Discord is connected, and the country filter is correct. Also trigger when the user says "run tests", "verify everything works", "did I break anything", "smoke test", or "test the pipeline". These are fast, lightweight checks that catch the most common failures.
---

# Smoke Tests

Quick verification that the critical paths still work after code changes. Each test is independent — if one fails, the others still run. These catch the most common failures: broken collectors, dedup regression, API key issues, and filter bugs.

## 1. Collector Smoke Test

Verify each ATS platform returns jobs by testing one company per platform. This catches broken API endpoints, changed response formats, and import errors:
```bash
node -e "
const { getConfig } = require('./src/config.js');
const config = getConfig();
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

## 2. SQLite Dedup Test

Verify that existing jobs are correctly detected as "not new" — a dedup regression would cause duplicate notifications:
```bash
node -e "
const { initDb, hasSeenJobs, getNewJobs, closeDb } = require('./src/state.js');
initDb('data/jobs.db');
console.log('hasSeenJobs:', hasSeenJobs());
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

## 3. Gemini API Test

Verify the Gemini API key is valid and the model responds. A broken API key means all fit checks fail:
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

## 4. Discord Bot Connection Test

Verify the bot connected and slash commands registered. Check the most recent log:
```bash
grep -a "Discord bot connected\|Slash commands registered" data/bot.log | tail -2
```

## 5. Full Pipeline Trace

Watch one complete batch cycle to verify the collection → filter → notification flow:
```bash
grep -a "batch 1/\|Amazon\|Microsoft\|new job\|Suppressed\|error" data/bot.log | tail -20
```

## 6. Country Filter Test

Verify US and non-US locations are correctly classified. This catches regressions in the shared.js location detection:
```bash
node -e "
const { inferCountryCodeFromLocation } = require('./src/sources/shared.js');
const cases = [
  ['San Francisco, CA', 'US'], ['Bengaluru', 'NON-US'], ['London', 'NON-US'],
  ['Remote, US', ''], ['Tokyo', 'NON-US'], ['Pune', 'NON-US']
];
let ok = 0;
for (const [input, expected] of cases) {
  const got = inferCountryCodeFromLocation(input);
  if (got === expected) ok++; else console.log('FAIL:', input, 'expected', expected, 'got', got);
}
console.log('Country filter:', ok + '/' + cases.length);
"
```
