/* Search URL builder + SPA route gate. If LinkedIn changes their URL params,
 * the fix is zero-code: run the search manually once, copy the address-bar URL,
 * paste it into the popup's Settings field (stored config.searchUrl wins).
 */
(function (root) {
  "use strict";
  const JP = (root.JPScout = root.JPScout || {});
  const DEFAULT_QUERY = "#hiring software engineer";

  function buildSearchUrl(keywords) {
    return (
      "https://www.linkedin.com/search/results/content/?datePosted=%22past-24h%22&keywords=" +
      encodeURIComponent(keywords || DEFAULT_QUERY) +
      "&sortBy=%22date_posted%22"
    );
  }
  function isContentSearchPath(pathname) {
    return typeof pathname === "string" && pathname.startsWith("/search/results/content");
  }

  JP.searchUrl = {
    DEFAULT_QUERY,
    DEFAULT_SEARCH_URL: buildSearchUrl(DEFAULT_QUERY),
    buildSearchUrl,
    isContentSearchPath
  };
  if (typeof module === "object" && module.exports) module.exports = JP.searchUrl;
})(typeof self !== "undefined" ? self : globalThis);
