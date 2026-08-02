import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalizeJobUrl,
  dedupeJobs,
  finalizeJob,
} from "../src/sources/shared.js";
import { loadJobData } from "../src/job-description.js";

function expectedKey(identity) {
  return createHash("sha1").update(identity).digest("hex");
}

function job(overrides = {}) {
  return finalizeJob({
    sourceKey: "example",
    sourceLabel: "Example",
    id: "req-123",
    title: "Software Engineer",
    location: "New York, NY",
    postedAt: "2026-07-01T00:00:00.000Z",
    url: "https://careers.example.com/jobs/req-123",
    ...overrides,
  });
}

describe("stable job identity", () => {
  it("uses the source and non-empty ATS ID, independent of mutable metadata", () => {
    const before = job();
    const after = job({
      title: "Software Engineer II",
      location: "New York, NY | Remote",
      url: "https://careers.example.com/jobs/req-123?ref=updated",
    });
    expect(before.key).toBe(expectedKey("id|example|req-123"));
    expect(after.key).toBe(before.key);
  });

  it("rejects traversal and unbounded cache directory identifiers before reading", async () => {
    for (const candidate of [
      "../outside",
      "nested/job",
      "..",
      "",
      "percent%2fescape",
      "a".repeat(201),
    ]) {
      await expect(loadJobData(candidate)).rejects.toThrow(/invalid job directory id/i);
    }
  });

  it("falls back to a canonical HTTPS URL when the source has no ID", () => {
    const canonical = canonicalizeJobUrl(
      "https://CAREERS.example.com/jobs/abc/?utm_source=email&b=2&a=1#apply"
    );
    expect(canonical).toBe("https://careers.example.com/jobs/abc?a=1&b=2");
    expect(job({ id: "", url: "https://careers.example.com/jobs/abc?a=1&b=2" }).key)
      .toBe(expectedKey(`url|example|${canonical}`));
  });

  it("deduplicates source/ID first and keeps richer metadata without changing the key", () => {
    const original = job({ title: "Engineer", location: "NY" });
    const richer = job({
      title: "Software Engineer, Product Platform",
      location: "New York, NY | Remote, US",
      roleCategories: ["software_engineer", "machine_learning"],
    });
    const [merged] = dedupeJobs([original, richer]);
    expect(merged.key).toBe(original.key);
    expect(merged.title).toBe(richer.title);
    expect(merged.location).toBe(richer.location);
    expect(merged.roleCategories).toEqual(expect.arrayContaining(["software_engineer"]));
  });

  it("joins a URL-only observation to a later stable-ID observation", () => {
    const urlOnly = job({ id: "", title: "Engineer" });
    const stable = job({ title: "Software Engineer, Backend" });
    const [merged] = dedupeJobs([urlOnly, stable]);
    expect(merged.id).toBe("req-123");
    expect(merged.key).toBe(expectedKey("id|example|req-123"));
  });

  it("does not detach a stable key from its source identity during URL merging", () => {
    const first = job();
    const alias = job({ sourceKey: "much-longer-alias", id: "other-id" });
    const [merged] = dedupeJobs([first, alias]);
    expect(merged.key).toBe(first.key);
    expect(merged.sourceKey).toBe("example");
    expect(merged.id).toBe("req-123");
  });
});
