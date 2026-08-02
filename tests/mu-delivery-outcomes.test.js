import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDiscordSendError,
  sendDigestDm,
  sendJobDm,
} from "../src/mu-delivery.js";

function job(key = "source:one") {
  return {
    key,
    source_key: "source",
    source_label: "Example Co",
    title: "Software Engineer",
    url: `https://example.com/jobs/${encodeURIComponent(key)}`,
  };
}

function clientWithTarget(target, { channel = false } = {}) {
  return {
    users: { fetch: vi.fn(async () => target) },
    channels: { fetch: vi.fn(async () => channel ? target : target) },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("multi-user Discord outcome classification", () => {
  it.each([
    [{ status: 400 }, "known_failure"],
    [{ statusCode: 429 }, "known_failure"],
    [{ response: { status: 403 } }, "known_failure"],
    [{ status: 500 }, "uncertain"],
    [{ code: "ECONNRESET" }, "uncertain"],
    [{ code: 50007, status: 403 }, "dm_closed"],
    [{ rawError: { code: 10013 }, status: 404 }, "dm_closed"],
  ])("classifies %# as %s", (error, expected) => {
    expect(classifyDiscordSendError(error)).toBe(expected);
  });

  it.each([
    [{ status: 400, message: "bad request" }, "known_failure", false, false],
    [{ status: 503, message: "upstream lost" }, "uncertain", true, false],
    [{ code: "ECONNRESET", message: "socket reset" }, "uncertain", true, false],
    [{ code: 50007, status: 403, message: "closed" }, "dm_closed", false, true],
  ])("persists before a direct send and returns the remote outcome", async (
    error,
    outcome,
    uncertain,
    permanent
  ) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = { send: vi.fn(async () => { throw error; }) };
    const client = clientWithTarget(target);
    const onBeforeSend = vi.fn(() => true);

    const result = await sendJobDm(client, "discord-user", job(), "A", { onBeforeSend });

    expect(onBeforeSend).toHaveBeenCalledWith(["source:one"]);
    expect(target.send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      outcome,
      uncertain,
      permanent,
      sendStarted: true,
    });
  });

  it("keeps target lookup and claim loss on the safe pre-send side", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = { send: vi.fn() };
    const client = clientWithTarget(target);
    client.users.fetch.mockRejectedValueOnce(Object.assign(new Error("lookup failed"), { status: 503 }));
    const hook = vi.fn(() => true);

    const lookupResult = await sendJobDm(client, "discord-user", job(), "A", { onBeforeSend: hook });
    expect(lookupResult).toMatchObject({
      ok: false,
      outcome: "known_failure",
      uncertain: false,
      sendStarted: false,
    });
    expect(hook).not.toHaveBeenCalled();
    expect(target.send).not.toHaveBeenCalled();

    client.users.fetch.mockResolvedValueOnce(target);
    const lostResult = await sendJobDm(client, "discord-user", job(), "A", {
      onBeforeSend: () => false,
    });
    expect(lostResult).toMatchObject({
      ok: false,
      outcome: "known_failure",
      sendStarted: false,
    });
    expect(target.send).not.toHaveBeenCalled();
  });

  it("treats a missing send-capable target as a known pre-send failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = clientWithTarget({});
    const hook = vi.fn(() => true);

    const result = await sendJobDm(client, "discord-user", job(), "A", { onBeforeSend: hook });

    expect(result).toMatchObject({ outcome: "known_failure", sendStarted: false });
    expect(hook).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "ECONNRESET" }],
    [{ status: 503 }],
  ])("preserves every digest key when the summary response is ambiguous", async (details) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const remoteError = Object.assign(new Error("response lost"), details);
    const target = { send: vi.fn(async () => { throw remoteError; }) };
    const client = clientWithTarget(target);
    const jobs = [job("source:a"), job("source:b"), job("source:c")];
    const hook = vi.fn(() => true);

    const result = await sendDigestDm(client, "discord-user", jobs, "A", {
      onBeforeSend: hook,
      delayFn: async () => {},
    });

    expect(hook).toHaveBeenCalledWith(["source:a", "source:b", "source:c"]);
    expect(target.send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      outcome: "uncertain",
      uncertain: true,
      sendStarted: true,
      deliveredKeys: [],
      attemptedKeys: ["source:a", "source:b", "source:c"],
    });
  });

  it("keeps digest item embeds best-effort after the summary is accepted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const target = {
      send: vi.fn()
        .mockResolvedValueOnce({ id: "summary" })
        .mockRejectedValueOnce(new Error("item failed")),
    };
    const client = clientWithTarget(target);

    const result = await sendDigestDm(client, "discord-user", [job()], "A", {
      onBeforeSend: () => true,
      delayFn: async () => {},
    });

    expect(target.send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      ok: true,
      outcome: "sent",
      deliveredKeys: ["source:one"],
      attemptedKeys: ["source:one"],
    });
  });
});
