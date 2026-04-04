# JobPulse Multi-User Platform — Design Spec

## Overview

Transform JobPulse from a single-user Discord bot into a multi-user job alert platform. Users sign up via a website (Discord OAuth + email OTP), configure their preferences, and receive personalized job alerts via Discord DM.

**Key constraint:** $0 additional cost. Everything runs on the existing AWS EC2 instance.

---

## Architecture

### Two-Bot Design

The current personal bot (Micro-Bot) stays untouched. A new JobPulse Bot handles multi-user DM delivery. Both share the same job collection engine and SQLite database.

```
Same EC2 Instance
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────────────────────────┐                                │
│  │  Micro-Bot (personal)        │  ← unchanged                  │
│  │  Discord Bot Token A          │                                │
│  │  • #micro-alert channel       │                                │
│  │  • Your SWE filters           │                                │
│  │  • Buttons + threads          │                                │
│  │  • /add, /queue commands      │                                │
│  │  • Receives admin ticket DMs  │                                │
│  └──────────────┬───────────────┘                                │
│                 │                                                 │
│  ┌──────────────▼───────────────┐                                │
│  │  Shared Collection Engine     │  ← runs once, feeds both bots │
│  │  • 120+ company collectors    │                                │
│  │  • Broadened role filter      │                                │
│  │  • Returns all tech/PM jobs   │                                │
│  └──────────────┬───────────────┘                                │
│                 │                                                 │
│  ┌──────────────▼───────────────┐                                │
│  │  JobPulse Bot (multi-user)   │  ← new                         │
│  │  Discord Bot Token B          │                                │
│  │  • Per-user profile filter    │                                │
│  │  • Discord DMs to users       │                                │
│  │  • Buttons (View, Applied,    │                                │
│  │    Skip — no Fit Check yet)   │                                │
│  │  • /search command            │                                │
│  │  • Per-user dedup             │                                │
│  │  • Quiet hours queue          │                                │
│  │  • Digest batching            │                                │
│  └──────────────────────────────┘                                │
│                                                                  │
│  ┌──────────────────────────────┐    ┌──────────────────┐        │
│  │  SQLite (shared jobs.db)     │    │  Next.js Website │        │
│  │                              │    │  (Port 3000)     │        │
│  │  seen_jobs (shared)          │    │                  │        │
│  │  user_profiles               │    │  • Landing page  │        │
│  │  user_seen_jobs              │    │  • Discord OAuth │        │
│  │  h1b_sponsors                │    │  • Email OTP     │        │
│  │  job_posts (personal)        │    │  • Profile setup │        │
│  │  dm_log (multi-user)         │    │  • Dashboard     │        │
│  │  support_tickets             │    │  • Admin panel   │        │
│  │  company_suggestions         │    │  • Ticket form   │        │
│  │  error_log                   │    │                  │        │
│  │  otp_codes                   │    │                  │        │
│  └──────────────────────────────┘    └──────────────────┘        │
│                                                                  │
│  ┌──────────────────────┐                                        │
│  │  Nginx (Port 80/443)  │                                        │
│  └──────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────┘
```

### Process Management

```
pm2 start src/index.js --name micro-bot -- --watch        ← personal bot (unchanged)
pm2 start src/multi-user.js --name jobpulse-bot            ← multi-user bot
pm2 start next-app/server.js --name jobpulse-web           ← website
```

---

## Features

### Core (MVP)

