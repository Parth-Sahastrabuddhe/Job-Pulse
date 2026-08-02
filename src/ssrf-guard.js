/**
 * Network boundary for URLs that did not originate in trusted source code.
 *
 * `safeFetch` deliberately does not use the process-wide fetch dispatcher. It
 * resolves and validates every hop, pins the selected address into the socket
 * lookup callback, and checks the connected peer. That closes the usual
 * DNS-validation/DNS-use race. Redirects are handled one at a time and receive
 * the same validation.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

const IPV4_BLOCKS = [
  ["0.0.0.0", 8],          // current network / unspecified
  ["10.0.0.0", 8],         // RFC 1918
  ["100.64.0.0", 10],      // carrier-grade NAT
  ["127.0.0.0", 8],        // loopback
  ["169.254.0.0", 16],     // link-local, including cloud metadata
  ["172.16.0.0", 12],      // RFC 1918
  ["192.0.0.0", 24],       // IETF protocol assignments
  ["192.0.2.0", 24],       // documentation
  ["192.88.99.0", 24],     // deprecated 6to4 relay anycast
  ["192.168.0.0", 16],     // RFC 1918
  ["198.18.0.0", 15],      // benchmarking
  ["198.51.100.0", 24],    // documentation
  ["203.0.113.0", 24],     // documentation
  ["224.0.0.0", 4],        // multicast
  ["240.0.0.0", 4],        // reserved + limited broadcast
];

const IPV6_BLOCKS = [
  ["::", 128],              // unspecified
  ["::1", 128],             // loopback
  ["64:ff9b:1::", 48],      // local-use NAT64
  ["100::", 64],            // discard-only
  ["2001::", 23],           // special-purpose assignments (Teredo/ORCHID/etc.)
  ["2001:db8::", 32],       // documentation
  ["2002::", 16],           // deprecated 6to4
  ["3fff::", 20],           // documentation
  ["fc00::", 7],            // unique-local
  ["fe80::", 10],           // link-local
  ["fec0::", 10],           // deprecated site-local
  ["ff00::", 8],            // multicast
];

function blockedError(message, code = "BLOCKED_URL") {
  const err = new Error(message);
  err.name = "UnsafeUrlError";
  err.code = code;
  err.blocked = true;
  return err;
}

function ipv4ToInt(ip) {
  return ip.split(".").reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

function expandIpv6(ip) {
  let value = String(ip).toLowerCase().split("%")[0];
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);

  // Convert a dotted IPv4 tail to two hextets before expanding `::`.
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted && net.isIPv4(dotted[2])) {
    const v4 = ipv4ToInt(dotted[2]);
    value = `${dotted[1]}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n);
}

function isInCidr(value, network, prefix, bits) {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (network >> shift);
}

function mappedIpv4(ipv6Value) {
  // ::ffff:0:0/96 IPv4-mapped addresses.
  if ((ipv6Value >> 32n) === 0xffffn) {
    const tail = ipv6Value & 0xffffffffn;
    return [24n, 16n, 8n, 0n].map((shift) => Number((tail >> shift) & 255n)).join(".");
  }
  return null;
}

/** Return true unless the address is globally routable unicast. */
export function isBlockedIp(ip) {
  const normalized = String(ip ?? "").replace(/^\[|\]$/g, "").split("%")[0];
  if (net.isIPv4(normalized)) {
    const value = ipv4ToInt(normalized);
    return IPV4_BLOCKS.some(([network, prefix]) =>
      isInCidr(value, ipv4ToInt(network), prefix, 32));
  }
  if (!net.isIPv6(normalized)) return true;

  const value = expandIpv6(normalized);
  if (value === null) return true;
  const mapped = mappedIpv4(value);
  if (mapped) return isBlockedIp(mapped);
  // Ordinary globally routed IPv6 unicast is allocated from 2000::/3. Reject
  // transition/local/special prefixes outside it instead of trying to predict
  // every operating-system-specific interpretation of those addresses.
  if (!isInCidr(value, expandIpv6("2000::"), 3, 128)) return true;
  return IPV6_BLOCKS.some(([network, prefix]) =>
    isInCidr(value, expandIpv6(network), prefix, 128));
}

