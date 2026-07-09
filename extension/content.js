/* Thin shell: observe rendered cards, classify, paint. Passive by design:
 * no clicks, no scrolling, no fetches. Fail-open: errors disable the overlay
 * (orange pill), never the page. All logic lives in src/ (JPScout.*).
 */
(() => {
  "use strict";
  if (typeof chrome === "undefined" || !chrome.storage) return;
  const JP = self.JPScout;
  if (!JP || !JP.extract || !JP.classifier || !JP.seen || !JP.lead || !JP.searchUrl) return;

  const CARD_SEL = JP.extract.SELECTORS.card.join(",");
  const MAX_ERRORS = 20;
  const state = {
    enabled: true,
    config: {},
    seen: {},
    counters: { scanned: 0, genuine: 0, junk: 0, seenCount: 0 },
    countedUrns: new Set(), // counters count posts (URNs), not recycled DOM nodes
    overrides: { posts: {}, trustFirms: [], blockFirms: [], samples: [] },
    trustRe: null,
    blockRe: null,
    errors: 0,
    dead: false,
    warned: false,
    driftStrikes: 0,
    queue: new Set(),
    drainScheduled: false,
    flushTimer: null,
    pill: null,
    popover: null,
    mo: null
  };

  const onSearchPage = () => JP.searchUrl.isContentSearchPath(location.pathname);
  const debugOn = () => {
    try { return localStorage.getItem("jp-debug") === "1"; } catch (e) { return false; }
  };

  init();

  async function init() {
    try {
      const got = await chrome.storage.local.get({ config: {}, seen: {}, overrides: {} });
      state.config = got.config || {};
      state.enabled = state.config.enabled !== false;
      state.seen = got.seen || {};
      state.overrides = normalizeOverrides(got.overrides);
      compileOverrides();
      if (JP.seen.prune(state.seen, Date.now()) > 0) scheduleFlush();
    } catch (e) { /* storage unavailable: run stateless */ }
    makePill();
    state.mo = new MutationObserver(onMutations);
    state.mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    chrome.storage.onChanged.addListener(onStorageChanged);
    chrome.runtime.onMessage.addListener(onMessage);
    setInterval(driftCheck, 5000);
    scanExisting();
    updatePill();
  }

  function onMutations(muts) {
    if (state.dead || !state.enabled || !onSearchPage()) return;
    try {
      for (const m of muts) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches && n.matches(CARD_SEL)) state.queue.add(n);
            if (n.querySelectorAll) {
              for (const c of n.querySelectorAll(CARD_SEL)) state.queue.add(c);
            }
            const up = n.closest && n.closest(CARD_SEL);
            if (up) state.queue.add(up);
          }
        } else {
          const t = m.target;
          const host = t.nodeType === 1 ? t : t.parentElement;
          const card = host && host.closest && host.closest(CARD_SEL);
          if (card) state.queue.add(card);
        }
      }
      scheduleDrain();
    } catch (e) { bumpError(e); }
  }

  function scanExisting() {
    if (state.dead || !state.enabled || !onSearchPage()) return;
    for (const el of document.querySelectorAll(CARD_SEL)) state.queue.add(el);
    scheduleDrain();
  }

  function scheduleDrain() {
    if (state.drainScheduled || state.queue.size === 0) return;
    state.drainScheduled = true;
    setTimeout(drain, 60);
  }

  function drain() {
    state.drainScheduled = false;
    if (state.dead || !state.enabled) { state.queue.clear(); return; }
    const batch = [...state.queue];
    state.queue.clear();
    let i = 0;
    (function step() {
      if (state.dead || !state.enabled) return;
      for (const el of batch.slice(i, i + 25)) processCard(el);
      i += 25;
      if (state.warned && !state.dead && state.counters.scanned > 0) clearWarn();
      updatePill();
      if (i < batch.length) setTimeout(step, 0);
    })();
  }

  function processCard(el) {
    if (state.dead || !state.enabled) return;
    try {
      const post = JP.extract.extractPost(el);
      if (!post || !post.urn || (!post.text && !post.authorHeadline)) return;
      // New-UI listitems without an expandable-text-box are not feed posts
      // (sidebar suggestion cards etc.); never badge those.
      if (post.source === "new" && !post.text) return;
      // Ignore our own injected badge mutations: hash covers post text only.
      const h = JP.extract.hashText(post.text);
      if (el.getAttribute("data-jp-urn") === post.urn && el.getAttribute("data-jp-hash") === h) return;
      el.setAttribute("data-jp-urn", post.urn);
      el.setAttribute("data-jp-hash", h);

      const pin = Object.prototype.hasOwnProperty.call(state.overrides.posts, post.urn)
        ? state.overrides.posts[post.urn] : undefined;
      const res = JP.classifier.classifyPost(post, { pin, trustRe: state.trustRe, blockRe: state.blockRe });
      const now = Date.now();
      const prior = state.seen[post.urn];
      const chip = JP.seen.chipInfo(prior, now);
      const copied = !!(prior && prior.c);
      JP.seen.record(state.seen, post.urn, res.verdict, now);
      paint(el, post, res, chip, copied);

      // Count each post once per session, even when LinkedIn's virtualized list
      // recycles DOM nodes for the same URN.
      if (!state.countedUrns.has(post.urn)) {
        state.countedUrns.add(post.urn);
        state.counters.scanned++;
        if (res.verdict === "genuine") state.counters.genuine++;
        else if (res.verdict === "junk") state.counters.junk++;
        if (chip) state.counters.seenCount++;
      }
      scheduleFlush();
    } catch (e) { bumpError(e); }
  }

  function paint(el, post, res, chip, copied) {
    el.classList.remove("jp-genuine", "jp-junk", "jp-seen");
    const old = el.querySelector(".jp-badge");
    if (old) old.remove();
    if (res.verdict === "genuine") el.classList.add("jp-genuine");
    if (res.verdict === "junk") el.classList.add("jp-junk");
    if (chip) el.classList.add("jp-seen");

    // Every scanned post gets a handle: neutrals show a faint dot, proving the
    // post was processed and giving access to details + corrections.
    const badge = document.createElement("div");
    badge.className = "jp-badge";

    const tag = document.createElement("span");
    tag.className = "jp-tag jp-tag-" + res.verdict;
    tag.textContent =
      res.verdict === "genuine" ? "✓ genuine" :
      res.verdict === "junk" ? "✕ " + res.reasons.map((r) => r.label).join(" · ") :
      "○";
    tag.title = "Click for classifier details and corrections";
    tag.addEventListener("click", (ev) => {
      ev.stopPropagation();
      togglePopover(badge, post, res);
    });
    badge.appendChild(tag);

    if (chip) {
      const c = document.createElement("span");
      c.className = "jp-chip";
      c.textContent = "seen " + new Date(chip.firstSeen).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      badge.appendChild(c);
    }

    if (res.verdict === "genuine") {
      const btn = document.createElement("button");
      btn.className = "jp-copy";
      btn.type = "button";
      btn.textContent = copied ? "Copied ✓" : "Copy lead";
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        doCopy(post, res, btn);
      });
      badge.appendChild(btn);
    }

    el.insertBefore(badge, el.firstChild || null);
  }

  function doCopy(post, res, btn) {
    const when = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const txt = JP.lead.formatLead(post, res, when);
    const done = () => {
      btn.textContent = "Copied ✓";
      JP.seen.markCopied(state.seen, post.urn, Date.now());
      scheduleFlush();
    };
    navigator.clipboard.writeText(txt).then(done).catch(() => {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch (e) { btn.textContent = "Copy failed"; }
    });
  }

  function togglePopover(anchor, post, res) {
    if (state.popover && state.popover.parentElement === anchor) {
      closePopover();
      return;
    }
    closePopover();
    const pop = document.createElement("div");
    pop.className = "jp-popover";
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify({
      verdict: res.verdict,
      reasons: res.reasons,
      extracted: { ...post, text: (post.text || "").slice(0, 400) }
    }, null, 2);
    pop.appendChild(pre);
    pop.appendChild(buildFixPanel(post, res));
    pop.addEventListener("click", (ev) => ev.stopPropagation());
    anchor.appendChild(pop);
    state.popover = pop;
    setTimeout(() => document.addEventListener("click", closePopover, { once: true }), 0);
  }

  function buildFixPanel(post, res) {
    const wrap = document.createElement("div");
    wrap.className = "jp-fix";

    const row1 = document.createElement("div");
    row1.className = "jp-fix-row";
    const lab1 = document.createElement("span");
    lab1.textContent = "This post:";
    row1.appendChild(lab1);
    const pinned = Object.prototype.hasOwnProperty.call(state.overrides.posts, post.urn)
      ? state.overrides.posts[post.urn] : undefined;
    for (const v of ["genuine", "junk", "neutral"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "jp-fix-btn" + (pinned === v ? " jp-fix-on" : "");
      b.textContent = v + (pinned === v ? " ✓" : "");
      b.title = pinned === v ? "Click to remove this correction" : "Pin this post as " + v;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        applyCorrection(pinned === v ? { type: "unpin" } : { type: "pin", verdict: v }, post, res);
      });
      row1.appendChild(b);
    }
    wrap.appendChild(row1);

    const firm = JP.classifier.parseFirm(post.authorHeadline, post.authorName, post.isCompanyPage);
    if (firm) {
      const row2 = document.createElement("div");
      row2.className = "jp-fix-row";
      const lab2 = document.createElement("span");
      lab2.textContent = 'Firm "' + firm + '":';
      row2.appendChild(lab2);
      const inTrust = state.overrides.trustFirms.includes(firm);
      const inBlock = state.overrides.blockFirms.includes(firm);
      const mk = (label, type, active) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "jp-fix-btn" + (active ? " jp-fix-on" : "");
        b.textContent = label + (active ? " ✓" : "");
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          applyCorrection({ type: active ? "clear-firm" : type, firm }, post, res);
        });
        return b;
      };
      row2.appendChild(mk("trust all", "trust-firm", inTrust));
      row2.appendChild(mk("block all", "block-firm", inBlock));
      wrap.appendChild(row2);
    }
    return wrap;
  }

  function applyCorrection(a, post, res) {
    closePopover();
    try {
      chrome.storage.local.get({ overrides: {} }, (got) => {
        const o = normalizeOverrides(got.overrides);
        if (a.type === "pin") o.posts[post.urn] = a.verdict;
        if (a.type === "unpin") delete o.posts[post.urn];
        if (a.type === "trust-firm") {
          if (!o.trustFirms.includes(a.firm)) o.trustFirms.push(a.firm);
          o.blockFirms = o.blockFirms.filter((f) => f !== a.firm);
        }
        if (a.type === "block-firm") {
          if (!o.blockFirms.includes(a.firm)) o.blockFirms.push(a.firm);
          o.trustFirms = o.trustFirms.filter((f) => f !== a.firm);
        }
        if (a.type === "clear-firm") {
          o.trustFirms = o.trustFirms.filter((f) => f !== a.firm);
          o.blockFirms = o.blockFirms.filter((f) => f !== a.firm);
        }
        // Samples give Claude pattern-mining material to bake permanent rules.
        o.samples.push({
          t: Date.now(),
          action: a.type + (a.verdict ? ":" + a.verdict : ""),
          firm: a.firm || "",
          name: post.authorName,
          headline: post.authorHeadline,
          text200: (post.text || "").slice(0, 200),
          was: res.verdict,
          reasons: (res.reasons || []).map((r) => r.id)
        });
        if (o.samples.length > 50) o.samples = o.samples.slice(-50);
        chrome.storage.local.set({ overrides: o });
      });
    } catch (e) { bumpError(e); }
  }

  function normalizeOverrides(o) {
    o = o || {};
    return {
      posts: o.posts || {},
      trustFirms: Array.isArray(o.trustFirms) ? o.trustFirms : [],
      blockFirms: Array.isArray(o.blockFirms) ? o.blockFirms : [],
      samples: Array.isArray(o.samples) ? o.samples : []
    };
  }
  function compileOverrides() {
    state.trustRe = JP.rules.buildFirmRe(state.overrides.trustFirms);
    state.blockRe = JP.rules.buildFirmRe(state.overrides.blockFirms);
  }
  function resetSessionCounts() {
    state.counters = { scanned: 0, genuine: 0, junk: 0, seenCount: 0 };
    state.countedUrns.clear();
  }
  function reclassifyAll() {
    for (const el of document.querySelectorAll("[data-jp-urn]")) {
      el.removeAttribute("data-jp-hash");
      state.queue.add(el);
    }
    scheduleDrain();
    updatePill();
  }
  function closePopover() {
    if (state.popover) {
      state.popover.remove();
      state.popover = null;
    }
  }

  function makePill() {
    const pill = document.createElement("div");
    pill.className = "jp-pill";
    try { pill.title = "JobPulse Scout v" + chrome.runtime.getManifest().version; } catch (e) {}
    if (state.config.pillCollapsed) pill.classList.add("jp-pill-dot");
    pill.addEventListener("click", () => {
      if (state.warned) return; // keep warnings readable
      pill.classList.toggle("jp-pill-dot");
      state.config.pillCollapsed = pill.classList.contains("jp-pill-dot");
      try { chrome.storage.local.set({ config: { ...state.config } }); } catch (e) {}
      updatePill();
    });
    document.documentElement.appendChild(pill);
    state.pill = pill;
  }
  function updatePill() {
    if (!state.pill) return;
    const show = (state.enabled && onSearchPage() && !state.dead) || state.warned;
    state.pill.style.display = show ? "" : "none";
    if (state.warned) return; // warn() owns the text
    const c = state.counters;
    state.pill.textContent = state.pill.classList.contains("jp-pill-dot")
      ? ""
      : c.scanned + " scanned · " + c.genuine + " genuine · " + c.junk + " junk · " + c.seenCount + " seen";
  }
  function warn(msg) {
    state.warned = true;
    if (!state.pill) return;
    state.pill.classList.add("jp-pill-warn");
    state.pill.classList.remove("jp-pill-dot");
    state.pill.textContent = "JP Scout: " + msg;
    state.pill.title = msg;
    state.pill.style.display = "";
  }
  function clearWarn() {
    state.warned = false;
    state.driftStrikes = 0;
    if (state.pill) {
      state.pill.classList.remove("jp-pill-warn");
      state.pill.title = "";
    }
    updatePill();
  }
  function driftCheck() {
    updatePill(); // also hides the pill after SPA navigation away from search
    if (state.dead || !state.enabled || !onSearchPage()) return;
    if (state.warned) {
      // Recover if it was a slow first load, not real selector drift.
      if (state.counters.scanned > 0) clearWarn();
      return;
    }
    // New-UI LinkedIn scrolls an inner <main>, not the body; check both.
    const scroller = document.querySelector("main") || document.scrollingElement || document.body;
    const tall = Math.max(scroller.scrollHeight, document.body.scrollHeight) > innerHeight * 2;
    if (state.counters.scanned === 0 && tall) {
      // Two consecutive strikes (10s) before crying wolf on slow loads.
      if (++state.driftStrikes >= 2) warn("no posts parsed; LinkedIn DOM may have changed");
    } else {
      state.driftStrikes = 0;
    }
  }
  function bumpError(e) {
    state.errors++;
    try { console.debug("[jp-scout]", e); } catch (e2) {}
    if (state.errors > MAX_ERRORS && !state.dead) {
      state.dead = true;
      if (state.mo) state.mo.disconnect();
      warn("overlay off (repeated errors)");
    }
  }
  function scheduleFlush() {
    clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(flushSeen, 2000);
  }
  async function flushSeen() {
    // Merge with what's in storage instead of clobbering it: another search tab
    // (or a failed init read) must never lose entries or copied flags. Sticky
    // rules: earliest first-seen, latest last-seen wins the verdict, copied ORs.
    try {
      const got = await chrome.storage.local.get({ seen: {} });
      const stored = got.seen || {};
      for (const urn of Object.keys(stored)) {
        if (urn === "__proto__" || urn === "constructor" || urn === "prototype") continue;
        const theirs = stored[urn];
        if (!theirs) continue;
        const mine = state.seen[urn];
        if (!mine) { state.seen[urn] = theirs; continue; }
        if (theirs.t < mine.t) mine.t = theirs.t;
        if (theirs.l > mine.l) { mine.l = theirs.l; mine.v = theirs.v; }
        mine.c = mine.c || !!theirs.c;
      }
      await chrome.storage.local.set({ seen: state.seen });
    } catch (e) { /* storage unavailable; try again on next flush */ }
  }
  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes.overrides) {
      state.overrides = normalizeOverrides(changes.overrides.newValue);
      compileOverrides();
      resetSessionCounts();
      reclassifyAll();
    }
    if (!changes.config) return;
    const cfg = changes.config.newValue || {};
    state.config = cfg;
    const en = cfg.enabled !== false;
    if (en === state.enabled) return;
    state.enabled = en;
    if (en) {
      scanExisting();
    } else {
      state.queue.clear(); // drop anything enqueued before the toggle
      unpaintAll();
    }
    updatePill();
  }
  function unpaintAll() {
    for (const el of document.querySelectorAll("[data-jp-urn]")) {
      el.classList.remove("jp-genuine", "jp-junk", "jp-seen");
      const b = el.querySelector(".jp-badge");
      if (b) b.remove();
      el.removeAttribute("data-jp-urn");
      el.removeAttribute("data-jp-hash");
    }
  }
  function onMessage(msg, sender, sendResponse) {
    if (msg && msg.type === "jp-stats") {
      sendResponse({ ...state.counters, enabled: state.enabled, onSearchPage: onSearchPage() });
    }
  }
})();
