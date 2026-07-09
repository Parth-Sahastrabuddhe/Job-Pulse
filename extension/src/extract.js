/* DOM extraction with TWO strategies, tried in order:
 *
 * 1. LEGACY UI: semantic classes (update-components-*, feed-shared-*) and
 *    data-urn attributes. Kept as a fallback family in case LinkedIn A/B-flips
 *    the account back.
 * 2. NEW UI (2026 rewritten frontend, confirmed live on Parth's account):
 *    class names are per-build hashes, so anchors are build-stable semantics
 *    only: div[role="listitem"] cards, span[data-testid="expandable-text-box"]
 *    post text, first /in/ or /company/ link for the author, avatar alt text
 *    ("View {name}'s profile" / "View company: {name}") for the author name,
 *    and the header row's leaf text lines for the headline. Post URN comes from
 *    an embedded /feed/update/urn:li:activity:N permalink when present,
 *    otherwise a stable content hash (jp:...).
 *
 * ALL selectors live in SELECTORS. Uses only querySelector / querySelectorAll /
 * getAttribute / textContent / closest / children so tests run against fake-dom.
 * If LinkedIn drifts again, content.js's drift check turns the pill orange.
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});

  const SELECTORS = {
    card: ['div.feed-shared-update-v2[data-urn]', 'div[data-urn^="urn:li:activity:"]', 'div[role="listitem"]'],
    // legacy family
    actorName: ['.update-components-actor__title span[aria-hidden="true"]', '.update-components-actor__title', '.feed-shared-actor__name'],
    actorDesc: ['.update-components-actor__description', '.feed-shared-actor__description'],
    actorLink: ['a.update-components-actor__meta-link', 'a.update-components-actor__container-link', '.update-components-actor a[href]', '.feed-shared-actor a[href]'],
    text: ['.update-components-text', '.feed-shared-inline-show-more-text', '.feed-shared-text'],
    // new-UI family
    nuText: ['span[data-testid="expandable-text-box"]'],
    nuAuthorLink: ['a[href*="/in/"]', 'a[href*="/company/"]'],
    nuAvatar: ['img[alt]', 'svg[aria-label]'],
    nuPermalink: ['a[href*="urn:li:activity"]']
  };

  function queryFirst(rootEl, list) {
    for (const sel of list) {
      const found = rootEl.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  function collapse(s) {
    return (s || "")
      .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function dedupeDoubled(s) {
    const m = s.match(/^(.+?)\s+\1$/s);
    return m ? m[1] : s;
  }
  function stripMoreSuffix(s) {
    return s
      .replace(/(?:…|\.\.\.)\s*(?:see\s+more|show\s+more|more)\s*$/i, "")
      .replace(/(?:see\s+more|show\s+more)\s*$/i, "")
      .trim();
  }
  function hashText(s) {
    let h = 5381;
    const str = s || "";
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  // Leaf text lines in DOM order (elements with no element children), capped.
  function collectLeafLines(rootEl, out, cap) {
    if (!rootEl || out.length >= cap) return;
    for (const c of rootEl.children || []) {
      if (out.length >= cap) return;
      if (!c.children || c.children.length === 0) {
        const t = collapse(c.textContent);
        if (t && out[out.length - 1] !== t) out.push(t);
      } else {
        collectLeafLines(c, out, cap);
      }
    }
  }

  function extractLegacy(card) {
    const nameEl = queryFirst(card, SELECTORS.actorName);
    let authorName = dedupeDoubled(collapse(nameEl ? nameEl.textContent : ""));
    authorName = authorName.split(/\s*[•·]\s*/)[0].trim();

    const descEl = queryFirst(card, SELECTORS.actorDesc);
    const authorHeadline = dedupeDoubled(collapse(descEl ? descEl.textContent : ""));

    const linkEl = queryFirst(card, SELECTORS.actorLink);
    const rawHref = linkEl ? linkEl.getAttribute("href") || "" : "";

    const textEl = queryFirst(card, SELECTORS.text);
    const text = stripMoreSuffix(collapse(textEl ? textEl.textContent : ""));

    return { authorName, authorHeadline, rawHref, text };
  }

  function extractNewUi(card) {
    const parts = [];
    for (const t of card.querySelectorAll(SELECTORS.nuText.join(","))) {
      const s = stripMoreSuffix(collapse(t.textContent));
      if (s && !parts.includes(s)) parts.push(s);
    }
    const text = parts.join("\n");

    const linkEl = queryFirst(card, SELECTORS.nuAuthorLink);
    const rawHref = linkEl ? linkEl.getAttribute("href") || "" : "";

    let authorName = "";
    const avatar = queryFirst(card, SELECTORS.nuAvatar);
    const acc = avatar ? collapse(avatar.getAttribute("alt") || avatar.getAttribute("aria-label") || "") : "";
    let m = acc.match(/^View\s+(.+?)(?:['’]s)?\s+profile$/i);
    if (m) authorName = m[1];
    else if ((m = acc.match(/^View\s+company:?\s*(.+)$/i))) authorName = m[1];

    // Headline: leaf lines of the author header row (avatar link's parent):
    // typically [name, "• 2nd", headline, "5h • Edited"] in DOM order.
    let authorHeadline = "";
    if (linkEl && linkEl.parentElement) {
      const lines = [];
      collectLeafLines(linkEl.parentElement, lines, 40);
      const nameLow = authorName.toLowerCase();
      for (const raw of lines) {
        const l = raw.trim();
        if (!l) continue;
        const low = l.toLowerCase();
        if (nameLow && (low === nameLow || nameLow.startsWith(low) || low.startsWith(nameLow))) continue;
        if (/^[•·]/.test(l) || /^(?:1st|2nd|3rd)\b/.test(l)) continue;
        if (/^\d+\s*(?:s|m|h|d|w|mo|yr)s?\b/i.test(l)) continue;
        if (/\bfollowers?\b/i.test(l) || /^(?:edited|promoted|premium|anonymous)\b/i.test(l)) continue;
        if (!authorName) { authorName = l; continue; }
        if (l.length < 8) continue;
        authorHeadline = l;
        break;
      }
      if (!authorName && lines.length) authorName = lines[0].trim();
    }

    return { authorName, authorHeadline, rawHref, text };
  }

  function extractPost(card) {
    if (!card || typeof card.querySelector !== "function") return null;

    let source = "legacy";
    let fields = extractLegacy(card);
    if (!fields.text && !fields.authorHeadline && !fields.authorName) {
      source = "new";
      fields = extractNewUi(card);
    }

    const missing = [];
    if (!fields.authorName) missing.push("authorName");
    if (!fields.authorHeadline) missing.push("authorHeadline");
    if (!fields.text) missing.push("text");

    const authorUrl = (fields.rawHref || "").split("?")[0];
    const isCompanyPage = /\/company\//.test(fields.rawHref || "");
    if (!authorUrl) missing.push("authorUrl");

    // URN resolution: data-urn (legacy) > permalink href (new UI) > content hash.
    let urn = card.getAttribute("data-urn") || "";
    if (!/^urn:li:activity:\d+$/.test(urn)) urn = "";
    if (!urn) {
      const perma = queryFirst(card, SELECTORS.nuPermalink);
      const pm = perma ? (perma.getAttribute("href") || "").match(/urn:li:activity:\d+/) : null;
      if (pm) urn = pm[0];
    }
    if (!urn) urn = "jp:" + hashText(fields.authorName + "|" + fields.text.slice(0, 80));

    return {
      urn,
      source,
      authorName: fields.authorName,
      authorHeadline: fields.authorHeadline,
      authorUrl,
      isCompanyPage,
      text: fields.text,
      missing
    };
  }

  JP.extract = { SELECTORS, extractPost, hashText };
  if (typeof module === "object" && module.exports) module.exports = JP.extract;
})(typeof self !== "undefined" ? self : globalThis);
