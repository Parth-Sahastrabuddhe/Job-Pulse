# JobPulse LinkedIn Scout

Private MV3 browser extension for Parth's 3x/day LinkedIn `#hiring software engineer`
routine. It passively classifies content-search results as you scroll: genuine posts
(hiring managers, engineers, in-house recruiters) get a green badge, junk (staffing
C2C/contract, IT consulting, non-US, no-sponsorship, clearance) gets dimmed with a
reason label, and everything else is left untouched. It also remembers which posts
you've already seen across the day and gives a one-click "Copy lead" for outreach.

**PRIVATE.** Never publish to a store, never include in the public JobPulse mirror
(it is on the exclusion list with the LinkedIn scraper and automation/).

## Passive by design (the never-do list)

The extension only READS what LinkedIn has already rendered and paints on top.
It makes zero network requests, simulates zero clicks/scrolls/keystrokes, and has
no background worker. Never add: auto-scroll, auto-expand, auto-connect, auto-DM,
scheduled/headless runs, or anything that replays your session outside the browser.
That set is what gets accounts restricted; this design keeps the risk near zero.

Honest note: even a passive overlay technically sits outside LinkedIn's user
agreement (automated processing of their pages). Realistic worst case is account
restriction, which is why the passive rule above is absolute.

## Install (Chrome or Edge, Windows)

1. Copy the folder from the server to your machine:
   `scp -r <you>@<csgrad-box>:~/sahastra/work/job-alert-bot/extension ./jobpulse-scout`
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Toggle **Developer mode** on (top right).
4. **Load unpacked** and select the `jobpulse-scout` folder.
5. Pin "JobPulse LinkedIn Scout" to the toolbar.

Updating after a rules tune: DELETE the local folder first, then re-copy
(`scp -r` into an existing folder silently NESTS the new files one level down
and Chrome keeps loading the stale top-level files):

```
Remove-Item -Recurse -Force .\jobpulse-scout
scp -r <you>@<csgrad-box>:/home/csgrad/sahastra/work/job-alert-bot/extension .\jobpulse-scout
```

Then hit the extension's **Reload** button on `chrome://extensions`, confirm the
version number on the card changed, and refresh the LinkedIn tab. The popup
header and the pill's hover tooltip also show the running version.

## First run: calibrate

1. Click the toolbar icon. The popup has **Open today's #hiring search** wired to a
   default URL (content search, `#hiring software engineer`, past 24 hours, latest).
2. If LinkedIn's search page ignores those URL params (they change them
   occasionally): run the search manually once, set Date posted = Past 24 hours and
   Sort by = Latest in the UI, copy the address-bar URL, and paste it into popup
   Settings. That stored URL wins from then on; no code change needed.
3. Treat the first 2-3 sessions as observe-only: scroll normally, don't trust the
   dimming yet, and click any badge/label to see WHY it classified that way
   (extracted fields + matched rules). Send misclassified posts (screenshot or
   copied text) back to Claude; every mistake becomes a test fixture, then a rule
   fix, in that order.

## Daily flow

1. Toolbar icon, then **Open today's #hiring search** (morning / afternoon / night).
2. Scroll like a human. Read what's normal-brightness and green:
   - **Green badge "✓ genuine"**: first-person hiring posts, hiring-manager/engineer
     authors, in-house recruiters at target companies, clean company-page posts.
   - **Dimmed + red "✕" label**: junk, with every reason listed (e.g. "C2C ·
     staffing firm"). Dimmed posts stay readable on purpose; a "consulting firm"
     label at 40% opacity is still findable when you want the sponsorship-insurance
     play (Capgemini etc.).
   - **Untouched**: the classifier isn't sure (includes job-seeker posts). Neutral
     is deliberate; uncertainty must never hide an opportunity.
   - **Gray "seen 9:04 AM" chip + slightly faded**: you scrolled past it in an
     earlier session today. Skip unless you want a second look.
3. On a genuine post, hit **Copy lead**, paste it to Claude. The outreach skill
   drafts the connection note and logs it to outreach/log.md. The button flips to
   "Copied ✓" permanently so you never double-ping someone across sessions.
4. The corner pill shows the session tally. Click it to collapse to a dot.

## When the pill turns orange

- **"no posts parsed; LinkedIn DOM may have changed"**: LinkedIn shipped new markup.
  Fix `SELECTORS` in `src/extract.js` (all selectors live there, nowhere else).
- **"overlay off (repeated errors)"**: something threw more than 20 times; the
  overlay disabled itself rather than degrade your browsing. Check the console
  (filter `[jp-scout]`) and report.

## Correcting the classifier in-page

Every scanned post has a clickable handle: the green/red tag, or a faint `○`
on neutral posts (a post with NO marker at all had no text to classify, e.g.
image-only posts). Click it to open the details popover, which now includes:

- **"This post: [genuine] [junk] [neutral]"**: pin the verdict for that one
  post. Click the active pin again to remove it.
- **"Firm '{name}': [trust all] [block all]"** (when a firm is parseable from
  the author): *block* dims every post from that firm ("your blocklist");
  *trust* removes firm-based junk and treats their recruiters as in-house.
  Trust does NOT whitelist content: a trusted firm's "C2C $60/hr" post still
  dims. Your rules beat the built-in lists; your per-post pins beat everything.

Corrections apply to the whole feed instantly, persist across sessions, and are
managed in the popup's Settings (remove firm rules, clear pins). Each correction
also records a small sample (headline, firm, first 200 chars, old verdict).
**"Copy corrections (JSON)"** in the popup exports everything; paste it to
Claude periodically and the good generalizations get baked into `src/rules.js`
with regression fixtures, keeping your personal list short.

Location scope: US and Canada posts are both allowed; other regions dim as
"non-US location".

## Tuning the classifier

- All rules and lists are data in `src/rules.js`: junk vocab regexes, the staffing
  blocklist, the consulting blocklist, the in-house-recruiter allowlist, non-US
  places, seeker patterns, genuine patterns.
- Workflow, always in this order: add a fixture to `tests/fixtures.json` capturing
  the misclassified post (fails), adjust `src/rules.js` (passes), run tests.
- Debug affordances: click any badge for the popover with extracted fields and
  matched rule ids. Set `localStorage["jp-debug"] = "1"` on linkedin.com to also
  badge neutral posts with "○ neutral".

## Tests

```
node extension/tests/run.mjs   # zero-dep, runs on plain Node 18
```

Covers: every junk/genuine rule in both directions (61 real-shaped fixtures),
normalization (curly quotes, # stripping, unicode dashes, zero-width chars, emoji),
precedence (junk beats genuine, seeker beats genuine), seen-memory timing/prune/
copied-flag, lead format (exact string), search URL builder, and DOM extraction
against a fake-DOM (selector fallback chains, URN fallback hashing, name dedupe,
company-page detection, see-more stripping).

Manual smoke checklist after install or LinkedIn changes:
1. Open the search from the popup; pill appears bottom-left with rising counts.
2. Spot-check three posts: one obvious staffing post is dimmed with reasons, one
   genuine post has a green badge and Copy lead, badge click opens the popover.
3. Expand a truncated post ("…see more"): it re-classifies with the full text.
4. Reload the page: previously scrolled posts show "seen" chips (after 20+ min).

## Privacy

Everything stays in your browser: seen-post memory and config live in
`chrome.storage.local`. Nothing is transmitted anywhere; the only data that ever
leaves is the lead text you explicitly copy to your own clipboard.
