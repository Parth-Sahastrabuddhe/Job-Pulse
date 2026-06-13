import { dedupeJobs, finalizeJob, isTargetRole, fetchWithTimeout } from "./shared.js";

const GOOGLE_RPC_URL =
  "https://www.google.com/about/careers/applications/_/HiringCportalFrontendUi/data/batchexecute";

function buildRequestBody(query, location, sortByDate, page) {
  // Inner payload: [query, null, null, null, lang, null, [[location]], sort, null, null, page]
  const innerPayload = JSON.stringify([
    [query, null, null, null, "en-US", null, location ? [[location]] : null, sortByDate ? 2 : 0, null, null, page]
  ]);

  const outerPayload = JSON.stringify([[["r06xKb", innerPayload, null, "3"]]]);
  return `f.req=${encodeURIComponent(outerPayload)}`;
}

function parseResponse(text) {
  // Strip XSS protection prefix ")]}'\n"
  const cleaned = text.replace(/^\)\]\}'\n?/, "");

  // Find the r06xKb response block — it's the largest JSON string in the response
  // The response is length-prefixed lines. We need to find and parse the job data.
  const lines = cleaned.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!Array.isArray(parsed)) continue;

      // Look for the r06xKb entry
      for (const entry of parsed) {
        if (!Array.isArray(entry)) continue;
        if (entry[0] === "wrb.fr" && entry[1] === "r06xKb" && typeof entry[2] === "string") {
          return JSON.parse(entry[2]);
        }
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  return null;
}

function parseGoogleJob(raw, config) {
  if (!Array.isArray(raw)) return null;

  const id = raw[0];
  const title = raw[1];
  if (!id || !title || !isTargetRole(title)) {
    return null;
  }

  // Locations: raw[9] is array of [display_name, [address], city, zip, state, country_code]
  const locations = Array.isArray(raw[9])
    ? raw[9].map((loc) => (Array.isArray(loc) ? loc[0] : "")).filter(Boolean)
    : [];
  const location = locations.join(" | ");

  // Country: prefer the explicit location country code (raw[9][n][5]), then text.
  const countryCode =
    locations.some((l) => /\bUS(A)?\b|United States/i.test(l)) ? "US" :
    (Array.isArray(raw[9]) && raw[9].some((loc) => Array.isArray(loc) && loc[5] === "US")) ? "US" :
    locations.some((l) => /\bCanada\b/i.test(l)) ? "CA" :
    (Array.isArray(raw[9]) && raw[9].some((loc) => Array.isArray(loc) && loc[5] === "CA")) ? "CA" : "";

  // Posted date: raw[12] is [unix_seconds, nanoseconds]
  let postedAt = "";
  let postedPrecision = "";
  if (Array.isArray(raw[12]) && typeof raw[12][0] === "number") {
    const ms = raw[12][0] * 1000 + Math.floor((raw[12][1] || 0) / 1_000_000);
    postedAt = new Date(ms).toISOString();
    postedPrecision = "exact";
  }

  const url = `https://www.google.com/about/careers/applications/jobs/results/${id}`;

  return finalizeJob({
    sourceKey: config.google.sourceKey,
    sourceLabel: config.google.sourceLabel,
    id: String(id),
    title,
    location,
    postedText: postedAt ? new Date(postedAt).toLocaleString() : "",
    postedAt,
    postedPrecision,
    url,
    countryCode
  });
}

export async function collectGoogleJobs(_unused, config, log) {
  const LOCATIONS = ["United States", "Canada"];
  const endpoint = GOOGLE_RPC_URL + "?rpcids=r06xKb&source-path=/about/careers/applications/jobs/results&hl=en-US&soc-app=1&soc-platform=1&soc-device=1&_reqid=1000&rt=c";

  try {
    const texts = await Promise.all(LOCATIONS.map((loc) =>
      fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": "Mozilla/5.0" },
        body: buildRequestBody("\"Software Engineer\"", loc, true, 0)
      }).then((r) => (r.ok ? r.text() : "")).catch(() => "")
    ));

    const rawJobs = texts.flatMap((text) => {
      const jobData = text ? parseResponse(text) : null;
      return jobData && Array.isArray(jobData[0]) ? jobData[0] : [];
    });

    if (rawJobs.length === 0) {
      log("Google API returned no parseable job data.");
      return [];
    }

    const jobs = rawJobs
      .map((raw) => parseGoogleJob(raw, config))
      .filter(Boolean);

    log(`Google API returned ${rawJobs.length} results, ${jobs.length} matched filters.`);
    return dedupeJobs(jobs).slice(0, config.maxJobsPerSource);
  } catch (error) {
    log(`Google API error: ${error.message}`);
    return [];
  }
}
