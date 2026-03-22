# JobPulse

Real-time job aggregation engine that monitors 60+ companies across 8 ATS platforms and delivers interactive notifications via Discord.

## What It Does

- Polls career pages from 60+ companies every 15 seconds
- Detects new software engineering job postings within minutes of publication
- Sends Discord notifications with interactive buttons (View Job, Fit Check, Applied, Skip)
- Auto-creates discussion threads per job for fit assessments
- Tracks application status in SQLite with full history
- Filters by seniority level, location (US), and job description keywords

## Supported Platforms

| Platform | Companies | Method |
|----------|-----------|--------|
| Greenhouse | Stripe, Databricks, Figma, Airbnb, DoorDash, Reddit, + 16 more | REST API |
| Workday | Nvidia, Adobe, Intel, PayPal, Samsung, Broadcom, + 6 more | REST API |
| Ashby | OpenAI, Notion, Ramp, Snowflake, Cursor, + 2 more | REST API |
| Lever | Palantir, Plaid, Spotify, + 2 more | REST API |
| SmartRecruiters | ServiceNow, Visa | REST API |
| Oracle HCM | Oracle, JPMorgan Chase | REST API |
| Custom API | Amazon, Microsoft, Google, Meta, Goldman Sachs | Reverse-engineered APIs |
| Custom Scraper | Apple, LinkedIn, Intuit, Bloomberg | HTML parsing |
| Playwright | Uber, Confluent | Headless browser |

## Discord Features

- **Embed notifications** with company, title, location, posted date
- **Interactive buttons:** View Job, Fit Check, Applied, Skip
- **Auto-threads** per job for discussion
- **Applied confirmation** prevents accidental clicks
- **Button state** updates visually after action (skip is reversible, applied is final)
- **`/add <company>`** slash command to queue companies for integration
- **`/queue`** shows pending companies in the queue

## Setup

1. Clone the repo and install dependencies:
```bash
npm install
npx playwright install --with-deps chromium
```

2. Copy `.env.example` to `.env` and fill in your Discord bot token and channel ID.

3. Seed the database (first run — no notifications):
```bash
npm run seed
```

4. Start the bot:
```bash
npm run watch
```

## Commands

```bash
npm run seed              # First run — populate DB without notifications
npm run watch             # Start polling with Discord bot
npm run dry-run           # Test run — no DB writes, no notifications
npm start                 # Single poll cycle
```

## Architecture

- **Collectors** (`src/sources/`) — one per ATS platform, all return standardized job objects
- **State** (`src/state.js`) — SQLite-backed with migration from legacy JSON
- **Discord Bot** (`src/discord-bot.js`) — buttons, threads, slash commands, interaction handlers
- **Filters** (`src/jd-filter.js`) — keyword-based job description screening
- **Fit Check** (`src/tailor.js`) — AI-powered resume-to-JD fit assessment
