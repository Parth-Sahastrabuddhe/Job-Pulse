import { describe, it, expect } from "vitest";
import {
  inferCountryCodeFromLocation,
  parseUserCountries,
  parseCountryFilter,
  jobMatchesCountryFilter,
} from "../src/sources/shared.js";

describe("inferCountryCodeFromLocation — Canada", () => {
  it("tags province codes as CA", () => {
    expect(inferCountryCodeFromLocation("Toronto, ON")).toBe("CA");
    expect(inferCountryCodeFromLocation("Vancouver, BC")).toBe("CA");
    expect(inferCountryCodeFromLocation("Calgary, AB")).toBe("CA");
  });

  it("tags province names and explicit Canada as CA", () => {
    expect(inferCountryCodeFromLocation("Calgary, Alberta")).toBe("CA");
    expect(inferCountryCodeFromLocation("Montréal, Québec")).toBe("CA");
    expect(inferCountryCodeFromLocation("Remote - Canada")).toBe("CA");
    expect(inferCountryCodeFromLocation("Toronto, ON, Canada")).toBe("CA");
  });

  it("tags bare Canadian cities as CA", () => {
    expect(inferCountryCodeFromLocation("Mississauga")).toBe("CA");
    expect(inferCountryCodeFromLocation("Toronto")).toBe("CA");
  });

  it("London, ON is CA but bare London is NON-US", () => {
    expect(inferCountryCodeFromLocation("London, ON")).toBe("CA");
    expect(inferCountryCodeFromLocation("London")).toBe("NON-US");
  });
});

describe("inferCountryCodeFromLocation — US disambiguation (regression guards)", () => {
  it("Vancouver, WA is US, not Canada (state code beats bare city)", () => {
    expect(inferCountryCodeFromLocation("Vancouver, WA")).toBe("US");
  });

  it("Ontario, CA is US (California), not Canada", () => {
    expect(inferCountryCodeFromLocation("Ontario, CA")).toBe("US");
  });

  it("San Francisco, CA stays US", () => {
    expect(inferCountryCodeFromLocation("San Francisco, CA")).toBe("US");
  });

  it("explicit US words win", () => {
    expect(inferCountryCodeFromLocation("United States")).toBe("US");
    expect(inferCountryCodeFromLocation("Remote, US")).toBe("US");
    expect(inferCountryCodeFromLocation("New York, NY")).toBe("US");
  });
});

describe("inferCountryCodeFromLocation — NON-US and unknown unchanged", () => {
  it("India locations stay NON-US (no Indiana false positive)", () => {
    expect(inferCountryCodeFromLocation("INDIA, IN")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Bengaluru")).toBe("NON-US");
  });

  it("other countries stay NON-US", () => {
    expect(inferCountryCodeFromLocation("Berlin, Germany")).toBe("NON-US");
  });

  it("empty / bare remote are unknown", () => {
    expect(inferCountryCodeFromLocation("")).toBe("");
    expect(inferCountryCodeFromLocation("Remote")).toBe("");
  });

  it("mixed US|CA strings without an explicit US word resolve CA (NON-US today, so US-only users unaffected)", () => {
    expect(inferCountryCodeFromLocation("New York, NY | Toronto, ON")).toBe("CA");
    expect(inferCountryCodeFromLocation("United States | Canada")).toBe("US");
  });
});

describe("inferCountryCodeFromLocation — diacritics fold (accented foreign cities)", () => {
  it("folds accents so accented cities hit the ASCII allowlist", () => {
    expect(inferCountryCodeFromLocation("São Paulo")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Bogotá")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Düsseldorf")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Kraków")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Zürich")).toBe("NON-US");
  });

  it("keeps accented Canadian names resolving CA after fold", () => {
    expect(inferCountryCodeFromLocation("Montréal, Québec")).toBe("CA");
  });
});

describe("inferCountryCodeFromLocation — macro-region labels", () => {
  it("tags continent/region-only locations as NON-US", () => {
    expect(inferCountryCodeFromLocation("Asia")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Europe")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("EMEA")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("APAC")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Latin America")).toBe("NON-US");
  });

  it("leaves US-inclusive / genuinely-global labels alone (US signal wins, globals unknown)", () => {
    expect(inferCountryCodeFromLocation("Remote - US, Europe")).toBe("US");
    expect(inferCountryCodeFromLocation("Global")).toBe("");
    expect(inferCountryCodeFromLocation("Worldwide")).toBe("");
    expect(inferCountryCodeFromLocation("Americas")).toBe("");
  });
});

describe("inferCountryCodeFromLocation — Great Britain + added cities", () => {
  it("recognizes Great Britain / Britain", () => {
    expect(inferCountryCodeFromLocation("Great Britain")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Britain")).toBe("NON-US");
  });

  it("recognizes newly-added non-US cities", () => {
    expect(inferCountryCodeFromLocation("Galway")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Nantes")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Wroclaw")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Gdansk")).toBe("NON-US");
    expect(inferCountryCodeFromLocation("Sao Jose dos Campos")).toBe("NON-US");
  });
});

describe("parseUserCountries", () => {
  it("parses JSON arrays, uppercasing", () => {
    expect(parseUserCountries('["US","CA"]')).toEqual(["US", "CA"]);
    expect(parseUserCountries('["us","ca"]')).toEqual(["US", "CA"]);
  });

  it("wraps legacy scalars", () => {
    expect(parseUserCountries("US")).toEqual(["US"]);
    expect(parseUserCountries("ALL")).toEqual(["ALL"]);
  });

  it("falls back to US for empty, null, malformed array, and empty array", () => {
    expect(parseUserCountries("")).toEqual(["US"]);
    expect(parseUserCountries(null)).toEqual(["US"]);
    expect(parseUserCountries("[bad")).toEqual(["US"]); // looks like an array, unparseable
    expect(parseUserCountries("[]")).toEqual(["US"]);
  });
});

describe("jobMatchesCountryFilter — comma list", () => {
  const job = (countryCode = "", location = "") => ({ countryCode, location });

  it("us filter passes US, drops CA", () => {
    expect(jobMatchesCountryFilter(job("US", "New York, NY"), "us")).toBe(true);
    expect(jobMatchesCountryFilter(job("CA", "Toronto, ON"), "us")).toBe(false);
  });

  it("us,ca filter passes both, drops NON-US", () => {
    expect(jobMatchesCountryFilter(job("US", "New York, NY"), "us,ca")).toBe(true);
    expect(jobMatchesCountryFilter(job("CA", "Toronto, ON"), "us,ca")).toBe(true);
    expect(jobMatchesCountryFilter(job("NON-US", "Berlin, Germany"), "us,ca")).toBe(false);
  });

  it("all passes everything", () => {
    expect(jobMatchesCountryFilter(job("NON-US", "Berlin, Germany"), "all")).toBe(true);
  });

  it("unknown country keeps the grace rules", () => {
    expect(jobMatchesCountryFilter(job("", ""), "us,ca")).toBe(true);          // no location
    expect(jobMatchesCountryFilter(job("", "Remote"), "us,ca")).toBe(true);     // bare remote
    expect(jobMatchesCountryFilter(job("", "Bengaluru, India"), "us,ca")).toBe(false); // located, foreign
    expect(jobMatchesCountryFilter(job("", "Toronto, ON"), "us,ca")).toBe(true); // inferred CA
  });

  it("parseCountryFilter normalizes to a set of codes", () => {
    expect([...parseCountryFilter("us,ca")].sort()).toEqual(["CA", "US"]);
    expect(parseCountryFilter("").size).toBe(0);
  });
});
