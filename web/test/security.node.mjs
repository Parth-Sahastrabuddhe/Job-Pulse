// Kept outside Vitest's *.test.* glob; this suite uses Node's built-in runner.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bcryptPasswordProblem,
  normalizeEmail,
  resolveDiscordRedirectUri,
  resolvePublicOrigin,
  trustedClientIp,
} from "../lib/security-core.mjs";
import { requireSameOrigin } from "../lib/security.js";
import { resolveSessionSecret, sessionSecretProblem, sessionVersionMatches } from "../lib/session-config.mjs";
import { passwordResetCodeHash } from "../lib/password-reset.mjs";
import {
  addUserToGuildWithRole,
  createUserChannel,
  deleteDiscordUserArtifacts,
} from "../lib/discord-admin.js";

test("normalizes one ordinary mailbox and rejects recipient injection", () => {
  assert.equal(normalizeEmail("  Person+jobs@Example.COM "), "person+jobs@example.com");
  assert.equal(normalizeEmail("one@example.com,two@example.com"), null);
  assert.equal(normalizeEmail("one@example.com;two@example.com"), null);
  assert.equal(normalizeEmail("one@example.com\nBcc:two@example.com"), null);
  assert.equal(normalizeEmail("two..dots@example.com"), null);
  assert.equal(normalizeEmail(".leading@example.com"), null);
  assert.equal(normalizeEmail("person@localhost"), null);
});

test("rejects bcrypt passwords that are short or exceed its 72-byte input limit", () => {
  assert.equal(bcryptPasswordProblem("valid-password"), null);
  assert.match(bcryptPasswordProblem("short"), /at least 6/);
  assert.match(bcryptPasswordProblem("only-eleven", { minCharacters: 12 }), /at least 12/);
  assert.match(bcryptPasswordProblem("é".repeat(37)), /72 UTF-8 bytes/);
  assert.match(bcryptPasswordProblem(123), /must be text/);
});

test("password reset codes are purpose-bound HMACs and session versions revoke old tokens", () => {
  const secret = "reset-test-secret-21fe9b40c9d44ac98f53216d";
  const first = passwordResetCodeHash("person@example.com", "123456", secret);
  assert.equal(first, passwordResetCodeHash("person@example.com", "123456", secret));
  assert.notEqual(first, passwordResetCodeHash("person@example.com", "654321", secret));
  assert.notEqual(first, passwordResetCodeHash("other@example.com", "123456", secret));
  assert.equal(first.includes("123456"), false);
  assert.equal(sessionVersionMatches(undefined, 0), true);
  assert.equal(sessionVersionMatches(0, 1), false);
  assert.equal(sessionVersionMatches(2, 2), true);
});

test("production public origin is configured and HTTPS only", () => {
  assert.equal(
    resolvePublicOrigin("https://joblookout.app", "http://internal:3000", { production: true }),
    "https://joblookout.app"
  );
  assert.throws(
    () => resolvePublicOrigin("", "http://internal:3000", { production: true }),
    /required in production/
  );
  assert.throws(
    () => resolvePublicOrigin("http://joblookout.app", "http://internal:3000", { production: true }),
    /https:\/\//
  );
  assert.throws(
    () => resolvePublicOrigin("https://joblookout.app/path", "http://internal:3000", { production: true }),
    /only an origin/
  );
});

test("Discord callback must be on the public origin", () => {
  assert.equal(
    resolveDiscordRedirectUri("", "https://joblookout.app", { production: true }),
    "https://joblookout.app/api/auth/callback"
  );
  assert.throws(
    () => resolveDiscordRedirectUri(
      "https://attacker.example/api/auth/callback",
      "https://joblookout.app",
      { production: true }
    ),
    /exactly match/
  );
});

test("proxy client IP is trusted only in explicit nginx mode", () => {
  const headers = new Headers({
    "x-real-ip": "203.0.113.10",
    "x-forwarded-for": "198.51.100.2",
  });
  assert.equal(trustedClientIp(headers, ""), "direct");
  assert.equal(trustedClientIp(headers, "nginx"), "203.0.113.10");
  assert.equal(trustedClientIp(new Headers({ "x-real-ip": "not-an-ip" }), "nginx"), "unknown");
});

