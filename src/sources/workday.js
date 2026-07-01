import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

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

function parseWorkdayJob(raw, companyConfig, countryTag) {
  const title = raw.title?.trim();
  const titleFilter = TITLE_FILTERS[companyConfig.sourceKey] || isTargetRole;
  if (!title || !titleFilter(title)) return null;

  // bulletFields[0] is usually the requisition number, but some tenants omit
  // it. Fall back to the stable req slug in externalPath so the id is never
  // blank. (bulletFields[0] is kept first to preserve existing dedup keys.)
  const id = raw.bulletFields?.[0] || raw.externalPath?.split("/").filter(Boolean).pop() || "";
  const location = raw.locationsText || raw.bulletFields?.[1] || "";
  // When a country facet was applied, Workday has already server-side-restricted
  // the corpus to that country, so multi-location postings ("4 Locations") whose
  // country can't be inferred from the text are still that country. Without this
  // they're dropped by the central country filter. If facet discovery failed,
  // leave it empty so the filter falls back to inferring from the location string.
  const countryCode = countryTag || "";
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
// Cache per tenant: { us: Facet|null, ca: Facet|null, failedAt?: number } where
// Facet = { param, ids: string[] }. failedAt marks a DISCOVERY FAILURE entry:
// retried after FACET_RETRY_MS instead of being cached forever — one transient
// 503 at boot used to degrade the tenant to the unfiltered inference pass for
// the whole process lifetime.
const facetCache = new Map();
const FACET_RETRY_MS = 60 * 60 * 1000;

async function fetchWorkdayPage(apiUrl, body) {
  const response = await fetchWithTimeout(apiUrl, {
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

// Find the facet (param + value ids) matching a country, from an already-fetched
// facets payload. Tenants vary: some expose a `locationHierarchy1`/`locationCountry`
// facet with a single country value, some expose `Location_Country` at the top
// level (e.g. Morgan Stanley), others only expose a city-level `locations` facet
// whose descriptors carry the country as a comma-delimited segment.
function findCountryFacet(facets, descriptorRe, citySegRe) {
  const main = facets.find((f) => f.facetParameter === "locationMainGroup");
  const children = main?.values || [];

  for (const param of ["locationHierarchy1", "locationCountry"]) {
    const child = children.find((v) => v.facetParameter === param);
    const hit = (child?.values || []).find((v) => descriptorRe.test(v.descriptor || ""));
    if (hit?.id) return { param, ids: [hit.id] };
  }
  for (const param of ["Location_Country", "locationCountry"]) {
    const top = facets.find((f) => f.facetParameter === param);
    const hit = (top?.values || []).find((v) => descriptorRe.test(v.descriptor || ""));
    if (hit?.id) return { param, ids: [hit.id] };
  }
  const cities = children.find((v) => v.facetParameter === "locations");
  if (cities) {
    const ids = (cities.values || [])
      .filter((v) => citySegRe.test(v.descriptor || ""))
      .map((v) => v.id)
      .filter(Boolean);
    if (ids.length > 0) return { param: "locations", ids };
  }
  return null;
}

// Discover US and CA facets in one facets call. The CA city segment uses
// CAN/Canada (not bare "CA") to avoid pulling in California city facets like
// "Mountain View, CA, US".
async function discoverFacets(apiUrl) {
  const data = await fetchWorkdayPage(apiUrl, { appliedFacets: {}, limit: 1, offset: 0, searchText: "" });
  const facets = data.facets || [];
  return {
    us: findCountryFacet(facets, /^united states/i, /(?:^|,\s*)(?:US|United States)(?:\s*,|\s*$)/i),
    ca: findCountryFacet(facets, /^canada/i, /(?:^|,\s*)(?:CAN|Canada)(?:\s*,|\s*$)/i),
  };
}

export async function collectWorkdayJobs(_unused, config, log, companyKey) {
  const companyConfig = config[companyKey];
  if (!companyConfig) return [];

  const searchText = companyConfig.searchText || "software engineer";

  // Fetch + paginate one country's faceted corpus, tagging every job with `tag`.
  // facet null → unfiltered pass (used only when no facet was discovered).
  async function fetchCountry(facet, tag) {
    if (!facet && tag) {
      // Defense-in-depth: an unfiltered (null-facet) fetch must NEVER wear a
      // country tag. Doing so stamps the entire global corpus with that country
      // (Nike → every India job tagged "US"; Salesforce → Europe tagged "CA").
      // Only the explicit no-facet inference pass (tag "") may run unfiltered.
      log(`${companyConfig.sourceLabel}: refusing tagged "${tag}" unfiltered fetch (facet missing)`);
      return [];
    }
    const appliedFacets = facet ? { [facet.param]: facet.ids } : {};
    const firstPage = await fetchWorkdayPage(companyConfig.apiUrl, {
      appliedFacets, limit: WORKDAY_PAGE_SIZE, offset: 0, searchText
    });
    const total = Math.min(firstPage.total ?? 0, WORKDAY_MAX_RESULTS);
    const rawJobs = [...(firstPage.jobPostings ?? [])];
    if (total > WORKDAY_PAGE_SIZE) {
      const offsets = [];
      for (let o = WORKDAY_PAGE_SIZE; o < total; o += WORKDAY_PAGE_SIZE) offsets.push(o);
      for (let i = 0; i < offsets.length; i += WORKDAY_PAGE_CONCURRENCY) {
        const batch = offsets.slice(i, i + WORKDAY_PAGE_CONCURRENCY);
        const pages = await Promise.all(
          batch.map((o) =>
            fetchWorkdayPage(companyConfig.apiUrl, {
              appliedFacets, limit: WORKDAY_PAGE_SIZE, offset: o, searchText
            }).catch(() => ({ jobPostings: [] }))
          )
        );
        for (const p of pages) rawJobs.push(...(p.jobPostings ?? []));
      }
    }
    return rawJobs.map((raw) => parseWorkdayJob(raw, companyConfig, tag)).filter(Boolean);
  }

  try {
    const cachedFacets = facetCache.get(companyKey);
    const retryFailedDiscovery =
      cachedFacets?.failedAt && (Date.now() - cachedFacets.failedAt) >= FACET_RETRY_MS;
    if (!cachedFacets || retryFailedDiscovery) {
      try {
        const facets = await discoverFacets(companyConfig.apiUrl);
        facetCache.set(companyKey, facets);
        log(`${companyConfig.sourceLabel}: facets US=${facets.us ? facets.us.ids.length : 0} CA=${facets.ca ? facets.ca.ids.length : 0}`);
      } catch (e) {
        facetCache.set(companyKey, { us: null, ca: null, failedAt: Date.now() });
        log(`${companyConfig.sourceLabel}: facet discovery failed (${e.message}), falling back to unfiltered (retry in ${FACET_RETRY_MS / 60000}m)`);
      }
    }
    const { us, ca } = facetCache.get(companyKey);

    let jobs;
    if (!us && !ca) {
      // No facets discovered — single unfiltered pass, tag by inference (tag "").
      jobs = await fetchCountry(null, "");
    } else {
      // A facet-tagged pass is only valid for a facet that was ACTUALLY discovered;
      // tagging an unfiltered fetch mislabels the whole global corpus (the
      // asymmetric-facet leak — Nike: us=null/ca set → India stamped "US";
      // Salesforce: ca=null/us set → Europe stamped "CA"). So: fetch+tag each
      // discovered facet, and cover any country whose facet is MISSING via an
      // unfiltered inference pass (tag "") instead. Drop inferred NON-US from that
      // pass so foreign jobs are neither mislabeled nor allowed to crowd out US/CA
      // within the per-source cap (they'd be dropped by the central gate anyway).
      const passes = await Promise.all([
        us ? fetchCountry(us, "US") : Promise.resolve([]),
        ca ? fetchCountry(ca, "CA") : Promise.resolve([]),
        (!us || !ca)
          ? fetchCountry(null, "").then((arr) => arr.filter((j) => j.countryCode !== "NON-US"))
          : Promise.resolve([]),
      ]);
      jobs = passes.flat();
    }

    // Server-side ordering is relevance, not date. Sort by postedAt DESC so the
    // maxJobsPerSource cap preserves the freshest postings.
    jobs.sort((a, b) => (Date.parse(b.postedAt) || 0) - (Date.parse(a.postedAt) || 0));

    log(`${companyConfig.sourceLabel}: ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`${companyConfig.sourceLabel} API error: ${error.message}`);
    return [];
  }
}