function normalizeHostname(hostname) {
  return String(hostname ?? "")
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function hostMatches(hostname, rule) {
  if (rule instanceof RegExp) return rule.test(hostname);
  const expected = normalizeHostname(rule);
  return hostname === expected || hostname.endsWith(`.${expected}`);
}

function validateUrlShape(urlString, policy = {}) {
  let url;
  try {
    url = new URL(String(urlString));
  } catch {
    throw blockedError("Invalid endpoint URL");
  }

  const requireHttps = policy.requireHttps ?? process.env.NODE_ENV === "production";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && !requireHttps)) {
    throw blockedError(requireHttps ? "Endpoint must use HTTPS" : "Endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw blockedError("Credentials in the endpoint URL are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || BLOCKED_HOST_SUFFIXES.some((suffix) =>
    suffix.startsWith(".") ? hostname.endsWith(suffix) : hostname === suffix)) {
    throw blockedError("Endpoint hostname is not publicly routable");
  }
  if (policy.allowedHosts?.length && !policy.allowedHosts.some((rule) => hostMatches(hostname, rule))) {
    throw blockedError("Endpoint hostname is not allowed for this source");
  }
  return url;
}

async function resolveSafeUrl(urlString, policy = {}, lookup = dns.lookup) {
  const url = validateUrlShape(urlString, policy);
  const hostname = normalizeHostname(url.hostname);
  const literalFamily = net.isIP(hostname);
  let addresses;

  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw blockedError("Endpoint hostname did not resolve", "DNS_FAILED");
    }
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw blockedError("Endpoint hostname did not resolve", "DNS_FAILED");
  }
  for (const result of addresses) {
    if (!result?.address || isBlockedIp(result.address)) {
      throw blockedError("Endpoint resolves to a non-public address range");
    }
  }

  return {
    url,
    addresses: addresses.map(({ address, family }) => ({
      address: String(address).split("%")[0],
      family: Number(family) || net.isIP(address),
    })).sort((left, right) => left.family === right.family ? 0 : left.family === 4 ? -1 : 1),
  };
}

/** Validate a URL and every DNS result. Returns the normalized URL. */
export async function assertSafeUrl(urlString, policy = {}) {
  const deadline = deadlineSignal(policy.signal, policy.timeoutMs);
  try {
    if (deadline.signal.aborted) throw abortReason(deadline.signal);
    const resolved = await awaitWithSignal(
      resolveSafeUrl(urlString, policy, policy.lookup || dns.lookup),
      deadline.signal,
    );
    return resolved.url;
  } finally {
    deadline.cleanup();
  }
}

function comparableIp(ip) {
  const normalized = String(ip ?? "").split("%")[0].toLowerCase();
  if (net.isIPv4(normalized)) return `v4:${ipv4ToInt(normalized).toString(16)}`;
  const value = net.isIPv6(normalized) ? expandIpv6(normalized) : null;
  if (value === null) return "invalid";
  const mapped = mappedIpv4(value);
  return mapped
    ? `v4:${ipv4ToInt(mapped).toString(16)}`
    : `v6:${value.toString(16)}`;
}

/** Used both by the transport and regression tests for peer pinning. */
export function assertPinnedPeer(remoteAddress, selectedAddress) {
  if (isBlockedIp(remoteAddress)) {
    throw blockedError("Connected peer is not a public address", "PEER_MISMATCH");
  }
  if (comparableIp(remoteAddress) !== comparableIp(selectedAddress)) {
    throw blockedError("Connected peer did not match the validated DNS address", "PEER_MISMATCH");
  }
}

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  err.code = "ABORT_ERR";
  return err;
}

function abortReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : abortError();
}

