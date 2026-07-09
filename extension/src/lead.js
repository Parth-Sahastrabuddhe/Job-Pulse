/* Copy-lead formatting. Output is plain text meant for pasting to Claude so the
 * outreach skill can draft the connection note and log it.
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});

  function buildPostUrl(urn) {
    return /^urn:li:activity:\d+$/.test(urn || "")
      ? "https://www.linkedin.com/feed/update/" + urn + "/"
      : "";
  }
  function formatLead(post, result, whenStr) {
    const reasons = (result.reasons || []).map((r) => r.label).join(", ");
    return [
      "LEAD from LinkedIn #hiring search (" + whenStr + ")",
      "Name: " + (post.authorName || "(unknown)"),
      "Headline: " + (post.authorHeadline || "(none)"),
      "Profile: " + (post.authorUrl || "(none)"),
      "Post: " + (buildPostUrl(post.urn) || "(no permalink)"),
      "Post text:",
      '"""',
      post.text || "",
      '"""',
      "Classifier: " + result.verdict + (reasons ? " (" + reasons + ")" : "")
    ].join("\n");
  }

  JP.lead = { buildPostUrl, formatLead };
  if (typeof module === "object" && module.exports) module.exports = JP.lead;
})(typeof self !== "undefined" ? self : globalThis);
