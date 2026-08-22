import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { cookieFrom, devSession, hostMismatch } from "./dev-session.js";

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
