import { dedupeJobs, finalizeJob, isTargetRole } from "./shared.js";

const GS_GRAPHQL_URL = "https://api-higher.gs.com/gateway/api/v1/graphql";

const GET_ROLES_QUERY = `query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
  roleSearch(searchQueryInput: $searchQueryInput) {
    totalCount
    items {
      roleId
      corporateTitle
      jobTitle
      jobFunction
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

function parseGSJob(raw) {
  const title = raw.jobTitle?.trim();
  if (!title || !isTargetRole(title, { banking: true })) return null;

  const roleId = raw.externalSource?.sourceId || raw.roleId?.replace(/_.*/, "") || "";
  const id = String(roleId);

  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const usLocations = locations.filter((l) => l.country === "United States");

  // Skip jobs with no US locations
  if (usLocations.length === 0) return null;

  const locationNames = usLocations.map((l) => [l.city, l.state].filter(Boolean).join(", "));
  const location = locationNames.join(" | ");

  const url = `https://higher.gs.com/roles/${id}`;

  return finalizeJob({
    sourceKey: "goldmansachs",
    sourceLabel: "Goldman Sachs",
    id,
    title,
    location,
    postedText: "",
    postedAt: "",
    postedPrecision: "",
    url,
    countryCode: "US"
  });
}

export async function collectGoldmanSachsJobs(_unused, config, log) {
  try {
    const response = await fetch(GS_GRAPHQL_URL, {
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
            page: { pageSize: 50, pageNumber: 0 },
            sort: { sortStrategy: "RELEVANCE", sortOrder: "DESC" },
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
