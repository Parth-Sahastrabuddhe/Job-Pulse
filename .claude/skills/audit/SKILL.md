---
name: audit
description: Full codebase audit for the JobPulse job aggregation pipeline. Use this skill whenever bugs are suspected, after significant code changes, when the user reports unexpected behavior, or when preparing for deployment. Also trigger when the user says "find bugs", "check the code", "audit the codebase", "why is X broken", or "something's wrong with the bot". This is a comprehensive multi-subsystem audit — it checks collectors, description fetchers, Discord bot, SQLite state, and the main batch loop. Run this BEFORE fixing bugs to understand the full scope, not just the symptom.
---

# Full Codebase Audit

This audit covers every subsystem in JobPulse. Run it after significant changes or when bugs are suspected. The goal is to find ALL issues at once rather than fixing one bug only to discover three more.

## Collector Audit

For each file in `src/sources/`, check:

1. **Error handling**: Does the collector catch ALL exceptions and return `[]`? An uncaught error in any collector can crash the entire batch.
2. **API response parsing**: Does it handle null/undefined/empty/malformed responses? APIs change without notice.
3. **Country filtering**: Can non-US jobs slip through? Verify `inferCountry` matches `\bUS\b` (not just `\bUnited States\b` — the Lever bug). Check that `finalizeJob` in shared.js provides the fallback via `inferCountryCodeFromLocation`.
4. **Seniority filtering**: Can senior/staff/VP/SVP/MD/director roles slip through? Banking companies (JPMorgan, Citi, Goldman) need VP/SVP/AVP/MD in the filter.
5. **Job URL correctness**: Will the generated URL actually open the right job page? Open one to verify.
6. **Job ID stability**: Is the ID extracted from a stable field? Workday uses `bulletFields[0]` which may not always be the requisition number.
7. **Function signature**: Does it match `fn(browser, config, log)` or `fn(browser, config, log, key)`?
8. **Playwright cleanup**: Is `browser.close()` in a `finally` block? Leaked browsers accumulate as zombie processes.
9. **Title filter**: Does it use `/software\s+(engineer|develop)/i` (not just `/software\s+engineer/i`)? The PCSX bug missed "Software Developer" titles.

## Description Fetcher Audit (`src/job-description.js`)

1. **Registration completeness** — count and compare:
   - Companies in `GREENHOUSE_BOARDS` vs greenhouse array in `index.js`
   - Companies in `WORKDAY_SOURCES` vs workday array in `index.js`
   - Companies in `ASHBY_SOURCES` AND `ASHBY_BOARDS` vs ashby array in `index.js`
   - Companies in Lever array vs lever array in `index.js`
   - Companies in `SMARTRECRUITERS_SLUGS` vs smartrecruiters array in `index.js`
2. **ID verification**: Does every fetcher that uses a search/list API verify the returned job ID matches? The Amazon bug blindly took `[0]` from unrelated search results.
3. **Playwright cleanup**: Every `chromium.launch()` must have `browser.close()` in a `finally` block.
4. **Null safety**: Can any fetcher crash on null/undefined response data?

## Discord Bot Audit (`src/discord-bot.js`)

1. **URL pattern completeness**: Does EVERY company in the registry have a matching entry in `JOB_URL_PATTERNS`? Missing patterns cause "Could not identify this job" on Fit Check.
2. **Interaction timeout**: Does every handler call `deferUpdate()` or `deferReply()` within 3 seconds?
3. **Error messages**: Does every error path send a user-friendly message? No raw file paths, no stack traces.
4. **Thread safety**: Is there a try/catch around `startThread`? Deleted threads cause unrecoverable errors.

## State Audit (`src/state.js`)

1. **SQL injection**: Are all queries parameterized? (`better-sqlite3` uses `?` params)
2. **Transaction safety**: Are multi-row operations wrapped in `db.transaction()`?
3. **Null handling**: Can `findJobKeyByMessageId` or `updateJobPostStatus` crash on null input?

## Index Audit (`src/index.js`)

1. **Registry count**: Count all companies in `buildRegistry()`. Must match the expected total (currently 88).
2. **Batch loop safety**: Is the entire cycle body wrapped in try/catch?
3. **Timeout coverage**: Do ALL lanes have timeouts? Fast (30s), Normal (30s), Slow (60s).
4. **ESM compliance**: No `require()` anywhere — use `import`.

## Syntax Verification

Run this command — all files must pass:
```bash
for f in src/*.js src/sources/*.js src/notifiers/*.js; do node --check "$f" 2>&1 || echo "FAIL: $f"; done
```
