/* Verdict precedence: junk > job-seeker(neutral) > genuine > neutral.
 * "Neutral when unsure" is deliberate: the failure mode of uncertainty must be
 * an untouched post, never a hidden opportunity.
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});

  function normalize(s) {
    return (s || "")
      .replace(/[\u2018\u2019\u02BC]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/#(?=\w)/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /* o (optional) carries the user's corrections, compiled by content.js:
   *   pin: "genuine"|"junk"|"neutral"  per-post verdict pin (wins over everything)
   *   trustRe / blockRe: RegExp|null   firm-level overrides on author identity
   * Trust removes firm-IDENTITY junk (staffing/consulting/unknown-recruiter) and
   * grants allowlist status; content junk (vocab/sponsorship/clearance/location)
   * still applies to trusted firms. Block acts like a personal staffing list.
   */
  function classifyPost(post, o) {
    o = o || {};
    if (o.pin === "genuine" || o.pin === "junk" || o.pin === "neutral") {
      return { verdict: o.pin, reasons: [{ id: "user-pin", label: "your correction" }] };
    }
    const R = JP.rules;
    const textN = normalize(post.text);
    const headN = normalize(post.authorHeadline);
    const combined = (textN + " " + headN).trim();
    // Firm blocklists judge WHO is posting, not what the post mentions:
    // "I started my career at Infosys" must not junk a Datadog engineer, while a
    // staffing company page (firm name only in authorName) must still junk.
    const authorIdent = normalize((post.authorHeadline || "") + " " + (post.authorName || ""));
    const trusted = !!(o.trustRe && o.trustRe.test(authorIdent));

    const junk = [];
    for (const r of R.junkRules) {
      const hay = r.scope === "headline" ? headN : r.scope === "text" ? textN : combined;
      if (r.re.test(hay)) junk.push({ id: r.id, label: r.label });
    }
    if (o.blockRe && o.blockRe.test(authorIdent)) junk.push({ id: "user-block", label: "your blocklist" });
    if (!trusted && R.staffingRe.test(authorIdent)) junk.push({ id: "staffing-firm", label: "staffing firm" });
    if (!trusted && R.consultingRe.test(authorIdent)) junk.push({ id: "consulting-firm", label: "consulting firm" });
    // Location veto scans text AND headline: US markers (original case) or
    // allowed-region markers (Canada) both clear the non-US junk.
    const originalAll = (post.text || "") + " " + (post.authorHeadline || "");
    if (R.nonUsRe.test(combined) && !R.usMarkerRe.test(originalAll) && !R.allowedPlacesRe.test(combined)) {
      junk.push({ id: "non-us", label: "non-US location" });
    }
    if (junk.length) return { verdict: "junk", reasons: junk };

    if (!post.isCompanyPage && R.seekerRe.test(textN)) {
      return { verdict: "neutral", reasons: [{ id: "job-seeker", label: "job-seeker post" }] };
    }

    // Recruiter at a company not on the allowlist (and not user-trusted): stay
    // neutral even if the text has genuine-looking phrases ("DM me" is agency
    // boilerplate). Junk rules above still win when the firm gives itself away.
    if (!post.isCompanyPage && !trusted && R.recruiterRe.test(headN) && !R.allowAtRe.test(headN)) {
      return { verdict: "neutral", reasons: [{ id: "unknown-recruiter", label: "recruiter at unknown company" }] };
    }

    const pos = [];
    for (const g of R.genuineRules) {
      const hay = g.scope === "headline" ? headN : textN;
      if (g.re.test(hay)) pos.push({ id: g.id, label: g.label });
    }
    if (R.recruiterRe.test(headN) && (trusted || R.allowAtRe.test(headN))) {
      pos.push({ id: "inhouse-recruiter", label: "in-house recruiter" });
    }
    if (post.isCompanyPage) pos.push({ id: "company-post", label: "company post" });
    if (pos.length) return { verdict: "genuine", reasons: pos };

    return { verdict: "neutral", reasons: [] };
  }

  /* Best-effort firm extraction from the author identity, for firm-level
   * corrections. The UI always SHOWS the parsed firm before the user commits,
   * so a bad parse is visible, not silent. */
  function parseFirm(headline, authorName, isCompanyPage) {
    if (isCompanyPage && authorName) return normalize(authorName);
    const h = normalize(headline);
    if (!h) return "";
    const cut = (s) => s.split(/[|•·,;]/)[0].replace(/^the\s+/, "").trim();
    let m = h.match(/\bat\s+([^|•·,;]+)/);
    if (m) return cut(m[1]);
    m = h.match(/@\s*([^|•·,;]+)/);
    if (m) return cut(m[1]);
    // Last spaced-dash or pipe segment, if it looks like a short name
    // (spaced dashes only, so hyphenated names like Mercedes-Benz survive).
    const segs = h.split(/\s+[-\u2013\u2014]\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
    if (segs.length >= 2) {
      const last = segs[segs.length - 1];
      if (last.length >= 3 && last.split(/\s+/).length <= 4) return cut(last);
    }
    return "";
  }

  JP.classifier = { classifyPost, parseFirm, normalize };
  if (typeof module === "object" && module.exports) module.exports = JP.classifier;
})(typeof self !== "undefined" ? self : globalThis);
