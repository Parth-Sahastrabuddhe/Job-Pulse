---
name: dev-check
description: Pre-flight checklist before any code change in the JobPulse codebase. This skill should trigger automatically before ANY code edit, file modification, or feature implementation — even small fixes. If you're about to use the Edit or Write tool on any source file, run this checklist first. Also trigger when the user says "check before editing", "review before changing", or "what files will this affect". The reason this exists is that JobPulse has tight coupling between 5 files for every company, and changing one without updating the others causes silent failures that only surface when users click buttons in Discord.
---

# Pre-Flight Checklist

JobPulse has a specific architecture where every company is registered in 5 places. Editing one file without checking the others has caused real production bugs — the Goldman Sachs flood, the Accenture non-US spam, the Amazon wrong-description bug, and the Qualcomm/Palantir broken Fit Check all happened because changes were made without checking ripple effects.

## Before touching any file:

1. **Read the files you're about to modify** — never edit a file you haven't read in this session. This prevents editing stale code and introducing merge conflicts with changes made by other agents.

2. **Understand the data flow** — trace how your change affects the pipeline:
   ```
   collector → dedup (state.js) → country filter (shared.js) → freshness filter → description fetch → notification (discord-bot.js)
   ```

3. **Check for ripple effects** — if changing a collector, these files likely also need updates:
   - `src/job-description.js` (description fetcher registration)
   - `src/discord-bot.js` (URL pattern for Fit Check)
   - `src/index.js` (registry array)

4. **Identify the 5 registration points** — every company touches:
   - `src/config.js` (company config)
   - `src/index.js` (registry array in `buildRegistry()`)
   - `src/discord-bot.js` (URL pattern in `JOB_URL_PATTERNS`)
   - `src/job-description.js` (description fetcher list)
   - `src/sources/shared.js` (country detection if needed)

5. **Check for hardcoded values** — search for any hardcoded company names, URLs, or IDs that should be configurable. Hardcoded GraphQL doc IDs (Meta), RPC IDs (Google), and Oracle site numbers are known fragile points.

6. **Verify ESM compatibility** — this project uses ES modules (`"type": "module"` in package.json). Never use `require()` — use `import`. If dynamic import is needed inside a non-async function, restructure to use top-level imports. The `require()` bug in `killOldProcess` caused the Windows taskkill fallback to be dead code for weeks.

7. **Check seniority filter** — if the company uses non-standard seniority titles (banking: VP/SVP/AVP/MD, consulting: Principal/Partner), add them to the `isEntryMidLevelSwe` regex. The JPMorgan bug let VP-level jobs through because only the standard filter was used.

8. **Check ID verification** — if the description fetcher uses a search/list API (not a direct job-by-ID fetch), verify the returned job ID matches the requested one before using the description. The Amazon bug served wrong job descriptions for weeks because `apiData.jobs[0]` was used blindly.
