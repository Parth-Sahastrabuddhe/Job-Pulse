---
name: add-company
description: Add a new company to the JobPulse job aggregation pipeline. Use this skill whenever the user mentions adding, integrating, or onboarding a new company, even if they just say a company name like "add Tesla" or "integrate Netflix". Also trigger when the user references the /add Discord command queue, when they ask about companies from the future-scope list, or when they want to expand the pipeline to track more companies. This is a multi-step procedure — never skip steps.
---

# Add Company to JobPulse Pipeline

Every step is MANDATORY. Do not skip any. Past bugs (Amazon descriptions, Goldman floods, Accenture non-US spam) all came from skipped steps.

## Step 1: Identify the ATS Platform

Test these in order, show status codes:

- **Greenhouse**: `curl -s -o /dev/null -w "%{http_code}" "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"`
- **Lever**: `curl -s -o /dev/null -w "%{http_code}" "https://api.lever.co/v0/postings/{slug}?mode=json"`
- **Ashby**: `curl -s -o /dev/null -w "%{http_code}" "https://api.ashbyhq.com/posting-api/job-board/{slug}"`
- **SmartRecruiters**: `curl -s "https://api.smartrecruiters.com/v1/companies/{Slug}/postings?limit=1"`
- **Workday**: Check [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator/tree/main/data) workday_companies.json
- **Oracle HCM**: Check if company uses `*.oraclecloud.com/hcmRestApi`
- If none match: inspect career site HTML for platform clues, consider Playwright scraper

## Step 2: Verify the API Returns Jobs

Show actual job data (count + 2-3 sample titles), not just status codes.

## Step 3: Add to Central Registry (`src/companies.js`)

Add ONE entry to the `COMPANIES` array: `{ key, label, ats, lane, board, urlPattern }`. This auto-registers URL patterns and description fetchers — no other files need manual list updates.

## Step 4: Add Config (`src/config.js`)

Platform-specific config shapes:

| Platform | Fields |
|----------|--------|
| Greenhouse | `sourceKey, sourceLabel, apiUrl, jobUrlBase` |
| Workday | `sourceKey, sourceLabel, apiUrl, baseUrl` |
| Lever | `sourceKey, sourceLabel, apiUrl` |
| Ashby | `sourceKey, sourceLabel, apiUrl, boardSlug` |
| SmartRecruiters | `sourceKey, sourceLabel, companySlug` |

Solo/Playwright scrapers also need an import + entry in `buildRegistry()` in `src/index.js`.

## Step 5: Verify Non-US Filtering

Check location data format. If the company returns city-only locations (no country), verify `inferCountryCodeFromLocation` in `src/sources/shared.js` catches them. Add new non-US cities to `NON_US_CITIES` if needed.

## Step 6: Verify Seniority & Role Classification

Test that sample job titles from the new company are classified correctly:

```bash
node -e "
import { detectSeniority, detectRoleCategories } from './src/sources/shared.js';
const titles = ['<paste 3-4 sample titles>'];
for (const t of titles) console.log(detectSeniority(t), detectRoleCategories(t), '←', t);
"
```

This matters for the multi-user bot (JobPulseBot) — jobs are filtered by seniority and role category per user profile. If titles don't classify correctly, users won't receive them.

## Step 7: Run Quality Check

Invoke the `/quality-check` skill. Every check must pass before proceeding.

## Step 8: Run Verification

Invoke `/verification-before-completion` — run `npm run check`, then `--dry-run` to confirm the new company returns data and no existing collectors break.

## Step 9: Push & Deploy

```bash
git add src/companies.js src/config.js && git commit -m "Add {company}" && git push origin main
```

Deploy to AWS EC2 (bots run there, NEVER locally):

```bash
ssh -i "C:\Users\sahas\job-alert-bot\data\jobpulse.pem" -o StrictHostKeyChecking=no ubuntu@3.138.62.29 \
  "cd ~/Job-Pulse && git pull && pm2 restart micro-bot jobpulse-mu"
```

Restart both `micro-bot` and `jobpulse-mu` so both bots pick up the new company. Do NOT touch `jobpulse-web`.

## Step 10: Verify on AWS

Check logs to confirm the new company returns data:

```bash
ssh -i "C:\Users\sahas\job-alert-bot\data\jobpulse.pem" -o StrictHostKeyChecking=no ubuntu@3.138.62.29 \
  "pm2 logs jobpulse-mu --lines 30 --nostream" | grep -i "{company}"
```

## Superpowers Skills Referenced

- `/quality-check` — Step 7, mandatory pre-deployment checks
- `/verification-before-completion` — Step 8, syntax + dry-run before push
- `/systematic-debugging` — use if any step fails unexpectedly (API errors, classification bugs, deploy issues)

## Files Changed Summary

| ATS type | Files to edit |
|----------|--------------|
| Parameterized (greenhouse, workday, ashby, lever, smartrecruiters) | `src/companies.js` + `src/config.js` (2 files) |
| Solo/Playwright scrapers | `src/companies.js` + `src/config.js` + `src/index.js` + new `src/sources/{company}.js` (3-4 files) |
