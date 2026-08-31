import { describe, expect, it } from "vitest";

import { PortalError, silenceMeans } from "@/services/scenRosters";

/**
 * What a coordinator is told when a pull fails.
 *
 * The bug this pins: every code without a case of its own read "the registrar portal
 * returned an unexpected error", including the extension refusing the request before the
 * portal was ever asked. That sent people to check the portal when the answer was here.
 */
describe("what a failed pull says", () => {
  it("passes on the extension's reason for refusing", () => {
    const error = new PortalError("filter_refused", "sensitive_field:PASSPORT_ID");

    expect(error.message).toContain("would not ask the portal that");
    expect(error.message).toContain("sensitive_field:PASSPORT_ID");
  });

  it("says the portal answered with an error, and with what", () => {
    expect(new PortalError("http", "500").message).toMatch(/portal answered with an error \(500\)/);
  });

  it("names the extension when the extension is what broke", () => {
    expect(new PortalError("internal", "ReferenceError: x").message).toMatch(
      /extension failed: ReferenceError/,
    );
  });

  it("still explains the ordinary failures in plain words", () => {
    expect(new PortalError("auth").message).toMatch(/session has expired/);
    expect(new PortalError("network").message).toMatch(/could not be reached/);
    expect(new PortalError("extension_unavailable", "context invalidated").message).toMatch(
      /Reload this page/,
    );
  });

  it("carries the detail even for a code it has never heard of", () => {
    // The point: an unknown code must not swallow what little is known about it.
    expect(new PortalError("something_new", "the details").message).toContain("the details");
  });

  it("does not tell somebody to install what they have already installed", () => {
    /*
     * The bug reported from production. Syncing the first term — 2876 students in one
     * request — ran past the timeout, and a timeout was reported with the same code as a
     * missing extension. The coordinator was told to install a thing that was working.
     */
    expect(new PortalError("timed_out").message).not.toMatch(/install/i);
    expect(new PortalError("timed_out").message).toMatch(/did not finish answering/);
    expect(new PortalError("timed_out").message).toMatch(/narrow the view's filter/);
  });
});

/**
 * Silence says nothing about its own cause, so the answer is to ask.
 *
 * An extension that replies to a ping in a moment is present and was merely still
 * working; one that does not is not there. The two want opposite advice — "try again or
 * narrow the filter" against "install the extension" — and before this they got the same.
 *
 * The decision is tested here; that it is reached through a real ping is verified in a
 * browser, because jsdom does not deliver postMessage on a clock any test can advance.
 */
describe("telling a slow extension from an absent one", () => {
  it("blames the portal when the extension answers a ping", () => {
    expect(silenceMeans(true)).toBe("timed_out");
    expect(new PortalError(silenceMeans(true)).message).toMatch(/did not finish answering/);
  });

  it("blames the extension when it answers nothing at all", () => {
    expect(silenceMeans(false)).toBe("extension_unavailable");
    expect(new PortalError(silenceMeans(false)).message).toMatch(/Install it/);
  });
});
