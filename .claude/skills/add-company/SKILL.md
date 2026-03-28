---
name: add-company
description: Add a new company to the JobPulse job aggregation pipeline. Use this skill whenever the user mentions adding, integrating, or onboarding a new company, even if they just say a company name like "add Tesla" or "integrate Netflix". Also trigger when the user references the /add Discord command queue, when they ask about companies from the future-scope list, or when they want to expand the pipeline to track more companies. This is a multi-step procedure touching 5+ files — never skip steps.
---

# Add Company to JobPulse Pipeline

Adding a company to JobPulse is a multi-file operation. Every company must be registered in 5 places, and skipping any one causes silent failures (broken Fit Check, missing descriptions, non-US jobs leaking through). This checklist exists because we learned the hard way — the Amazon description bug, the Goldman Sachs flood, the Accenture non-US spam all happened from skipping steps.

## Step 1: Identify the ATS Platform

Try these in order — most companies use one of the first four:

- **Greenhouse**: `curl -s -o /dev/null -w "%{http_code}" "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"`
- **Lever**: `curl -s -o /dev/null -w "%{http_code}" "https://api.lever.co/v0/postings/{slug}?mode=json"`
- **Ashby**: `curl -s -o /dev/null -w "%{http_code}" "https://api.ashbyhq.com/posting-api/job-board/{slug}"`
- **SmartRecruiters**: `curl -s "https://api.smartrecruiters.com/v1/companies/{Slug}/postings?limit=1" -H "accept: application/json"`
- **Workday**: Check `docs/companies-future-scope.md` for verified tenant/instance/site, or search the [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator/tree/main/data) workday_companies.json
- **Oracle HCM**: Check if company uses `*.oraclecloud.com/hcmRestApi`
- If none match: check career site HTML for platform clues, try TalentBrew, Eightfold, or Playwright

## Step 2: Verify the API Returns Jobs

Don't assume a 200 status means it works — verify actual job data comes back:

- Greenhouse/Lever/Ashby: confirm 200 status AND jobs array is non-empty
- Workday: `curl -s -X POST "{apiUrl}" -H "Content-Type: application/json" -d '{"limit":3,"searchText":"software engineer"}'` — check `total > 0`
- SmartRecruiters: check `totalFound > 0`

## Step 3: Add Config (`src/config.js`)

Each platform has a specific config shape:

- **Greenhouse**: `{ sourceKey, sourceLabel, apiUrl, jobUrlBase }`
- **Workday**: `{ sourceKey, sourceLabel, apiUrl, baseUrl }`
- **Lever**: `{ sourceKey, sourceLabel, apiUrl }`
- **Ashby**: `{ sourceKey, sourceLabel, apiUrl, boardSlug }`
- **SmartRecruiters**: `{ sourceKey, sourceLabel, companySlug }`

## Step 4: Add to Registry (`src/index.js`)

In `buildRegistry()`, add the key to the matching platform array (greenhouse, workday, lever, ashby, smartrecruiters). If custom scraper: create `src/sources/{company}.js`, import it, add `solo()` or `param()` call.

## Step 5: Add URL Pattern (`src/discord-bot.js`)

Add an entry to the `JOB_URL_PATTERNS` array so the Fit Check button can identify the company's jobs. Without this, clicking Fit Check shows "Could not identify this job."

## Step 6: Register Description Fetcher (`src/job-description.js`)

This is where the Amazon bug lived — if you skip this, Fit Check either fails or uses a wrong job's description:

- **Greenhouse**: add key+slug to `GREENHOUSE_BOARDS` object
- **Workday**: add key to `WORKDAY_SOURCES` array
- **Ashby**: add key to `ASHBY_SOURCES` array AND `ASHBY_BOARDS` object
- **Lever**: add key to the Lever array in `fetchJobDescription`
- **SmartRecruiters**: add key to `SMARTRECRUITERS_SLUGS` object AND the SmartRecruiters array in `fetchJobDescription`
- **Oracle HCM/Custom**: verify fit check works end-to-end with a real job

## Step 7: Verify Non-US Filtering

Check the company's location data format. If it returns only city names (no country), verify `inferCountryCodeFromLocation` in `src/sources/shared.js` catches them. Add new non-US cities to `NON_US_CITIES` regex if needed. The Accenture bug happened because "Bengaluru" wasn't in the list.

## Step 8: Update Docs

Update `docs/companies-{platform}.md` and `docs/companies-overview.md`.

## Step 9: Run /quality-check

Mandatory. No exceptions. This catches the bugs you just introduced.

## Step 10: Ask User About Restart

Always ask — never restart automatically.

## Step 11: If Restarting

Kill PID from `data/bot.pid` using `taskkill /F /T /PID`, clean up lock, start fresh, verify with logs. Only kill the bot PID — never kill all node processes (user runs another bot).

## Step 12: Update Future Scope

Remove the company from `docs/companies-future-scope.md`.
