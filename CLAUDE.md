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

## Mandatory Skill Triggers

**These are NOT optional. They MUST be followed.**

- **Before ANY code edit**: Run `/dev-check` — verify you've read the files, understand the data flow, and checked for ripple effects
- **After adding a company**: Run `/add-company` skill completely — all 12 steps, no shortcuts
- **After ANY code change**: Run `/quality-check` before telling the user to restart
- **After a bug is found**: Run `/audit` on the affected subsystem before fixing — understand the full scope
- **Before git push**: Run `/quality-check` — no pushing broken code
- **Before AWS deployment**: Run `/audit` + `/quality-check` + `/test` — full pipeline verification
- **If user reports an issue**: Run `/audit` on the affected area FIRST, then fix ALL related issues, not just the reported one
