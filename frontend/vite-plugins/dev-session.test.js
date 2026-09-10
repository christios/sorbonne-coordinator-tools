import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { cookieFrom, devSession, expiryOf, hostMismatch, needsRenewal } from "./dev-session.js";

const COOKIE = "sorbonne_staff_session=header.signature";
const SCRIPT_OUTPUT = `${COOKIE}\n\n# signed in as coordinator@sorbonne.ae, valid for 12 hours\n`;

/** A Vite server that only records the middleware the plugin installs. */
function fakeServer() {
  const middlewares = [];
  return { middlewares: { use: (middleware) => middlewares.push(middleware) }, middlewares_: middlewares };
}

function start({ env = {}, run = () => SCRIPT_OUTPUT } = {}) {
  const log = { info: vi.fn() };
  // Vitest runs from frontend/, and the minting script has to be where the plugin looks.
  const plugin = devSession({ backend: resolve(process.cwd(), "..", "backend"), env, run, log });
  plugin.configResolved({ root: process.cwd() });
  const server = fakeServer();
  plugin.configureServer(server);
  return { log, middleware: server.middlewares_[0] };
}

/** Ask the installed middleware what it would do with one request. */
function request(middleware, headers = { accept: "text/html" }) {
  const set = {};
  const next = vi.fn();
  middleware({ headers }, { setHeader: (name, value) => (set[name] = value) }, next);
  return { set, next };
}

describe("dev session", () => {
  it("reads the cookie the minting script printed", () => {
    expect(cookieFrom(SCRIPT_OUTPUT)).toBe(COOKIE);
  });

  it("ignores output that carries no cookie", () => {
    expect(cookieFrom("SESSION_SECRET is not set in backend/.env\n")).toBe("");
  });

  it("signs the browser in on the page request", () => {
    const { middleware } = start();

    const { set, next } = request(middleware);

    expect(set["Set-Cookie"]).toBe(`${COOKIE}; Path=/; SameSite=Lax`);
    expect(next).toHaveBeenCalled();
  });

  it("leaves the assets and the API alone", () => {
    const { middleware } = start();

    expect(request(middleware, { accept: "application/json" }).set["Set-Cookie"]).toBeUndefined();
  });

  it("browses as whoever DEV_SESSION_EMAIL names", () => {
    const run = vi.fn(() => SCRIPT_OUTPUT);

    start({ env: { DEV_SESSION_EMAIL: "patricia@sorbonne.ae" }, run });

    expect(run.mock.calls[0][1]).toContain("patricia@sorbonne.ae");
  });

  it("stays out of the way when it is switched off", () => {
    const run = vi.fn();

    const { middleware } = start({ env: { DEV_SESSION: "off" }, run });

    expect(middleware).toBeUndefined();
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to the sign-in screen when the script cannot mint a session", () => {
    const { middleware } = start({
      run: () => {
        throw new Error("uv: command not found");
      },
    });

    expect(middleware).toBeUndefined();
  });

  it("warns when the cookie's host is not the API's host", () => {
    // A cookie set on 127.0.0.1 is never sent to localhost:8000, so every call 401s.
    expect(hostMismatch("127.0.0.1:3000", "http://localhost:8000")).toEqual({
      browser: "127.0.0.1",
      api: "localhost",
    });
    expect(hostMismatch("localhost:3000", "http://localhost:8000")).toBeNull();
  });
});

/** A cookie whose session ends at `exp` seconds since the epoch, shaped like the real one. */
function cookieEndingAt(exp) {
  const payload = Buffer.from(JSON.stringify({ email: "c@sorbonne.ae", exp })).toString("base64url");
  return `sorbonne_staff_session=${payload}.signature`;
}

/*
 * A session lasts twelve hours; a dev server under the keeper runs for days. The cookie
 * minted at start-up went stale while the server was still serving, and every page load
 * then handed the browser a dying token — which read as "sign in" on a machine where
 * sign-in is supposed to be automatic.
 */
describe("a dev session that outlives its cookie", () => {
  const NOW = 1_700_000_000;

  it("reads when a cookie's session ends", () => {
    expect(expiryOf(cookieEndingAt(NOW + 100))).toBe(NOW + 100);
    expect(expiryOf("sorbonne_staff_session=not.a.token")).toBe(0);
  });

  it("wants a fresh one an hour before the end, and not before", () => {
    expect(needsRenewal(cookieEndingAt(NOW + 3 * 3600), NOW)).toBe(false);
    expect(needsRenewal(cookieEndingAt(NOW + 30 * 60), NOW)).toBe(true);
    expect(needsRenewal(cookieEndingAt(NOW - 1), NOW)).toBe(true);
    // Unreadable is treated as stale rather than trusted for ever.
    expect(needsRenewal("sorbonne_staff_session=garbage", NOW)).toBe(true);
  });

  it("mints again on the page load that finds the cookie stale", () => {
    const stale = cookieEndingAt(Math.floor(Date.now() / 1000) - 10);
    const fresh = cookieEndingAt(Math.floor(Date.now() / 1000) + 12 * 3600);
    const outputs = [`${stale}\n`, `${fresh}\n`];
    const run = vi.fn(() => outputs.shift());
    const { middleware } = start({ run });

    const { set } = request(middleware);

    expect(run).toHaveBeenCalledTimes(2);
    expect(set["Set-Cookie"]).toBe(`${fresh}; Path=/; SameSite=Lax`);
  });

  it("does not mint again while the cookie is still good", () => {
    const fresh = cookieEndingAt(Math.floor(Date.now() / 1000) + 12 * 3600);
    const run = vi.fn(() => `${fresh}\n`);
    const { middleware } = start({ run });

    request(middleware);
    request(middleware);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps the old cookie when a re-mint fails, rather than serving none", () => {
    const stale = cookieEndingAt(Math.floor(Date.now() / 1000) - 10);
    let calls = 0;
    const run = vi.fn(() => {
      calls += 1;
      if (calls > 1) throw new Error("uv: backend went away");
      return `${stale}\n`;
    });
    const { middleware } = start({ run });

    const { set } = request(middleware);

    expect(set["Set-Cookie"]).toBe(`${stale}; Path=/; SameSite=Lax`);
  });
});
