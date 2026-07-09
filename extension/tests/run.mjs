/* Zero-dependency test runner for the JobPulse LinkedIn Scout extension.
 * Runs on plain Node 18: `node extension/tests/run.mjs`
 * The src/ modules are classic scripts (MV3 content scripts), UMD-attached to
 * a JPScout global and require()-able thanks to extension/package.json
 * marking this subtree "commonjs".
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { el } from "./fake-dom.mjs";
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${name}: ${e.message}`); }
}
function eq(a, e, msg) {
  if (a !== e) throw new Error(`${msg || "eq"}: expected ${JSON.stringify(e)} got ${JSON.stringify(a)}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || "expected truthy"); }

t("harness sanity", () => eq(1 + 1, 2));

// === classifier fixtures (Task 2) ===
const rules = require("../src/rules.js"); // attaches JPScout.rules; classifier reads it lazily
const classifier = require("../src/classifier.js");

const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
for (const f of fixtures) {
  t(`fixture: ${f.name}`, () => {
    const res = classifier.classifyPost({
      text: f.text || "",
      authorName: f.authorName || "",
      authorHeadline: f.headline || "",
      authorUrl: f.authorUrl || "",
      isCompanyPage: !!f.companyPage
    });
    eq(res.verdict, f.verdict, "verdict");
    const ids = res.reasons.map((r) => r.id);
    for (const id of f.reasonIds || []) ok(ids.includes(id), `missing reason ${id}; got [${ids}]`);
    for (const id of f.notReasonIds || []) ok(!ids.includes(id), `unexpected reason ${id}; got [${ids}]`);
  });
}

// --- user corrections: pins + firm trust/block overrides ---
t("overrides: pin beats junk rules", () => {
  const res = classifier.classifyPost({ text: "Hiring Java Developer :: C2C :: NJ" }, { pin: "genuine" });
  eq(res.verdict, "genuine");
  eq(res.reasons[0].id, "user-pin");
});
t("overrides: blockRe junks a clean post", () => {
  const blockRe = rules.buildFirmRe(["vertex solutions"]);
  const res = classifier.classifyPost(
    { text: "Great backend opportunity, apply now", authorHeadline: "Account Manager at Vertex Solutions Inc" },
    { blockRe }
  );
  eq(res.verdict, "junk");
  ok(res.reasons.some((r) => r.id === "user-block"), "user-block reason");
});
t("overrides: trust suppresses staffing-firm and unlocks in-house recruiter", () => {
  const trustRe = rules.buildFirmRe(["teksystems"]);
  const res = classifier.classifyPost(
    { text: "We just opened two SWE roles", authorHeadline: "Technical Recruiter at TEKsystems" },
    { trustRe }
  );
  eq(res.verdict, "genuine");
  ok(res.reasons.some((r) => r.id === "inhouse-recruiter"), "in-house via trust");
});
t("overrides: trust does NOT suppress contract vocab", () => {
  const trustRe = rules.buildFirmRe(["teksystems"]);
  const res = classifier.classifyPost(
    { text: "Java role, C2C only", authorHeadline: "Technical Recruiter at TEKsystems" },
    { trustRe }
  );
  eq(res.verdict, "junk");
  ok(res.reasons.some((r) => r.id === "c2c"), "c2c still junks");
});
t("overrides: trusted unknown recruiter becomes genuine", () => {
  const trustRe = rules.buildFirmRe(["vertex solutions"]);
  const res = classifier.classifyPost(
    { text: "Hiring software engineers, apply now", authorHeadline: "Sr. Technical Recruiter at Vertex Solutions Inc" },
    { trustRe }
  );
  eq(res.verdict, "genuine");
  ok(res.reasons.some((r) => r.id === "inhouse-recruiter"), "trusted recruiter");
});
t("overrides: buildFirmRe keeps ex- guard and null for empty", () => {
  const re = rules.buildFirmRe(["accenture"]);
  ok(!re.test("engineering manager at stripe | ex-accenture"), "ex- guarded");
  ok(re.test("recruiter at accenture"), "plain match");
  eq(rules.buildFirmRe([]), null);
});
t("parseFirm: extraction cases", () => {
  eq(classifier.parseFirm("Sr. Recruiter at Vertex Solutions Inc", "", false), "vertex solutions inc");
  eq(classifier.parseFirm("EM at Stripe | ex-Accenture", "", false), "stripe");
  eq(classifier.parseFirm("Recruiter @ Capgemini", "", false), "capgemini");
  eq(classifier.parseFirm("US IT Recruiter - Hexaware Technologies", "", false), "hexaware technologies");
  eq(classifier.parseFirm("whatever", "TEKsystems", true), "teksystems");
  eq(classifier.parseFirm("Just vibes", "", false), "");
});
t("classifier: degenerate inputs never throw", () => {
  eq(classifier.classifyPost({}).verdict, "neutral");
  eq(classifier.classifyPost({ text: undefined, authorHeadline: null }).verdict, "neutral");
  eq(classifier.normalize(undefined), "");
  const huge = "x".repeat(200000);
  ok(classifier.classifyPost({ text: huge }).verdict, "huge text handled");
  eq(classifier.classifyPost({ text: "🚀🔥💼" }).verdict, "neutral");
});

// === seen.js (Task 3) ===

const seen = require("../src/seen.js");
t("seen: chipInfo null for unknown/fresh", () => {
  const now = 1000000000000;
  eq(seen.chipInfo(undefined, now), null);
  eq(seen.chipInfo({ t: now - 5 * 60 * 1000, l: 0, v: "junk", c: false }, now), null);
});
t("seen: chipInfo after 20 min", () => {
  const now = 1000000000000;
  const e = { t: now - 25 * 60 * 1000, l: 0, v: "genuine", c: false };
  eq(seen.chipInfo(e, now).firstSeen, e.t);
});
t("seen: chipInfo boundary is strictly greater than 20 min", () => {
  const now = 1000000000000;
  eq(seen.chipInfo({ t: now - seen.CHIP_AFTER_MS, l: 0, v: "junk", c: false }, now), null);
  ok(seen.chipInfo({ t: now - seen.CHIP_AFTER_MS - 1, l: 0, v: "junk", c: false }, now), "1ms past");
});
t("seen: record preserves first-seen, updates last-seen", () => {
  const map = {}, t0 = 1000, t1 = 5000;
  seen.record(map, "u1", "genuine", t0);
  const e = seen.record(map, "u1", "junk", t1);
  eq(e.t, t0); eq(e.l, t1); eq(e.v, "junk"); eq(e.c, false);
});
t("seen: markCopied survives re-record", () => {
  const map = {};
  seen.record(map, "u1", "genuine", 1000);
  seen.markCopied(map, "u1", 2000);
  seen.record(map, "u1", "genuine", 3000);
  eq(map.u1.c, true);
});
t("seen: markCopied on unknown urn creates entry", () => {
  const map = {};
  const e = seen.markCopied(map, "u9", 4000);
  eq(e.c, true); eq(map.u9.t, 4000);
});
t("seen: hostile keys never pollute prototypes", () => {
  const map = {};
  seen.record(map, "__proto__", "junk", 1000);
  seen.markCopied(map, "constructor", 2000);
  seen.record(map, "prototype", "junk", 3000);
  eq(({}).l, undefined, "Object.prototype.l untouched");
  eq(({}).c, undefined, "Object.prototype.c untouched");
  eq(Object.keys(map).length, 0, "nothing stored under hostile keys");
});
t("seen: prune drops entries older than 7 days by last-seen", () => {
  const now = 1000000000000;
  const map = {
    old: { t: 1, l: now - 8 * 24 * 3600 * 1000, v: "junk", c: false },
    fresh: { t: 1, l: now - 1 * 24 * 3600 * 1000, v: "junk", c: false }
  };
  eq(seen.prune(map, now), 1);
  eq(map.old, undefined); ok(map.fresh, "fresh kept");
});

// === lead.js + search-url.js (Task 4) ===

const lead = require("../src/lead.js");
const searchUrl = require("../src/search-url.js");
t("lead: buildPostUrl", () => {
  eq(lead.buildPostUrl("urn:li:activity:71234"), "https://www.linkedin.com/feed/update/urn:li:activity:71234/");
  eq(lead.buildPostUrl("jp:abc123"), "");
  eq(lead.buildPostUrl(undefined), "");
  eq(lead.buildPostUrl("urn:li:activity:71234'onclick=x"), "");
});
t("lead: formatLead exact block", () => {
  const txt = lead.formatLead(
    { authorName: "Jane Doe", authorHeadline: "EM at Datadog", authorUrl: "https://www.linkedin.com/in/janedoe", urn: "urn:li:activity:7", text: "My team is hiring." },
    { verdict: "genuine", reasons: [{ id: "first-person", label: "first-person hiring" }] },
    "Jul 9, 12:01 AM"
  );
  eq(txt, [
    "LEAD from LinkedIn #hiring search (Jul 9, 12:01 AM)",
    "Name: Jane Doe",
    "Headline: EM at Datadog",
    "Profile: https://www.linkedin.com/in/janedoe",
    "Post: https://www.linkedin.com/feed/update/urn:li:activity:7/",
    "Post text:", '"""', "My team is hiring.", '"""',
    "Classifier: genuine (first-person hiring)"
  ].join("\n"));
});
t("lead: formatLead handles missing fields", () => {
  const txt = lead.formatLead({ urn: "jp:x" }, { verdict: "genuine", reasons: [] }, "now");
  ok(txt.includes("Name: (unknown)"), "unknown name");
  ok(txt.includes("Post: (no permalink)"), "no permalink");
  ok(txt.endsWith("Classifier: genuine"), "no empty parens");
});
t("search-url: default + builder + gate", () => {
  ok(searchUrl.DEFAULT_SEARCH_URL.includes("datePosted=%22past-24h%22"), "past-24h");
  ok(searchUrl.DEFAULT_SEARCH_URL.includes("keywords=%23hiring%20software%20engineer"), "keywords");
  ok(searchUrl.buildSearchUrl("foo bar").includes("keywords=foo%20bar"), "encodes");
  ok(searchUrl.buildSearchUrl("").includes("%23hiring"), "empty falls back to default");
  eq(searchUrl.isContentSearchPath("/search/results/content/"), true);
  eq(searchUrl.isContentSearchPath("/search/results/content"), true);
  eq(searchUrl.isContentSearchPath("/search/results/people/"), false);
  eq(searchUrl.isContentSearchPath("/feed/"), false);
  eq(searchUrl.isContentSearchPath(undefined), false);
});

// === extract.js via fake-dom (Task 5) ===

const extract = require("../src/extract.js");
function makeCard(over = {}) {
  const linkHref = over.linkHref !== undefined ? over.linkHref : "https://www.linkedin.com/in/janedoe?miniProfileUrn=x";
  const nameSpan = el("span", { class: "update-components-actor__title" }, [
    el("span", { "aria-hidden": "true" }, [over.name !== undefined ? over.name : "Jane Doe"]),
    el("span", { class: "visually-hidden" }, ["Jane Doe"])
  ]);
  const kids = [
    el("div", { class: "update-components-actor" }, [
      el("a", { class: "update-components-actor__meta-link", href: linkHref }, [
        nameSpan,
        el("span", { class: "update-components-actor__description" }, [over.headline !== undefined ? over.headline : "Engineering Manager at Datadog"])
      ])
    ])
  ];
  if (over.text !== null) {
    kids.push(el("div", { class: "update-components-text" }, [over.text !== undefined ? over.text : "My team is hiring two engineers."]));
  }
  const attrs = { class: "feed-shared-update-v2" };
  if (over.urn !== null) attrs["data-urn"] = over.urn || "urn:li:activity:7123456789";
  return el("div", attrs, kids);
}
t("extract: full card", () => {
  const p = extract.extractPost(makeCard());
  eq(p.urn, "urn:li:activity:7123456789");
  eq(p.authorName, "Jane Doe");
  eq(p.authorHeadline, "Engineering Manager at Datadog");
  eq(p.authorUrl, "https://www.linkedin.com/in/janedoe");
  eq(p.isCompanyPage, false);
  eq(p.text, "My team is hiring two engineers.");
  eq(p.missing.length, 0, "nothing missing");
});
t("extract: see-more suffix stripped", () => {
  const p = extract.extractPost(makeCard({ text: "Big news, we are growing.…see more" }));
  eq(p.text, "Big news, we are growing.");
});
t("extract: company page detection", () => {
  const p = extract.extractPost(makeCard({ linkHref: "https://www.linkedin.com/company/datadog/posts" }));
  eq(p.isCompanyPage, true);
});
t("extract: doubled name deduped", () => {
  const card = el("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1" }, [
    el("div", { class: "update-components-actor" }, [
      el("a", { class: "update-components-actor__meta-link", href: "https://www.linkedin.com/in/x" }, [
        el("span", { class: "update-components-actor__title" }, ["John Smith John Smith"]),
        el("span", { class: "update-components-actor__description" }, ["SWE"])
      ])
    ]),
    el("div", { class: "update-components-text" }, ["hello"])
  ]);
  eq(extract.extractPost(card).authorName, "John Smith");
});
t("extract: legacy selector fallback", () => {
  const card = el("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:2" }, [
    el("div", { class: "feed-shared-actor" }, [
      el("a", { href: "https://www.linkedin.com/in/y" }, [
        el("span", { class: "feed-shared-actor__name" }, ["Old Layout"]),
        el("span", { class: "feed-shared-actor__description" }, ["EM"])
      ])
    ]),
    el("div", { class: "feed-shared-inline-show-more-text" }, ["legacy text"])
  ]);
  const p = extract.extractPost(card);
  eq(p.authorName, "Old Layout");
  eq(p.authorHeadline, "EM");
  eq(p.text, "legacy text");
});
t("extract: urn fallback hash is stable and prefixed", () => {
  const a = extract.extractPost(makeCard({ urn: null }));
  const b = extract.extractPost(makeCard({ urn: null }));
  ok(a.urn.startsWith("jp:"), "prefixed");
  eq(a.urn, b.urn);
});
t("extract: invalid data-urn falls back to hash", () => {
  const p = extract.extractPost(makeCard({ urn: "urn:li:share:999" }));
  ok(p.urn.startsWith("jp:"), "share urn rejected, hash used");
});
t("extract: missing text tracked", () => {
  const p = extract.extractPost(makeCard({ text: null }));
  eq(p.text, "");
  ok(p.missing.includes("text"), "missing text");
});
t("extract: name degree-suffix cut", () => {
  const p = extract.extractPost(makeCard({ name: "Jane Doe · 2nd" }));
  eq(p.authorName, "Jane Doe");
});
t("extract: non-element input returns null", () => {
  eq(extract.extractPost(null), null);
  eq(extract.extractPost({}), null);
});
t("extract: hashText stable", () => {
  eq(extract.hashText("abc"), extract.hashText("abc"));
  ok(extract.hashText("abc") !== extract.hashText("abd"), "different input different hash");
  ok(typeof extract.hashText("") === "string", "empty ok");
});
// New-UI cards (2026 rewritten frontend): hashed classes, no data-urn.
// Anchors: div[role="listitem"], span[data-testid="expandable-text-box"],
// avatar alt "View {name}'s profile", first /in/ or /company/ link.
function makeNewCard(over = {}) {
  const authorHref = over.authorHref !== undefined ? over.authorHref : "https://www.linkedin.com/in/namita-soman?trk=x";
  const alt = over.alt !== undefined ? over.alt : "View Namita (Soman) Krishnan’s profile";
  const metaLines = over.metaLines || ["Namita (Soman) Krishnan", "• 2nd", "Engineering Manager at Datadog", "5h • Edited"];
  const kids = [
    el("h2", {}, [el("span", {}, ["Feed post"])]),
    el("div", {}, [
      el("a", { href: authorHref, tabindex: "0", componentkey: "k1" }, [
        el("figure", { componentkey: "k1" }, [el("img", { alt, src: "https://media.licdn.com/x" })])
      ]),
      el("div", {}, [
        el("div", {}, metaLines.map((t) => el("div", {}, [el("span", {}, [t])])))
      ])
    ])
  ];
  if (over.text !== null) {
    kids.push(el("p", { componentkey: "k2" }, [
      el("span", { "data-testid": "expandable-text-box", tabindex: "-1" }, [over.text !== undefined ? over.text : "My team is hiring two engineers."])
    ]));
  }
  if (over.embed) {
    kids.push(el("div", {}, [
      el("a", { href: "https://www.linkedin.com/feed/update/urn:li:activity:7211223344/?utm=x", componentkey: "k3" }, [
        el("p", {}, [el("span", { "data-testid": "expandable-text-box" }, [over.embed])])
      ])
    ]));
  }
  return el("div", { role: "listitem", componentkey: "expandedTrackingKeyFeedType_" }, kids);
}
t("extract new-ui: simple post", () => {
  const p = extract.extractPost(makeNewCard());
  eq(p.authorName, "Namita (Soman) Krishnan");
  eq(p.authorHeadline, "Engineering Manager at Datadog");
  eq(p.authorUrl, "https://www.linkedin.com/in/namita-soman");
  eq(p.isCompanyPage, false);
  eq(p.text, "My team is hiring two engineers.");
  ok(p.urn.startsWith("jp:"), "no permalink: content-hash urn");
});
t("extract new-ui: repost joins outer + embedded text and takes permalink urn", () => {
  const p = extract.extractPost(makeNewCard({ text: "Sharing this great opening!", embed: "We are hiring SDE-2, C2C only" }));
  eq(p.urn, "urn:li:activity:7211223344");
  ok(p.text.includes("Sharing this great opening!"), "outer text present");
  ok(p.text.includes("C2C only"), "embedded text present");
});
t("extract new-ui: company author via alt and href", () => {
  const p = extract.extractPost(makeNewCard({
    authorHref: "https://www.linkedin.com/company/datadog/posts",
    alt: "View company: Datadog",
    metaLines: ["Datadog", "120,543 followers", "6h •"]
  }));
  eq(p.isCompanyPage, true);
  eq(p.authorName, "Datadog");
});
t("extract new-ui: meta-line noise filtered for headline", () => {
  const p = extract.extractPost(makeNewCard({
    metaLines: ["Namita (Soman) Krishnan", "• 3rd+", "12,001 followers", "Senior Technical Recruiter at Amazon", "2d • Edited •"]
  }));
  eq(p.authorHeadline, "Senior Technical Recruiter at Amazon");
});
t("extract new-ui: urn hash stable across renders", () => {
  const a = extract.extractPost(makeNewCard());
  const b = extract.extractPost(makeNewCard());
  eq(a.urn, b.urn);
});
t("extract new-ui: ellipsis-more suffix stripped", () => {
  const p = extract.extractPost(makeNewCard({ text: "Big news, we are growing.…more" }));
  eq(p.text, "Big news, we are growing.");
});
t("extract new-ui: textless listitem tagged so shell can skip it", () => {
  const p = extract.extractPost(makeNewCard({ text: null }));
  eq(p.source, "new");
  eq(p.text, "");
});
t("extract legacy: reshare with empty text keeps legacy source", () => {
  const p = extract.extractPost(makeCard({ text: null }));
  eq(p.source, "legacy");
});
t("extract new-ui: listitem matches card selector", () => {
  ok(makeNewCard().matches(extract.SELECTORS.card.join(",")), "role=listitem matched");
});
t("extract: card selector matches both variants", () => {
  const modern = makeCard();
  ok(modern.matches(extract.SELECTORS.card.join(",")), "modern card matches");
  const bare = el("div", { "data-urn": "urn:li:activity:5" }, []);
  ok(bare.matches(extract.SELECTORS.card.join(",")), "bare data-urn div matches");
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  FAIL ${f}`).join("\n"));
  process.exitCode = 1;
}