| Feature | Description |
|---------|-------------|
| **Open signup with email OTP** | Discord OAuth for identity, AWS SES OTP for verification. No invite codes. |
| **Company selection at onboarding** | Grouped, searchable company list. "Select All" default. DM notification when new companies are added. |
| **Per-user role/seniority filtering** | Each user picks role categories and seniority levels. Filtering happens post-collection. |
| **Country + sponsorship filter** | Per-user country selection and H1B sponsorship toggle. |
| **Real-time Discord DMs** | Personalized job alerts sent as DMs with View Job, Applied, Skip buttons. |
| **Digest mode** | Alternative to real-time. Daily or weekly summary of matched jobs. |
| **Quiet hours** | Per-user timezone + time window. Jobs queued during quiet hours, delivered when window ends. |
| **Application tracker** | Web dashboard showing per-job status: Applied, Skipped, Interviewing, Offer, Rejected. Discord buttons feed into it. |
| **`/search` command** | Search past job notifications by company, title, status. Paginated embeds. |
| **Support tickets** | Website form for bug reports, feature requests. Admin notified via Discord DM + email. |
| **Admin panel** | User management, system health, error log, DM delivery log, ticket management, company suggestions. |
| **Personalized messaging** | First name collected at signup, used in DMs ("Hey Alex, ..."). |

### Deferred

| Feature | Notes |
|---------|-------|
| **Multi-provider fit check** | Support Gemini, OpenAI, Claude, DeepSeek. Per-user API key. Build after MVP. |
| **Job expiry alerts** | Notify when bookmarked jobs are taken down. Future scope. |

---

## User Onboarding Flow

```
User visits jobpulse.app
        │
        ▼
  Landing page — "Get personalized job alerts from 120+ companies"
        │
        ▼
  "Login with Discord" → Discord OAuth → get Discord ID + username
        │
        ▼
  "Enter your name and email"
  ├── First name (for personalized DMs)
  └── Email address
        │
        ▼
  AWS SES sends 6-digit OTP → 5-minute expiry
        │
        ▼
  User enters OTP → email verified
        │
        ▼
  Profile setup:
  ├── Role categories (multi-select checkboxes)
  │   ├── Software Engineer
  │   ├── Data Engineer
  │   ├── ML / AI Engineer
  │   ├── Frontend Engineer
  │   ├── Backend Engineer
  │   ├── DevOps / SRE
  │   ├── Product Manager
  │   └── Mobile Engineer (iOS / Android)
  │
  ├── Seniority levels (multi-select)
  │   ├── Intern
  │   ├── Entry Level (0-2 years)
  │   ├── Mid Level (2-5 years)
  │   ├── Senior (5+ years)
  │   └── Staff / Principal
  │
  ├── Country (dropdown, default: US)
  │
  ├── Requires visa sponsorship (toggle)
  │
  ├── Companies to track
  │   ├── [x] Select All (120 companies)
  │   ├── Search: [______________]
  │   ├── ▼ Big Tech (6): Amazon, Apple, Google, Meta, Microsoft, Netflix
  │   ├── ▼ Finance (14): Capital One, JPMorgan, Goldman Sachs, ...
  │   ├── ▼ Enterprise / Cloud (18): Cisco, Salesforce, Oracle, ...
  │   ├── ▼ Startups / Growth (22): Stripe, Figma, Notion, ...
  │   └── ... (grouped by category)
  │
  ├── Notification mode
  │   ├── Real-time DM (instant, default)
  │   ├── Daily digest (8am user's timezone)
  │   └── Weekly digest (Monday 8am)
  │
  └── Quiet hours (optional)
      ├── Start: [22:00]
      ├── End: [08:00]
      └── Timezone: [America/New_York ▼]
        │
        ▼
  [Save Profile] → Active, starts receiving alerts
```

---

## Database Schema

### New Tables

