import { afterEach, describe, expect, it, vi } from "vitest";
import { launchChromiumWithGuard, newRestrictedPage } from "../src/playwright-guard.js";
import { createSafeFetch } from "../src/ssrf-guard.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalUnsafeEscape = process.env.PLAYWRIGHT_ALLOW_NO_SANDBOX;

function fakeBrowser() {
  return {
    close: vi.fn(async () => {}),
    on: vi.fn(),
  };
}

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalUnsafeEscape === undefined) delete process.env.PLAYWRIGHT_ALLOW_NO_SANDBOX;
  else process.env.PLAYWRIGHT_ALLOW_NO_SANDBOX = originalUnsafeEscape;
  delete process.env.SECRET_FOR_BROWSER_TEST;
});

describe("launchChromiumWithGuard", () => {
  it("enables Chromium sandboxing and removes application secrets from the browser environment", async () => {
    process.env.NODE_ENV = "production";
    process.env.SECRET_FOR_BROWSER_TEST = "do-not-inherit";
    const browser = fakeBrowser();
    const chromium = { launch: vi.fn(async () => browser) };

    const launched = await launchChromiumWithGuard(chromium, {
      headless: true,
      args: ["--disable-gpu"],
    });
    const options = chromium.launch.mock.calls[0][0];
    expect(options.chromiumSandbox).toBe(true);
    expect(options.args).not.toContain("--no-sandbox");
    expect(options.env.SECRET_FOR_BROWSER_TEST).toBeUndefined();
    await launched.close();
  });

  it("rejects attempts to disable the sandbox in production", async () => {
    process.env.NODE_ENV = "production";
    const chromium = { launch: vi.fn() };
    await expect(launchChromiumWithGuard(chromium, {
      args: ["--no-sandbox"],
    })).rejects.toMatchObject({ code: "PLAYWRIGHT_SKIPPED" });
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it("holds a global launch reservation until the first browser closes", async () => {
    process.env.NODE_ENV = "test";
    const first = fakeBrowser();
    const second = fakeBrowser();
    const chromium = { launch: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };

    const launchedFirst = await launchChromiumWithGuard(chromium, {}, { playwrightMaxConcurrent: 1 });
    const secondPromise = launchChromiumWithGuard(chromium, {}, { playwrightMaxConcurrent: 1 });
    await Promise.resolve();
    expect(chromium.launch).toHaveBeenCalledTimes(1);

    await launchedFirst.close();
    const launchedSecond = await secondPromise;
    expect(chromium.launch).toHaveBeenCalledTimes(2);
    await launchedSecond.close();
  });

  it("allows an unsandboxed launch only with the explicit non-production escape hatch", async () => {
    process.env.NODE_ENV = "development";
    process.env.PLAYWRIGHT_ALLOW_NO_SANDBOX = "1";
    const browser = fakeBrowser();
    const chromium = { launch: vi.fn(async () => browser) };
    const launched = await launchChromiumWithGuard(chromium, { chromiumSandbox: false });
    expect(chromium.launch.mock.calls[0][0].chromiumSandbox).toBe(false);
    await launched.close();
  });
});

function restrictedBrowserFixture() {
  let httpHandler;
  let websocketHandler;
  const page = {};
  const context = {
    addInitScript: vi.fn(async () => {}),
    route: vi.fn(async (_pattern, handler) => { httpHandler = handler; }),
    routeWebSocket: vi.fn(async (_pattern, handler) => { websocketHandler = handler; }),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = { newContext: vi.fn(async () => context) };
  return {
    browser,
    context,
    page,
    getHttpHandler: () => httpHandler,
    getWebsocketHandler: () => websocketHandler,
  };
}

function fakeRoute(url = "https://jobs.example.com/opening") {
  const request = {
    url: () => url,
    method: () => "GET",
    headers: () => ({ accept: "text/html", "accept-encoding": "gzip" }),
    postDataBuffer: () => null,
  };
  return {
    request: () => request,
    fulfill: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
}

describe("newRestrictedPage", () => {
  it("proxies browser requests through the safe transport and blocks service workers", async () => {
    const fixture = restrictedBrowserFixture();
    const fetcher = vi.fn(async () => new Response("page", {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "4" },
    }));

    const page = await newRestrictedPage(fixture.browser, {
      allowedHosts: ["example.com"],
      fetcher,
    });
    expect(page).toBe(fixture.page);
    expect(fixture.browser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      serviceWorkers: "block",
      ignoreHTTPSErrors: false,
    }));

    const route = fakeRoute();
    await fixture.getHttpHandler()(route);
    expect(fetcher).toHaveBeenCalledWith(
      "https://jobs.example.com/opening",
      expect.objectContaining({ redirect: "manual" }),
      expect.objectContaining({ requireHttps: true, allowedHosts: ["example.com"] }),
    );
    expect(fetcher.mock.calls[0][1].headers["accept-encoding"]).toBe("identity");
    expect(route.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(route.abort).not.toHaveBeenCalled();
  });

  it("aborts private and non-allowlisted browser destinations before transport", async () => {
    const fixture = restrictedBrowserFixture();
    const transport = vi.fn();
    const fetcher = createSafeFetch({
      lookup: vi.fn(async () => [{ address: "169.254.169.254", family: 4 }]),
      transport,
    });
    await newRestrictedPage(fixture.browser, {
      allowedHosts: ["example.com"],
      fetcher,
    });

    const privateRoute = fakeRoute("https://jobs.example.com/latest/meta-data");
    await fixture.getHttpHandler()(privateRoute);
    expect(privateRoute.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(transport).not.toHaveBeenCalled();

    const foreignRoute = fakeRoute("https://attacker.invalid/collect");
    await fixture.getHttpHandler()(foreignRoute);
    expect(foreignRoute.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(transport).not.toHaveBeenCalled();
  });

  it("blocks browser WebSockets without opening a server connection", async () => {
    const fixture = restrictedBrowserFixture();
    await newRestrictedPage(fixture.browser, {
      allowedHosts: ["example.com"],
      fetcher: vi.fn(),
    });
    const socket = { close: vi.fn(async () => {}), connectToServer: vi.fn() };
    await fixture.getWebsocketHandler()(socket);
    expect(socket.close).toHaveBeenCalledWith(expect.objectContaining({ code: 1008 }));
    expect(socket.connectToServer).not.toHaveBeenCalled();
  });

  it("can freeze every HTTP request before sensitive fields are filled", async () => {
    const fixture = restrictedBrowserFixture();
    const fetcher = vi.fn();
    await newRestrictedPage(fixture.browser, {
      allowedHosts: [/^jobs\.example\.com$/],
      fetcher,
      allowRequest: () => false,
    });
    const route = fakeRoute("https://jobs.example.com/collect?email=private");
    await fixture.getHttpHandler()(route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
