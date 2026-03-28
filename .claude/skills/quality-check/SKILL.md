---
name: quality-check
description: Mandatory pre-deployment verification for the JobPulse pipeline. This skill MUST run before ANY bot restart, git push, or AWS deployment — no exceptions. Also trigger when the user says "restart the bot", "push the code", "deploy", "is it safe to restart", or "check before pushing". This runs actual test commands against the live database and verifies every subsystem works. If any check fails, do not proceed with deployment — fix the issue first.
---

# Pre-Deployment Quality Check

This is the gate between code changes and production. Every check below must pass before restarting the bot, pushing to GitHub, or deploying to AWS. These checks exist because we've shipped broken code multiple times — wrong descriptions, missing URL patterns, non-US job spam, broken fit checks.

## 1. Syntax Check (All Files)

Every JavaScript file must parse without errors:
```bash
for f in src/*.js src/sources/*.js src/notifiers/*.js; do node --check "$f" 2>&1 || echo "FAIL: $f"; done
```
If ANY file fails, stop and fix before proceeding.

## 2. Description Fetcher Verification

Test that every company with jobs in the DB can fetch a meaningful description. This catches the class of bugs where a company is in the pipeline but its Fit Check is broken:
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
Investigate and fix any failures before deploying.

## 3. Country Filter Verification

Verify that known US and non-US locations are correctly classified:
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

## 4. Registry Count Verification

Verify the number of configured companies matches expectations:
```bash
node -e "
const { getConfig } = require('./src/config.js');
const config = getConfig();
const keys = Object.keys(config).filter(k => config[k]?.sourceKey);
console.log('Config companies:', keys.length);
"
```

## 5. Fit Check End-to-End Test

Run a real fit check against a US job to verify the Gemini API (or Claude CLI fallback) works:
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

## 6. Bot Process Verification

After restarting, verify clean startup with no errors:
```bash
sleep 10 && grep -a "JobPulse started" data/bot.log && grep -a "error\|Error\|FAIL" data/bot.log | tail -5
```
The bot should start with "JobPulse started — tracking N companies" and no error lines in the first cycle.