```sql
-- User profiles
CREATE TABLE user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT UNIQUE NOT NULL,
  discord_username TEXT NOT NULL,
  first_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  email_verified BOOLEAN DEFAULT 0,
  role_categories TEXT NOT NULL,             -- JSON: ["software_engineer", "data_engineer"]
  seniority_levels TEXT NOT NULL,            -- JSON: ["entry", "mid"]
  company_selections TEXT DEFAULT '["all"]', -- JSON: ["all"] or ["stripe", "google", ...]
  country TEXT DEFAULT 'US',
  requires_sponsorship BOOLEAN DEFAULT 0,
  notification_mode TEXT DEFAULT 'realtime', -- realtime | daily | weekly
  quiet_hours_start TEXT DEFAULT NULL,       -- "22:00"
  quiet_hours_end TEXT DEFAULT NULL,         -- "08:00"
  quiet_hours_tz TEXT DEFAULT 'America/New_York',
  is_active BOOLEAN DEFAULT 1,
  role TEXT DEFAULT 'user',                 -- user | admin
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Per-user job dedup + application tracking
CREATE TABLE user_seen_jobs (
  user_id INTEGER NOT NULL,
  job_key TEXT NOT NULL,
  status TEXT DEFAULT 'notified',           -- notified | applied | skipped | interviewing | offer | rejected
  notified_at TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (user_id, job_key),
  FOREIGN KEY (user_id) REFERENCES user_profiles(id)
);

-- H1B sponsor lookup
CREATE TABLE h1b_sponsors (
  company_key TEXT PRIMARY KEY,
  company_name TEXT NOT NULL,
  sponsors_h1b BOOLEAN DEFAULT 1,
  lca_count INTEGER DEFAULT 0,
  avg_salary INTEGER DEFAULT 0
);

-- Email OTP verification
CREATE TABLE otp_codes (
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used BOOLEAN DEFAULT 0,
  created_at TEXT NOT NULL
);

-- DM delivery log
CREATE TABLE dm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_key TEXT NOT NULL,
  status TEXT DEFAULT 'sent',               -- sent | failed | queued | paused
  sent_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES user_profiles(id)
);

-- Error log
CREATE TABLE error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT,
  error_message TEXT,
  occurred_at TEXT NOT NULL
);

-- Company suggestions from users
CREATE TABLE company_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  careers_url TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',            -- pending | approved | rejected
  admin_response TEXT DEFAULT '',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user_profiles(id)
);

-- Support tickets
CREATE TABLE support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,                   -- bug | missing_jobs | feature_request | other
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open',               -- open | in_progress | resolved | closed
  admin_response TEXT DEFAULT '',
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES user_profiles(id)
);
```

### Modified Tables

```sql
-- seen_jobs gets a new column for seniority detection
ALTER TABLE seen_jobs ADD COLUMN seniority_level TEXT DEFAULT 'mid';
-- Values: intern | entry | mid | senior | staff
```

### Existing Tables (unchanged)

- `job_posts` — personal bot message tracking
- `meta` — metadata key-value store
- `company_queue` — /add command queue

---

## Collector Refactor

### Current State

`isTargetRole()` in `src/sources/shared.js` only matches SWE titles and excludes senior/intern:

```
ROLE_PATTERN: software engineer|backend|full-stack|platform|SDE|SWE|MTS
SENIORITY_EXCLUDE: senior|principal|staff|lead|intern
```

### New State

Broaden to match all supported role categories, remove seniority exclusion (seniority filtering moves to per-user):

```
EXPANDED_ROLE_PATTERN:
  software engineer|backend|full-stack|platform|SDE|SWE|MTS|AMTS      (SWE)
  |data engineer|data platform|analytics engineer|ETL                  (Data Eng)
  |machine learning|ML engineer|AI engineer|deep learning              (ML/AI)
  |frontend|front-end|UI engineer|web developer                        (Frontend)
  |devops|SRE|site reliability|infrastructure                          (DevOps/SRE)
  |iOS|Android|mobile engineer|React Native|Flutter                    (Mobile)
  |product manager|program manager|TPM                                 (PM)

NO SENIORITY EXCLUSION AT COLLECTION TIME
```

Seniority is detected per-job and stored, then matched against each user's `seniority_levels` preference at notification time.

### Seniority Detection

| Level | Detected By |
|-------|------------|
| `intern` | intern, internship, co-op |
| `entry` | new grad, entry level, junior, I, 1, associate |
| `mid` | II, 2, mid, or NO seniority indicator (default) |
| `senior` | senior, sr., III, 3, lead |
| `staff` | staff, principal, distinguished, fellow, architect |

Detection result stored in `seen_jobs` (new column: `seniority_level`).

---

## Per-User Filtering & Delivery

### Filter Pipeline