function normalizedTimeoutMs(value) {
  const parsed = Number(value ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Await work that may not itself understand AbortSignal (notably dns.lookup).
 * Attaching both fulfillment and rejection handlers also prevents a late DNS
 * rejection from becoming unhandled after the deadline has fired.
 */
function awaitWithSignal(work, signal) {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const onAbort = () => finish(reject, abortReason(signal));
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(work).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function deadlineSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const duration = normalizedTimeoutMs(timeoutMs);
  const deadline = Date.now() + duration;
  const onParentAbort = () => controller.abort(abortReason(parentSignal));
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

  const timer = setTimeout(() => {
    const error = abortError();
    error.message = `The operation timed out after ${duration}ms`;
    error.timedOut = true;
    controller.abort(error);
  }, duration);
  if (typeof timer.unref === "function") timer.unref();

  return {
    signal: controller.signal,
    deadline,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

function bodyAsBuffer(body) {
  if (body === undefined || body === null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  throw new TypeError("safeFetch request bodies must be strings or byte arrays");
}

function responseContentTypeAllowed(headers, allowedContentTypes) {
  if (!allowedContentTypes?.length) return true;
  const type = String(headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  return Boolean(type) && allowedContentTypes.some((allowed) => {
    if (allowed instanceof RegExp) return allowed.test(type);
    const expected = String(allowed).toLowerCase();
    return expected.endsWith("/") ? type.startsWith(expected) : type === expected;
  });
}

class BufferedSafeResponse {
  constructor({ status, headers, url, body }) {
    this.status = status;
    this.statusText = "";
    this.headers = headers;
    this.url = url;
    this.redirected = false;
    this.ok = status >= 200 && status < 300;
    this.body = null;
    this.bodyUsed = false;
    this._body = body;
  }

  async text() {
    this.bodyUsed = true;
    return this._body.toString("utf8");
  }

  async json() {
    return JSON.parse(await this.text());
  }

  async arrayBuffer() {
    this.bodyUsed = true;
    return this._body.buffer.slice(this._body.byteOffset, this._body.byteOffset + this._body.byteLength);
  }
}

function pinnedLookup(selected) {
  return (_hostname, options, callback) => {
    let opts = options;
    let cb = callback;
    if (typeof options === "function") {
      cb = options;
      opts = {};
    }
    if (opts?.all) cb(null, [{ address: selected.address, family: selected.family }]);
    else cb(null, selected.address, selected.family);
  };
}

function requestOnce(url, options, selected, policy) {
  return new Promise((resolve, reject) => {
    const body = bodyAsBuffer(options.body);
    const maxRequestBytes = policy.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
    const maxResponseBytes = policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (body && body.byteLength > maxRequestBytes) {
      reject(blockedError(`Request body exceeds ${maxRequestBytes} bytes`, "REQUEST_TOO_LARGE"));
      return;
    }

    const headers = new Headers(options.headers || {});
    headers.delete("host");
    headers.delete("connection");
    headers.delete("proxy-authorization");
    if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
    if (body && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));

    const requestFn = url.protocol === "https:" ? https.request : http.request;
    const requestOptions = {
      protocol: url.protocol,
      hostname: normalizeHostname(url.hostname),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: options.method || (body ? "POST" : "GET"),
      headers: Object.fromEntries(headers.entries()),
      lookup: pinnedLookup(selected),
      agent: false,
      servername: net.isIP(normalizeHostname(url.hostname)) ? undefined : normalizeHostname(url.hostname),
    };

    let settled = false;
    let peerVerified = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn(value);
    };
    const fail = (error) => finish(reject, error);
    const req = requestFn(requestOptions, (res) => {
      res.on("error", fail);
      if (!peerVerified) {
        try {
          assertPinnedPeer(res.socket?.remoteAddress, selected.address);
          peerVerified = true;
        } catch (error) {
          res.destroy(error);
          fail(error);
          return;
        }
      }

      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => responseHeaders.append(name, entry));
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      const contentEncoding = String(responseHeaders.get("content-encoding") || "identity").toLowerCase();
      if (contentEncoding !== "identity" && contentEncoding !== "") {
        const error = blockedError("Compressed responses are not accepted from untrusted endpoints", "UNSUPPORTED_ENCODING");
        res.destroy(error);
        fail(error);
        return;
      }
      const contentLength = Number(responseHeaders.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
        const error = blockedError(`Response exceeds ${maxResponseBytes} bytes`, "RESPONSE_TOO_LARGE");
        res.destroy(error);
        fail(error);
        return;
      }

      const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode || 0);
      const enforceType = !isRedirect && ((res.statusCode || 0) < 400 || policy.enforceContentTypeOnError);
      if (enforceType && !responseContentTypeAllowed(responseHeaders, policy.allowedContentTypes)) {
        const error = blockedError("Endpoint returned an unexpected content type", "UNEXPECTED_CONTENT_TYPE");
        res.destroy(error);
        fail(error);
        return;
      }

      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.byteLength;
        if (size > maxResponseBytes) {
          const error = blockedError(`Response exceeds ${maxResponseBytes} bytes`, "RESPONSE_TOO_LARGE");
          res.destroy(error);
          fail(error);
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish(resolve, new BufferedSafeResponse({
        status: res.statusCode || 0,
        headers: responseHeaders,
        url: url.toString(),
        body: Buffer.concat(chunks, size),
      })));
      res.on("aborted", () => fail(new Error("Response stream was aborted")));
    });

    req.on("socket", (socket) => {
      const event = url.protocol === "https:" ? "secureConnect" : "connect";
      socket.once(event, () => {
        try {
          assertPinnedPeer(socket.remoteAddress, selected.address);
          peerVerified = true;
        } catch (error) {
          req.destroy(error);
        }
      });
    });
    req.on("error", fail);

    const onAbort = () => req.destroy(abortError());
    timer = setTimeout(() => req.destroy(abortError()), policy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (body) req.write(body);
    req.end();
  });
}

function redirectOptions(response, currentUrl, nextUrl, options) {
  const next = { ...options, headers: new Headers(options.headers || {}) };
  const status = response.status;
  const method = String(options.method || (options.body ? "POST" : "GET")).toUpperCase();
  // Fetch preserves HEAD across redirects, including a 303. Other methods are
  // rewritten according to the Fetch redirect rules.
  if ((status === 303 && method !== "HEAD") ||
      ((status === 301 || status === 302) && method === "POST")) {
    next.method = "GET";
    delete next.body;
    next.headers.delete("content-length");
    next.headers.delete("content-type");
  }
  if (currentUrl.origin !== nextUrl.origin) {
    for (const header of ["authorization", "cookie", "proxy-authorization", "x-api-key"]) {
      next.headers.delete(header);
    }
  }
  return next;
}

/**
 * Build a safe fetch function. Dependency injection exists for deterministic
 * transport/DNS tests; production uses the exported `safeFetch` instance.
 */
export function createSafeFetch({ lookup = dns.lookup, transport = requestOnce } = {}) {
  return async function fetchSafely(urlString, options = {}, policy = {}) {
    let current = String(urlString);
    const redirectMode = options.redirect || "follow";
    const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    const deadline = deadlineSignal(options.signal, policy.timeoutMs);
    let requestOptions = { ...options, signal: deadline.signal };

    try {
      for (let redirects = 0; ; redirects += 1) {
        if (deadline.signal.aborted) throw abortReason(deadline.signal);
        const resolved = await awaitWithSignal(
          resolveSafeUrl(current, policy, lookup),
          deadline.signal,
        );
        // Picking one previously validated answer and pinning it avoids a second DNS lookup.
        const selected = resolved.addresses[0];
        const remainingMs = Math.max(1, deadline.deadline - Date.now());
        const response = await awaitWithSignal(
          transport(resolved.url, requestOptions, selected, {
            ...policy,
            timeoutMs: remainingMs,
          }),
          deadline.signal,
        );
        const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
        if (!isRedirect) {
          response.redirected = redirects > 0;
          return response;
        }
        if (redirectMode === "manual") return response;
        if (redirectMode === "error") throw blockedError("Endpoint redirects are not allowed", "REDIRECT_BLOCKED");
        if (redirects >= maxRedirects) throw blockedError("Endpoint exceeded the redirect limit", "TOO_MANY_REDIRECTS");

        const location = response.headers.get("location");
        if (!location) throw blockedError("Endpoint returned a redirect without a location", "INVALID_REDIRECT");
        let nextUrl;
        try {
          nextUrl = new URL(location, resolved.url);
        } catch {
          throw blockedError("Endpoint returned an invalid redirect location", "INVALID_REDIRECT");
        }
        // Shape/DNS validation happens at the top of the next iteration.
        requestOptions = redirectOptions(response, resolved.url, nextUrl, requestOptions);
        current = nextUrl.toString();
      }
    } finally {
      deadline.cleanup();
    }
  };
}

export const safeFetch = createSafeFetch();
