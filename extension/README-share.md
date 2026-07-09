# LinkedIn Scout

A small private Chrome/Edge extension for job seekers who need visa sponsorship.
While you scroll LinkedIn's `#hiring` search results, it highlights posts worth
your time and dims the ones that aren't, right in the page:

- **Green badge "✓ genuine"**: first-person hiring posts (hiring managers,
  team leads, engineers offering referrals), in-house recruiters at product
  companies, and clean company-page posts.
- **Dimmed with a red "✕" label**: staffing/C2C/contract posts, IT-consulting
  bulk posts, non-US/Canada locations, and (by design, since we need
  sponsorship) posts saying "no sponsorship / USC-GC only" or requiring a
  security clearance. Every dimmed post shows WHY. Nothing is ever hidden.
- **Faint "○"**: scanned, but the classifier isn't sure. Left untouched.
- **"seen 9:04 AM" chip**: you already scrolled past this post earlier today,
  so later sessions are new-stuff-only reading.
- **Copy lead** on genuine posts puts a clean text block (name, headline,
  profile URL, post text) on your clipboard, ready to paste into ChatGPT/Claude
  to draft your connection note, or into your own tracker.

## What it will NEVER do

It only READS what is already on your screen and paints on top. It makes zero
network requests, sends your data nowhere, simulates no clicks or scrolling,
and never auto-connects or auto-messages anyone. Everything it remembers lives
in your own browser storage.

Honest note: even a passive overlay like this technically sits outside
LinkedIn's user agreement (automated processing of their pages). The realistic
worst case is account restriction, which is why the extension is strictly
read-only and you should never bolt automation on top of it.

## Install (Chrome or Edge)

1. Extract the zip somewhere permanent (e.g. Documents). Don't move it later;
   the browser loads it from that folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select the extracted folder.
5. Pin "JobPulse LinkedIn Scout" to the toolbar. (The browser may occasionally
   remind you that a developer-mode extension is running; that's expected.)

## First run

1. Click the toolbar icon, then **"Open today's #hiring search"**.
2. Check the search page shows *Past 24 hours* and *Latest*. If not: set those
   filters manually once, copy the address-bar URL, and paste it into the
   popup's **Settings** field, then Save. You can also change the search
   keywords there.
3. Treat your first couple of sessions as calibration: click any badge to see
   exactly why it classified a post that way before you trust the dimming.

## Correcting it

Click any badge or the "○" dot to open the details popover:

- **"This post: [genuine] [junk] [neutral]"** pins your verdict for that post.
- **"Firm '{name}': [trust all] [block all]"** teaches it about a whole firm:
  block a bodyshop it missed, or trust a company it wrongly dimmed. Trust
  removes firm-based junk but still dims C2C/contract content.

Your rules beat the built-in ones and apply instantly. Manage them in the
popup's Settings, and use **"Copy corrections (JSON)"** there to export what
you've taught it. Send that JSON back to whoever gave you this extension every
now and then: the good patterns get baked into the shared rules, so everyone's
copy gets smarter.

## Troubleshooting

- Pill bottom-left shows "X scanned · Y genuine · Z junk". If it turns orange
  saying "no posts parsed", LinkedIn changed their page structure; report it.
- A post with no marker at all had no text to classify (image-only posts).
- Updates arrive as a new zip: delete the old folder, extract the new one over
  the same location, hit **Reload** on the extensions page.

## Privacy

Everything stays in your browser: what you've seen, your corrections, your
settings. The only data that ever leaves is what you explicitly copy to your
own clipboard.