```
New job collected (all tech/PM roles, all seniority levels)
        │
        ▼
  Upsert to seen_jobs (shared, with seniority_level)
        │
        ▼
  For each active user_profile:
  │
  ├── 1. Company filter
  │   └── user.company_selections includes job.source_key OR is ["all"]
  │
  ├── 2. Role category match
  │   └── job title matches at least one pattern from user.role_categories
  │
  ├── 3. Seniority match
  │   └── job.seniority_level is in user.seniority_levels
  │
  ├── 4. Country match
  │   └── job.country_code matches user.country
  │
  ├── 5. Sponsorship check
  │   └── if user.requires_sponsorship: h1b_sponsors.sponsors_h1b = true for job.source_key
  │
  ├── 6. Per-user dedup
  │   └── job_key NOT IN user_seen_jobs for this user_id
  │
  └── All pass? → queue for delivery
        │
        ▼
  Delivery routing:
  │
  ├── notification_mode = "realtime"
  │   ├── Currently in quiet hours? → insert into dm_log with status "queued"
  │   └── Not in quiet hours? → send DM immediately, log as "sent"
  │
  ├── notification_mode = "daily"
  │   └── Queue → deliver at 8:00 AM user's timezone
  │
  └── notification_mode = "weekly"
      └── Queue → deliver Monday 8:00 AM user's timezone
```

### DM Format

**Real-time DM (single job):**
```
┃ Stripe
┃ Data Infrastructure Engineer
┃ San Francisco, CA
┃ Posted: 3/28/2026

[View Job] [Applied] [Skip]
```

**Digest DM (batched jobs):**
```
Hey Alex, here are your job matches for today (12 new jobs):

1. Stripe — Data Infrastructure Engineer — San Francisco, CA
2. Google — ML Engineer II — Mountain View, CA
3. Meta — Backend Engineer — New York, NY
... (up to 20 per digest)

View all on your dashboard: jobpulse.app/dashboard
```

**New company notification:**
```
Hey Alex, we just added Tesla to JobPulse!
Update your company preferences to include it: jobpulse.app/profile
```

### Rate Limiting

Discord allows 5 DMs per second globally per bot. At 50 users with 10 jobs each = 500 DMs = ~100 seconds. Acceptable. At 200+ users, implement a queue with backoff.

---

## Role Category to Title Matching

| Category | Regex Pattern |
|----------|--------------|
| `software_engineer` | `software (engineer\|developer)\|full[\s-]?stack\|platform engineer\|SDE\|SWE\|MTS\|AMTS` |
| `data_engineer` | `data engineer\|data platform\|analytics engineer\|ETL\|data infrastructure` |
| `ml_engineer` | `machine learning\|ML engineer\|AI engineer\|deep learning\|NLP\|computer vision` |
| `frontend` | `frontend\|front-end\|UI engineer\|web developer\|React\|Angular\|Vue` |
| `backend` | `backend\|back-end\|server engineer\|API engineer` |
| `devops_sre` | `devops\|SRE\|site reliability\|infrastructure\|platform\|cloud engineer` |
| `mobile` | `iOS\|Android\|mobile engineer\|React Native\|Flutter\|Swift\|Kotlin` |
| `product_manager` | `product manager\|program manager\|TPM\|technical program` |

---

## `/search` Slash Command

### Usage

Users DM the JobPulse Bot:

```
/search query:stripe data engineer
/search company:google
/search status:applied
/search days:7
```

### Response Format

```
┌──────────────────────────────────────────────────────┐
│  Search Results: "stripe data engineer"              │
│  Found 7 matching jobs                               │
│                                                      │
│  1. Stripe — Data Infrastructure Engineer            │
│     San Francisco, CA · Posted: 3/28/2026            │
│     Status: Applied                                  │
│                                                      │
│  2. Stripe — Senior Data Engineer                    │
│     New York, NY · Posted: 3/25/2026                 │
│     Status: Skipped                                  │
│                                                      │
│  3. Stripe — Data Platform Engineer                  │
│     Seattle, WA · Posted: 3/22/2026                  │
│     Status: Pending                                  │
│                                                      │
│  [Prev]  Page 1/3  [Next]                            │
└──────────────────────────────────────────────────────┘
```

