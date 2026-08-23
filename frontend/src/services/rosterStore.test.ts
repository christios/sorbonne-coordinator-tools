import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { describeAge, forgetRosters, lastSync, loadPull, rememberPull, rememberSync } from "@/services/rosterStore";
import type { PortalRoster } from "@/services/scenRosters";

const pull = (fetchedAt: number, rows: { SPRIDEN_ID: string; YEARLEVEL_CODE?: string }[]): PortalRoster => ({
  presetId: "scen-fy",
  name: "SCEN — First Year",
  count: rows.length,
  expect: rows.length,
  warning: null,
  fetchedAt,
  rows,
});

beforeEach(() => forgetRosters());
afterEach(() => forgetRosters());

describe("the browser's roster store", () => {
  it("gives a pull back after the page has been left and returned to", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));

    expect(loadPull("scen-fy").current?.rows).toEqual([{ SPRIDEN_ID: "A001" }]);
  });

  it("knows nothing about a preset that was never pulled", () => {
    expect(loadPull("scen-l2")).toEqual({});
  });

  it("keeps each saved search apart", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));
    rememberPull({ ...pull(2000, [{ SPRIDEN_ID: "B001" }]), presetId: "scen-l1" });

    expect(loadPull("scen-fy").current?.rows).toEqual([{ SPRIDEN_ID: "A001" }]);
    expect(loadPull("scen-l1").current?.rows).toEqual([{ SPRIDEN_ID: "B001" }]);
  });

  it("keeps the pull before this one, which is what changed compares against", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }]));

    const stored = rememberPull(pull(2000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "L1" }]));

    expect(stored.previous?.fetchedAt).toBe(1000);
    expect(stored.current?.fetchedAt).toBe(2000);
  });

  it("does not throw the comparison away when the same pull is stored twice", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));
    rememberPull(pull(2000, [{ SPRIDEN_ID: "A001" }]));

    // A re-render, or a second save of the same response, must not lose the older pull.
    const stored = rememberPull(pull(2000, [{ SPRIDEN_ID: "A001" }]));

    expect(stored.previous?.fetchedAt).toBe(1000);
  });

  it("forgets everything when asked", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));

    forgetRosters();

    expect(loadPull("scen-fy")).toEqual({});
  });

  it("survives storage that cannot be read", () => {
    window.localStorage.setItem("scen-rosters:v1", "not json");

    expect(loadPull("scen-fy")).toEqual({});
  });

  it("says how old a pull is in words", () => {
    const now = Date.parse("2026-08-22T12:00:00Z");

    expect(describeAge(now - 30_000, now)).toBe("just now");
    expect(describeAge(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(describeAge(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(describeAge(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });
});

describe("when each view last synced", () => {
  it("keeps a moment per view, so one sync does not claim the others", () => {
    // A single shared moment meant only the view synced last ever showed a new student:
    // everyone else's arrivals were measured against a sync that was not theirs.
    rememberSync("fy", "2026-08-23T10:00:00+00:00");
    rememberSync("l1", "2026-08-23T11:00:00+00:00");

    expect(lastSync("fy")).toBe("2026-08-23T10:00:00+00:00");
    expect(lastSync("l1")).toBe("2026-08-23T11:00:00+00:00");
    expect(lastSync("never-synced")).toBe("");
  });
});
