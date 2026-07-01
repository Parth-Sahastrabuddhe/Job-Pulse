import { dedupeJobs, detectSeniority, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

const GS_GRAPHQL_URL = "https://api-higher.gs.com/gateway/api/v1/graphql";

const GET_ROLES_QUERY = `query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items {
      roleId
      corporateTitle
      jobTitle
      jobFunction
      lastPostedDate
      locations {
        primary
        state
        country
        city
      }
      status
      division
      externalSource {
        sourceId
      }
    }
  }
}`;

// Seniority levels that must be surfaced in the title. GS carries the level in
// corporateTitle ("Vice President", "Executive Director"), which is often
// absent from jobTitle — and filter.js re-derives seniority from the title
// string alone, so a VP role titled just "Software Engineer" was classified
// entry_mid and delivered to entry/mid users.
const ELEVATED_LEVELS = new Set(["senior", "staff", "director"]);

function parseGSJob(raw) {
  let title = raw.jobTitle?.trim();
  if (!title || !isTargetRole(title)) return null;

  // Fold an ELEVATING corporate title into the job title so downstream
  // seniority detection sees it. Non-elevating corp titles (Analyst,
  // Associate) are left off — appending them would re-key existing rows for
  // no signal gain. Note: this re-keys elevated GS jobs once (dedup identity
  // includes the title), which is acceptable since they were misclassified.
  const corpTitle = raw.corporateTitle?.trim() || "";
  if (corpTitle && ELEVATED_LEVELS.has(detectSeniority(corpTitle))
      && !ELEVATED_LEVELS.has(detectSeniority(title))) {
    title = `${title} - ${corpTitle}`;
  }

  const roleId = raw.externalSource?.sourceId || raw.roleId?.replace(/_.*/, "") || "";
  const id = String(roleId);

  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const usLocations = locations.filter((l) => l.country === "United States");
  const caLocations = locations.filter((l) => l.country === "Canada");

  // Skip jobs with no US and no CA locations.
  if (usLocations.length === 0 && caLocations.length === 0) return null;

  const picked = usLocations.length > 0 ? usLocations : caLocations;
  const locationNames = picked.map((l) => [l.city, l.state].filter(Boolean).join(", "));
  const location = locationNames.join(" | ");

  const url = `https://higher.gs.com/roles/${id}`;

  let postedAt = "";
  let postedPrecision = "";
  if (raw.lastPostedDate && !Number.isNaN(Date.parse(raw.lastPostedDate))) {
    postedAt = new Date(raw.lastPostedDate).toISOString();
    postedPrecision = "exact";
  }

  return finalizeJob({
    sourceKey: "goldmansachs",
    sourceLabel: "Goldman Sachs",
    id,
    title,
    location,
    postedText: raw.lastPostedDate || "",
    postedAt,
    postedPrecision,
    url,
    countryCode: usLocations.length > 0 ? "US" : "CA"
  });
}

export async function collectGoldmanSachsJobs(_unused, config, log) {
  try {
    const response = await fetchWithTimeout(GS_GRAPHQL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "origin": "https://higher.gs.com",
        "referer": "https://higher.gs.com/"
      },
      body: JSON.stringify({
        operationName: "GetRoles",
        variables: {
          searchQueryInput: {
            page: { pageSize: 200, pageNumber: 0 },
            sort: { sortStrategy: "POSTED_DATE", sortOrder: "DESC" },
            filters: [],
            experiences: ["EARLY_CAREER", "PROFESSIONAL"],
            searchTerm: "software engineer"
          }
        },
        query: GET_ROLES_QUERY
      })
    });

    if (!response.ok) {
      log(`Goldman Sachs API returned status ${response.status}`);
      return [];
    }

    const data = await response.json();
    const roleSearch = data?.data?.roleSearch;
    if (!roleSearch) {
      log("Goldman Sachs API returned no role search data");
      return [];
    }

    const rawJobs = roleSearch.items || [];
    const jobs = rawJobs
      .map((raw) => parseGSJob(raw))
      .filter(Boolean);

    log(`Goldman Sachs API returned ${rawJobs.length} results (${roleSearch.totalCount} total), ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Goldman Sachs API error: ${error.message}`);
    return [];
  }
}