### Implementation

- Query: `SELECT * FROM user_seen_jobs JOIN seen_jobs ON ... WHERE user_id = ? AND (title LIKE ? OR source_label LIKE ?)`
- Scoped to the requesting user's `user_seen_jobs` only
- 5 results per page, Prev/Next buttons with stateless pagination via `customId` encoding
- Default: last 30 days. Configurable with `days:` parameter
- Company name autocomplete via Discord slash command autocomplete API

---

## Application Tracker (Web Dashboard)

### `/dashboard` Page

```
┌──────────────────────────────────────────────────────────┐
│  My Applications                    [Filter ▼] [Sort ▼] │
│                                                          │
│  │ Company    │ Role             │ Status        │ Date  │
│  │ Stripe     │ Data Eng         │ 🟢 Applied    │ 3/28  │
│  │ Google     │ SWE II           │ 🔵 Interviewing│ 3/15 │
│  │ Meta       │ SWE              │ ⚪ Skipped     │ 3/20  │
│  │ Coinbase   │ Backend Eng      │ 🟡 Offer       │ 3/10  │
│  │ Uber       │ Platform Eng     │ 🔴 Rejected    │ 3/05  │
│                                                          │
│  Filters: All | Applied | Interviewing | Offer | ...     │
│  Sort: Date | Company | Status                           │
│                                                          │
│  Click any row to update status or view job details      │
└──────────────────────────────────────────────────────────┘
```

### Status Flow

```
Job DM received → "notified"
        │
        ├── User clicks "Applied" button on Discord → "applied"
        ├── User clicks "Skip" button on Discord → "skipped"
        │
        └── User updates on web dashboard:
            ├── → "interviewing"
            ├── → "offer"
            └── → "rejected"
```

Statuses: `notified`, `applied`, `skipped`, `interviewing`, `offer`, `rejected`

---

## Support Tickets

### User-Facing Form (`/support` page)

```
┌────────────────────────────────────────┐
│  Report an Issue                       │
│                                        │
│  Category: [Bug ▼]                     │
│    • Bug (something's broken)          │
│    • Missing jobs (company not working) │
│    • Feature request                   │
│    • Other                             │
│                                        │
│  Description:                          │
│  [________________________________]    │
│  [________________________________]    │
│                                        │
│  [Submit]                              │
│                                        │
│  Your recent tickets:                  │
│  #12 — Missing Stripe jobs — Resolved  │
│  #14 — Add Tesla — Pending             │
└────────────────────────────────────────┘
```

### Admin Notification

When a ticket is submitted:
1. **Discord DM to admin** (via Micro-Bot): *"New support ticket from Alex — Category: Bug — 'Not receiving Stripe jobs since yesterday'"*
2. **Email to admin** (via AWS SES): same content as fallback

### Admin Panel View

Admin can view all tickets, respond, update status (open → in_progress → resolved → closed). User sees admin response on their `/support` page.

---

## Company Suggestions

Users can suggest companies via the website profile page:

```
┌────────────────────────────────────────┐
│  Suggest a Company                     │
│                                        │
│  Company Name: [________________]      │
│  Careers URL:  [________________]      │
│  Why:          [________________]      │
│                                        │
│  [Submit Suggestion]                   │
│                                        │
│  Your suggestions:                     │
│  • Tesla — Pending                     │
│  • Netflix — Approved, now tracking!   │
└────────────────────────────────────────┘
```

Admin reviews in admin panel, approves or rejects. User is notified when their suggestion is approved and the company is added.

---

## Website Pages

| Page | Access | Purpose |
|------|--------|---------|
| `/` | Public | Landing page — what JobPulse is, "Login with Discord" |
| `/auth/callback` | System | Discord OAuth callback, email OTP verification |
| `/profile` | Authenticated | Profile setup and editing, company selection, notification prefs |
| `/dashboard` | Authenticated | Application tracker, recent matched jobs |
| `/support` | Authenticated | Submit tickets, view ticket history and responses |
| `/admin` | Admin only | User management, system health, errors, DM log, tickets, company suggestions |

