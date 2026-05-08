import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

function isSalesforceSwe(title) {
  const t = title.trim();
  // Salesforce uses MTS (Member of Technical Staff) and AMTS as SWE titles
  if (/\b(MTS|AMTS|Member of Technical Staff|Associate Member of Technical Staff)\b/i.test(t)) {
    // Reject senior levels
    if (/\b(senior|sr\.?|princ\w*|staff|lead\w*|manager|director|distinguished|SMTS|PMTS)\b/i.test(t)) {
      return false;
    }
    return true;
  }
  return isTargetRole(t);
}

const TITLE_FILTERS = {
  salesforce: isSalesforceSwe
};

function parseRelativeDate(postedOn) {
  if (!postedOn) return { postedText: "", postedAt: "", postedPrecision: "" };

  const text = postedOn.trim();
  const now = Date.now();

  if (/today/i.test(text)) {
    return { postedText: text, postedAt: new Date(now).toISOString(), postedPrecision: "date" };
  }

  if (/yesterday/i.test(text)) {
    return { postedText: text, postedAt: new Date(now - 86400000).toISOString(), postedPrecision: "date" };
  }

  const daysMatch = text.match(/(\d+)\+?\s*day/i);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    return { postedText: text, postedAt: new Date(now - days * 86400000).toISOString(), postedPrecision: "date" };
  }

  const hoursMatch = text.match(/(\d+)\s*hour/i);
  if (hoursMatch) {
    const hours = parseInt(hoursMatch[1], 10);
    return { postedText: text, postedAt: new Date(now - hours * 3600000).toISOString(), postedPrecision: "exact" };
  }

  return { postedText: text, postedAt: "", postedPrecision: "" };
}

function parseWorkdayJob(raw, companyConfig) {
  const title = raw.title?.trim();
  const titleFilter = TITLE_FILTERS[companyConfig.sourceKey] || isTargetRole;
  if (!title || !titleFilter(title)) return null;

  const id = raw.bulletFields?.[0] || "";
  const location = raw.locationsText || raw.bulletFields?.[1] || "";
  const countryCode = "";
  const posted = parseRelativeDate(raw.postedOn);
  const url = `${companyConfig.baseUrl}${raw.externalPath}`;

  return finalizeJob({
    sourceKey: companyConfig.sourceKey,
    sourceLabel: companyConfig.sourceLabel,
    id,
    title,
    location,
    postedText: posted.postedText,
    postedAt: posted.postedAt,
    postedPrecision: posted.postedPrecision,
    url,
    countryCode
  });
}

// Workday tenants return relevance-ranked results capped at 20 per call. Without
// a country facet, top results are dominated by non-US roles and US openings get
// truncated. We discover the United States facet ID once per tenant, cache it,
// and paginate the US-filtered corpus so fresh US jobs always reach the freshness
// gate downstream.
const WORKDAY_PAGE_SIZE = 20;
const WORKDAY_PAGE_CONCURRENCY = 5;
const WORKDAY_MAX_RESULTS = 1500;
// Cache per tenant: { param: "locationHierarchy1" | "locationCountry" | "locations", ids: string[] } | null
const usFacetCache = new Map();

async function fetchWorkdayPage(apiUrl, body) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = new Error(`status ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// Tenants vary: some expose a `locationHierarchy1` or `locationCountry` facet
// with a single "United States" value, others only expose a city-level
// `locations` facet whose descriptors start with "US, ..." — we collect all
// matching IDs and apply them together via Workday's multi-value facet support.
async function discoverUsFacet(apiUrl) {
  const data = await fetchWorkdayPage(apiUrl, { appliedFacets: {}, limit: 1, offset: 0, searchText: "" });
  const facets = data.facets || [];
  const main = facets.find((f) => f.facetParameter === "locationMainGroup");
  const children = main?.values || [];

  // Country-level: single ID covering all US postings
  for (const param of ["locationHierarchy1", "locationCountry"]) {
    const child = children.find((v) => v.facetParameter === param);
    const us = (child?.values || []).find((v) => /^united states/i.test(v.descriptor || ""));
    if (us?.id) return { param, ids: [us.id] };
  }

  // Some tenants (e.g. Morgan Stanley) expose Location_Country at the top level
  // instead of nesting it under locationMainGroup.
  for (const param of ["Location_Country", "locationCountry"]) {
    const top = facets.find((f) => f.facetParameter === param);
    const us = (top?.values || []).find((v) => /^united states/i.test(v.descriptor || ""));
    if (us?.id) return { param, ids: [us.id] };
  }

  // City-level: collect every descriptor where "US" or "United States" appears
  // as a comma-delimited segment — matches "US, California, ..." (Intel-style)
  // and "Allen, Texas, US" (Cisco-style) without false-matching "United Arab
  // Emirates" or arbitrary substrings.
  const cities = children.find((v) => v.facetParameter === "locations");
  if (cities) {
    const usSegment = /(?:^|,\s*)(?:US|United States)(?:\s*,|\s*$)/i;
    const ids = (cities.values || [])
      .filter((v) => usSegment.test(v.descriptor || ""))
      .map((v) => v.id)
      .filter(Boolean);
    if (ids.length > 0) return { param: "locations", ids };
  }

  return null;
}

export async function collectWorkdayJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  try {
    const searchText = companyConfig.searchText || "software engineer";

    if (!usFacetCache.has(companyKey)) {
      try {
        const facet = await discoverUsFacet(companyConfig.apiUrl);
        usFacetCache.set(companyKey, facet);
        if (!facet) log(`${companyConfig.sourceLabel}: US facet not found, falling back to unfiltered search`);
        else log(`${companyConfig.sourceLabel}: US facet = ${facet.param} (${facet.ids.length} ids)`);
      } catch (e) {
        usFacetCache.set(companyKey, null);
        log(`${companyConfig.sourceLabel}: facet discovery failed (${e.message}), falling back`);
      }
    }
    const facet = usFacetCache.get(companyKey);
    const appliedFacets = facet ? { [facet.param]: facet.ids } : {};

    const firstPage = await fetchWorkdayPage(companyConfig.apiUrl, {
      appliedFacets,
      limit: WORKDAY_PAGE_SIZE,
      offset: 0,
      searchText
    });
    const total = Math.min(firstPage.total ?? 0, WORKDAY_MAX_RESULTS);
    let rawJobs = [...(firstPage.jobPostings ?? [])];

    if (total > WORKDAY_PAGE_SIZE) {
      const offsets = [];
      for (let o = WORKDAY_PAGE_SIZE; o < total; o += WORKDAY_PAGE_SIZE) offsets.push(o);

      for (let i = 0; i < offsets.length; i += WORKDAY_PAGE_CONCURRENCY) {
        const batch = offsets.slice(i, i + WORKDAY_PAGE_CONCURRENCY);
        const pages = await Promise.all(
          batch.map((o) =>
            fetchWorkdayPage(companyConfig.apiUrl, {
              appliedFacets,
              limit: WORKDAY_PAGE_SIZE,
              offset: o,
              searchText
            }).catch(() => ({ jobPostings: [] }))
          )
        );
        for (const p of pages) rawJobs.push(...(p.jobPostings ?? []));
      }
    }

    const jobs = rawJobs.map((raw) => parseWorkdayJob(raw, companyConfig)).filter(Boolean);

    // Server-side ordering is relevance, not date. Sort by postedAt DESC so the
    // maxJobsPerSource cap preserves the freshest postings.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    log(`${companyConfig.sourceLabel} API returned ${rawJobs.length} results (of ${firstPage.total ?? "?"}), ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
