import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { collectMetaJobs, _resetMetaThrottleForTests } from "../src/sources/meta.js";

const T0 = new Date("2026-07-13T00:00:00Z");
const MIN = 60 * 1000;

const TOKEN_HTML = 'preamble "LSD",[],{"token":"tok-abc"} trailer';

function pageResponse(html = TOKEN_HTML) {
  return { ok: true, status: 200, text: async () => html, json: async () => ({}) };
}

function graphqlSuccess(allJobs) {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ data: { job_search_with_featured_jobs: { all_jobs: allJobs } } })
  };
}

function graphqlRateLimited() {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({ errors: [{ code: 1675004, message: "Rate limit exceeded" }] })
  };
}

function graphqlHttpError(status) {
  return { ok: false, status, text: async () => "", json: async () => ({}) };
}

const US_JOB = { id: "101", title: "Software Engineer, Product", locations: ["Menlo Park, CA"] };
const NON_US_JOB = { id: "102", title: "Software Engineer, Infrastructure", locations: ["London, UK"] };

const CONFIG = { meta: { sourceKey: "meta", sourceLabel: "Meta" }, maxJobsPerSource: 40 };

let fetchMock;
let logs;
const log = (m) => logs.push(m);

function queueFetch(...responses) {
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
}

function atMinutes(mins) {
  vi.setSystemTime(new Date(T0.getTime() + mins * MIN));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  _resetMetaThrottleForTests();
  fetchMock = vi.fn(async () => {
    throw new Error("unexpected fetch call");
  });
  vi.stubGlobal("fetch", fetchMock);
  logs = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("collectMetaJobs", () => {
  it("collects and parses jobs on a healthy attempt, dropping non-US/CA locations", async () => {
    queueFetch(pageResponse(), graphqlSuccess([US_JOB, NON_US_JOB]));
    const jobs = await collectMetaJobs(null, CONFIG, log);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("101");
    expect(jobs[0].countryCode).toBe("US");
    expect(jobs[0].url).toBe("https://www.metacareers.com/jobs/101");
  });

  it("skips the network entirely until the base poll interval elapses after a success", async () => {
    queueFetch(pageResponse(), graphqlSuccess([US_JOB]));
    await collectMetaJobs(null, CONFIG, log);

    atMinutes(14);
    const throttled = await collectMetaJobs(null, CONFIG, log);
    expect(throttled).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    atMinutes(15);
    queueFetch(pageResponse(), graphqlSuccess([US_JOB]));
    const jobs = await collectMetaJobs(null, CONFIG, log);
    expect(jobs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("makes exactly one attempt per cycle when rate-limited and doubles the wait on repeats", async () => {
    queueFetch(pageResponse(), graphqlRateLimited());
    const first = await collectMetaJobs(null, CONFIG, log);
    expect(first).toEqual([]);
    // page + ONE GraphQL attempt: a same-cycle retry would burn quota faster
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logs.some((l) => l.includes("Rate limit exceeded") && l.includes("15 min"))).toBe(true);

    // 15 min later: allowed again; limited again -> wait becomes 30 min
    atMinutes(15);
    queueFetch(pageResponse(), graphqlRateLimited());
    await collectMetaJobs(null, CONFIG, log);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 29 min after the second attempt: still inside the 30-min backoff
    atMinutes(44);
    expect(await collectMetaJobs(null, CONFIG, log)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 30 min after the second attempt: allowed again
    atMinutes(45);
    queueFetch(pageResponse(), graphqlRateLimited());
    await collectMetaJobs(null, CONFIG, log);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("caps the backoff at four hours", async () => {
    let clock = 0;
    // 15m -> 30m -> 1h -> 2h -> 4h -> stays 4h
    const expectedWaits = [15, 30, 60, 120, 240, 240, 240];
    for (const wait of expectedWaits) {
      const callsAtStart = fetchMock.mock.calls.length;
      queueFetch(pageResponse(), graphqlRateLimited());
      await collectMetaJobs(null, CONFIG, log);
      // the attempt ran (a longer-than-expected backoff would have skipped it)
      expect(fetchMock.mock.calls.length).toBe(callsAtStart + 2);
      // one minute before the window opens: still throttled
      atMinutes(clock + wait - 1);
      await collectMetaJobs(null, CONFIG, log);
      expect(fetchMock.mock.calls.length).toBe(callsAtStart + 2);
      clock += wait;
      atMinutes(clock);
    }
  });

  it("resets the backoff to the base cadence after a success", async () => {
    queueFetch(pageResponse(), graphqlRateLimited());
    await collectMetaJobs(null, CONFIG, log); // wait 15 min
    atMinutes(15);
    queueFetch(pageResponse(), graphqlRateLimited());
    await collectMetaJobs(null, CONFIG, log); // wait 30 min -> next at 45
    atMinutes(45);
    queueFetch(pageResponse(), graphqlSuccess([US_JOB]));
    const jobs = await collectMetaJobs(null, CONFIG, log);
    expect(jobs).toHaveLength(1);

    // healthy cadence again: allowed at +15, not +60
    atMinutes(60);
    queueFetch(pageResponse(), graphqlSuccess([US_JOB]));
    await collectMetaJobs(null, CONFIG, log);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("treats HTTP errors like rate limits and backs off", async () => {
    queueFetch(pageResponse(), graphqlHttpError(500));
    expect(await collectMetaJobs(null, CONFIG, log)).toEqual([]);
    expect(logs.some((l) => l.includes("500"))).toBe(true);

    atMinutes(14);
    expect(await collectMetaJobs(null, CONFIG, log)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off when the LSD token cannot be extracted", async () => {
    queueFetch(pageResponse("<html>no token here</html>"));
    expect(await collectMetaJobs(null, CONFIG, log)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.some((l) => l.includes("LSD token"))).toBe(true);

    atMinutes(14);
    await collectMetaJobs(null, CONFIG, log);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
