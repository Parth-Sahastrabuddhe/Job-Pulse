# JobPulse

## Project Overview
Real-time job aggregation engine monitoring 105+ companies across 8 ATS platforms with Discord notifications.

## Key Files
- `src/companies.js` — **Central registry** (single source of truth for all companies, URL patterns, fetcher lists)
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

## Bot Management — RUNS ON AWS EC2
- **The bot runs on AWS EC2, NOT locally.** Never start the bot locally unless explicitly asked as a fallback.
- Managed by pm2: `pm2 restart jobpulse` on the EC2 instance
- After code changes: push to GitHub, then SSH into EC2 and `cd ~/Job-Pulse && git pull && pm2 restart jobpulse`
- SSH: `ssh -i <key.pem> ubuntu@<elastic-ip>`
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
