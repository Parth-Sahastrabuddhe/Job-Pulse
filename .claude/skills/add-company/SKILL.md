---
name: add-company
description: Add a new company to the JobPulse job aggregation pipeline. Use this skill whenever the user mentions adding, integrating, or onboarding a new company, even if they just say a company name like "add Tesla" or "integrate Netflix". Also trigger when the user references the /add Discord command queue, when they ask about companies from the future-scope list, or when they want to expand the pipeline to track more companies. This is a multi-step procedure — never skip steps. Every step must be executed and its output shown to the user.
---

# Add Company to JobPulse Pipeline

Every step below is MANDATORY. Do not skip any step. Do not say "skipping because..." — if a step seems unnecessary, explain why to the user and get explicit approval to skip. The Amazon description bug, the Goldman Sachs flood, the Accenture non-US spam, and the duplicate notification bug all happened from skipping steps.

## Step 1: Identify the ATS Platform

Run these commands and show the results:

- **Greenhouse**: `curl -s -o /dev/null -w "%{http_code}" "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"`
- **Lever**: `curl -s -o /dev/null -w "%{http_code}" "https://api.lever.co/v0/postings/{slug}?mode=json"`
- **Ashby**: `curl -s -o /dev/null -w "%{http_code}" "https://api.ashbyhq.com/posting-api/job-board/{slug}"`
- **SmartRecruiters**: `curl -s "https://api.smartrecruiters.com/v1/companies/{Slug}/postings?limit=1" -H "accept: application/json"`
- **Workday**: Check the [job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator/tree/main/data) workday_companies.json
- **Oracle HCM**: Check if company uses `*.oraclecloud.com/hcmRestApi`
- If none match: check career site HTML for platform clues, try TalentBrew, Eightfold, or Playwright

## Step 2: Verify the API Returns Jobs

Run the API call and show actual job data — not just the status code:

- Greenhouse/Lever/Ashby: show job count AND 2-3 sample titles
- Workday: `curl -s -X POST "{apiUrl}" -H "Content-Type: application/json" -d '{"limit":3,"searchText":"software engineer"}'` — show total and titles
- SmartRecruiters: show `totalFound` and sample titles

## Step 3: Add to Central Registry (`src/companies.js`)

Add ONE entry to the `COMPANIES` array with: key, label, ats, lane, board (if applicable), urlPattern. This automatically registers the URL pattern and description fetcher lists.

## Step 4: Add Config (`src/config.js`)

Each platform has a specific config shape:

- **Greenhouse**: `{ sourceKey, sourceLabel, apiUrl, jobUrlBase }`
- **Workday**: `{ sourceKey, sourceLabel, apiUrl, baseUrl }`
- **Lever**: `{ sourceKey, sourceLabel, apiUrl }`
- **Ashby**: `{ sourceKey, sourceLabel, apiUrl, boardSlug }`
- **SmartRecruiters**: `{ sourceKey, sourceLabel, companySlug }`

## Step 5: Verify Non-US Filtering

Check the company's location data format. If it returns only city names (no country), verify `inferCountryCodeFromLocation` in `src/sources/shared.js` catches them. Add new non-US cities to `NON_US_CITIES` regex if needed. Show the verification output.

## Step 6: Run /quality-check

Invoke the `/quality-check` skill. Every check must pass. If any fail, fix before proceeding. Do NOT skip this step.

## Step 7: Push to GitHub

```bash
git add src/companies.js src/config.js && git commit -m "Add {company names}" && git push origin main
```

## Step 8: Deploy to AWS

The bot runs on AWS EC2, not locally. Deploy with:

```bash
ssh -i <key.pem> ubuntu@<elastic-ip> "cd ~/Job-Pulse && git pull && pm2 restart jobpulse"
```

Verify the bot started with the new company count in the logs.

## Step 9: Verify on AWS

Check AWS logs to confirm the new companies are returning data:

```bash
ssh -i <key.pem> ubuntu@<elastic-ip> "pm2 logs jobpulse --lines 20 --nostream" | grep -i "{company_name}"
```

## What Changed from the Old Process

Previously, adding a company required editing 5 files (config.js, index.js, discord-bot.js, job-description.js, shared.js). Now it requires editing 2 files:

1. `src/companies.js` — the central registry entry (URL pattern + description fetcher registration is automatic)
2. `src/config.js` — the API URL/base URL config

The `index.js`, `discord-bot.js`, and `job-description.js` files auto-derive their lists from `companies.js`. No manual updates needed.
