import { describe, expect, it } from "vitest";

import { PortalError } from "@/services/scenRosters";

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
});
