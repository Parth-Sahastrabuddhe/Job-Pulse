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
   - Ashby: add key to `ASHBY_SOURCES` array
   - Lever: add key to the Lever array in the `fetchJobDescription` switch (line ~417)
   - SmartRecruiters/Oracle HCM/Custom: falls through to universal HTML fallback (no change needed, but verify fit check works)

7. **Verify non-US filtering**: Check that the company's location data contains recognizable US locations or non-US cities. If the API returns only city names (no country), verify `inferCountryCodeFromLocation` in `src/sources/shared.js` catches them. Add new non-US cities to `NON_US_CITIES` regex if needed.

8. **Update docs** in `docs/companies-{platform}.md` and `docs/companies-overview.md`

9. **Syntax check**: `node --check src/config.js && node --check src/index.js && node --check src/discord-bot.js && node --check src/job-description.js`

10. **Ask user** if they want to restart the bot

11. **If restarting**: kill PID from `data/bot.pid`, clean up lock, start fresh, verify with logs

12. **Update `docs/companies-future-scope.md`**: remove the company from the future list