---

## Admin Panel

### Capabilities

| Feature | Description |
|---------|-------------|
| **User management** | View all users, edit profiles, pause/resume, delete |
| **System health** | Scraper status per company, last success time, error counts |
| **Error log** | Recent scraper errors, API failures, rate limits |
| **DM delivery log** | Which DMs sent, to whom, for which job, success/failure |
| **Support tickets** | View, respond, update status |
| **Company suggestions** | Review, approve/reject user suggestions |
| **Company management** | Add/remove companies without restarting the bot |

### Admin Auth

Admin identified by Discord user ID (hardcoded or `role = 'admin'` in `user_profiles`). Same Discord OAuth login — website checks role after login.

---

## Tech Stack

| Component | Technology | Cost |
|-----------|-----------|------|
| Job Collector | Node.js (existing) | $0 |
| Database | SQLite (existing `jobs.db`) | $0 |
| Website | Next.js | $0 |
| Auth | Discord OAuth2 | $0 |
| Email OTP | AWS SES (from EC2, 62k/month free) | $0 |
| DM Delivery | discord.js `user.send()` | $0 |
| Hosting | Same EC2 instance | $0 |
| Process mgmt | pm2 (3 processes) | $0 |
| Reverse proxy | Nginx + Let's Encrypt SSL | $0 |
| Domain | Optional | $0-10/yr |

**Total: $0-10/year**

---

## Implementation Phases

| # | Phase | Description |
|---|-------|-------------|
| 1 | **Refactor collectors** | Broaden `isTargetRole()` to all supported role categories. Add seniority detection. Collectors return all tech/PM jobs at all levels. |
| 2 | **User profiles + per-user filtering** | New DB tables (`user_profiles`, `user_seen_jobs`, `h1b_sponsors`). Per-user filter engine matching role, seniority, country, sponsorship, company selection. |
| 3 | **Discord DM delivery** | New JobPulse Bot process. Per-user DMs with embeds + buttons. Quiet hours queue. Digest batching (daily/weekly). |
| 4 | **Next.js website** | Landing page. Discord OAuth + email OTP (AWS SES). Profile setup with company selection. Application tracker dashboard. Support ticket form. |
| 5 | **Admin panel** | User management, system health, error log, DM delivery log, ticket management, company suggestions review. Admin notifications (Discord DM + email). |
| 6 | **`/search` command** | Slash command on multi-user bot with paginated results and autocomplete. |
| 7 | **Deploy** | Nginx reverse proxy, Let's Encrypt SSL, pm2 config for 3 processes, domain setup. |

---

## Scaling

| Users | Infrastructure | Database | DM Rate |
|-------|---------------|----------|---------|
| 1-50 | Same EC2 | SQLite | ~1 DM/sec, no issues |
| 50-200 | Same EC2 | SQLite | ~5 DMs/sec, add queue |
| 200-1000 | Upgrade EC2 | Supabase/Postgres | DM queue + rate limiter |
| 1000+ | Separate instances | Managed Postgres | Worker queue (Bull/Redis) |

---

## Deferred Features

| Feature | Notes |
|---------|-------|
| **Multi-provider fit check** | Gemini, OpenAI, Claude, DeepSeek. Per-user API key + model selection. Build after core platform is stable. |
| **Job expiry alerts** | Track when postings are removed, notify users who bookmarked them. |
| **Salary insights** | Surface H1B LCA salary data in job embeds. |
| **Referral network** | Users flag themselves as referral contacts at their company. |
| **Email digest delivery** | Currently Discord-only. Email as alternative delivery channel. |
| **Monetization** | $1-5/year subscription, BOGO invite codes, Stripe integration. After product-market fit. |

---

*Spec created: 2026-04-03*
*Based on: docs/multi-user-platform.md + conversation refinements*