test("state-changing requests fail closed without a same-origin source", async () => {
  const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NEXT_PUBLIC_BASE_URL = "https://joblookout.app";
  process.env.NODE_ENV = "production";
  try {
    const sameOrigin = new Request("http://internal:3000/api/profile", {
      method: "POST",
      headers: { origin: "https://joblookout.app" },
    });
    assert.equal(requireSameOrigin(sameOrigin), null);

    const missing = new Request("http://internal:3000/api/profile", { method: "POST" });
    assert.equal(requireSameOrigin(missing).status, 403);

    const crossOrigin = new Request("http://internal:3000/api/profile", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(requireSameOrigin(crossOrigin).status, 403);

    for (const origin of ["null", "not a url"]) {
      const invalidOrigin = new Request("http://internal:3000/api/profile", {
        method: "POST",
        headers: { origin, referer: "https://joblookout.app/profile" },
      });
      assert.equal(requireSameOrigin(invalidOrigin).status, 403);
    }
  } finally {
    if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
    else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("production session secrets reject placeholders and low entropy", () => {
  assert.match(sessionSecretProblem("generate-a-random-32-char-string"), /placeholder/);
  assert.match(sessionSecretProblem("abc123".repeat(12)), /repeated pattern/);
  assert.throws(
    () => resolveSessionSecret("generate-a-random-32-char-string", { production: true }),
    /openssl rand -base64 48/
  );
  const strong = "T1d4vmMHKlQQxhFOksmsvd97ZOZlInz53jvHPPzqoFb0hrFEt+LuKIffGnAAWTXE";
  assert.equal(sessionSecretProblem(strong), null);
  assert.equal(resolveSessionSecret(strong, { production: true }), strong);
});

test("Discord provisioning bounds every request with an abort signal", async () => {
  const signals = [];
  const responses = [
    { ok: true, status: 204 },
    { ok: true, status: 204 },
  ];
  const fetchImpl = async (_url, options) => {
    signals.push(options.signal);
    return responses.shift();
  };

  assert.deepEqual(await addUserToGuildWithRole({
    discordId: "123",
    accessToken: "oauth-secret",
    guildId: "456",
    roleId: "789",
    botToken: "bot-secret",
    fetchImpl,
    timeoutMs: 100,
  }), { added: false, roleEnsured: true });
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal instanceof AbortSignal), true);
});

test("Discord provisioning errors never expose response bodies or credentials", async () => {
  const secretBody = "oauth-secret bot-secret";
  await assert.rejects(
    createUserChannel({
      guildId: "456",
      categoryId: "111",
      jobpulseMemberRoleId: "789",
      userId: "123",
      firstName: "Person",
      botToken: "bot-secret",
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => secretBody }),
      timeoutMs: 100,
    }),
    (error) => {
      assert.match(error.message, /HTTP 500/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    }
  );
});

test("Discord provisioning aborts a stalled request without leaking credentials", async () => {
  await assert.rejects(
    addUserToGuildWithRole({
      discordId: "123",
      accessToken: "oauth-secret",
      guildId: "456",
      roleId: "789",
      botToken: "bot-secret",
      fetchImpl: async (_url, options) => new Promise((resolve, reject) => {
        const fallback = setTimeout(resolve, 1_000);
        const abort = () => {
          clearTimeout(fallback);
          reject(options.signal.reason);
        };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      }),
      timeoutMs: 1,
    }),
    (error) => {
      assert.match(error.message, /failed or timed out/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    }
  );
});

test("Discord cleanup applies deadlines to each external deletion", async () => {
  const signals = [];
  const result = await deleteDiscordUserArtifacts({
    discordId: "123",
    channelId: "999",
    guildId: "456",
    botToken: "bot-secret",
    fetchImpl: async (_url, options) => {
      signals.push(options.signal);
      return { ok: true, status: 204 };
    },
    timeoutMs: 100,
  });
  assert.deepEqual(result, { skipped: false, failures: [] });
  assert.equal(signals.length, 2);
  assert.equal(signals.every((signal) => signal instanceof AbortSignal), true);
});

test("SQLite rate limits persist counts and return Retry-After", async () => {
  const dbPath = path.join(os.tmpdir(), `jobpulse-web-rate-limit-${process.pid}.sqlite`);
  const previousDbFile = process.env.DB_FILE;
  const previousDbPath = process.env.DB_PATH;
  const previousUmask = process.umask(0o022);
  let database;
  delete process.env.DB_FILE;
  process.env.DB_PATH = dbPath;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }

  try {
    const {
      consumePasswordResetCode,
      consumeRateLimit,
      createPasswordResetCode,
      getDb,
      resetRateLimit,
    } = await import("../lib/db.js");
    database = getDb();
    const options = {
      scope: "test-login",
      keyHash: "opaque-test-key",
      limit: 2,
      windowMs: 60_000,
      now: 1_000_000,
    };
    assert.deepEqual(consumeRateLimit(options), {
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    for (const suffix of ["", "-wal", "-shm"]) {
      assert.equal(fs.statSync(`${dbPath}${suffix}`).mode & 0o777, 0o600);
    }
    assert.equal(consumeRateLimit(options).allowed, true);
    assert.deepEqual(consumeRateLimit(options), {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    resetRateLimit(options.scope, options.keyHash);
    assert.equal(consumeRateLimit(options).allowed, true);

    createPasswordResetCode("person@example.com", "first-hash", { now: 2_000_000, ttlMs: 60_000 });
    createPasswordResetCode("person@example.com", "second-hash", { now: 2_001_000, ttlMs: 60_000 });
    assert.equal(consumePasswordResetCode("person@example.com", "first-hash", { now: 2_002_000 }), false);
    assert.equal(consumePasswordResetCode("person@example.com", "second-hash", { now: 2_002_000 }), true);
    assert.equal(consumePasswordResetCode("person@example.com", "second-hash", { now: 2_003_000 }), false);

    createPasswordResetCode("person@example.com", "expired-hash", { now: 3_000_000, ttlMs: 1_000 });
    assert.equal(consumePasswordResetCode("person@example.com", "expired-hash", { now: 3_002_000 }), false);
  } finally {
    database?.close();
    process.umask(previousUmask);
    if (previousDbFile === undefined) delete process.env.DB_FILE;
    else process.env.DB_FILE = previousDbFile;
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  }
});
