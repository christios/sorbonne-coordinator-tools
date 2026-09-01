import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeAge, forgetRosters, lastSync, loadPull, rememberPull, rememberSync, storageReport } from "@/services/rosterStore";
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

  /*
   * The store used to keep the previous pull whole, so the table could work out what had
   * changed. The history already records that, pull by pull — so this kept a second copy
   * of 45 fields a student in order to compare six of them, and a term of it did not fit.
   */
  it("does not keep a second copy of the pull before this one", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }]));

    const stored = rememberPull(pull(2000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "L1" }]));

    expect(stored.current?.fetchedAt).toBe(2000);
    expect(stored.previous).toBeUndefined();
  });

  it("still reads a comparison point left by an older version", () => {
    // A view last synced before the change, which the next sync replaces.
    window.localStorage.setItem(
      "scen-rosters:v2",
      JSON.stringify({
        "scen-fy": {
          current: { presetId: "scen-fy", name: "n", count: 1, fetchedAt: 2000,
                     fields: ["SPRIDEN_ID"], values: [["A001"]] },
          previous: { presetId: "scen-fy", name: "n", count: 1, fetchedAt: 1000,
                      fields: ["SPRIDEN_ID", "YEARLEVEL_CODE"], values: [["A001", "FY"]] },
        },
      }),
    );

    expect(loadPull("scen-fy").previous?.rows).toEqual([{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }]);
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

/*
 * A browser that is out of room.
 *
 * This is not hypothetical: the first term is 2876 students, a pull of that size is over
 * a megabyte, it is kept twice — current and previous — and every other view a
 * coordinator has synced sits in the same five-megabyte origin quota. Before paging, a
 * whole-term pull always timed out, so it was never stored and this was never reached.
 *
 * The store used to swallow the refusal, which read on screen as a sync that worked
 * followed by a table of students with no names in it.
 */
describe("when this browser has no room left", () => {
  const realSetItem = Storage.prototype.setItem;

  /** Refuse any write over `limit` characters, the way a quota does. */
  const capAt = (limit: number) => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (value.length > limit) {
        const error = new Error("QuotaExceededError");
        error.name = "QuotaExceededError";
        throw error;
      }
      return realSetItem.call(this, key, value);
    });
  };

  afterEach(() => vi.restoreAllMocks());

  const wide = (id: string) => ({ SPRIDEN_ID: id, FULL_NAME: "x".repeat(400) });

  it("says so, rather than quietly losing the names", () => {
    capAt(50);
    rememberPull(pull(1000, [wide("A001")]));

    expect(storageReport().stored).toBe(false);
  });

  it("gives up another view's comparison point before this view's roster", () => {
    // A comparison point from an older version — nothing writes one now, but a
    // coordinator can still be holding them, and they are what should go first.
    rememberPull({ ...pull(2000, [wide("B002")]), presetId: "scen-l1" });
    const held = JSON.parse(window.localStorage.getItem("scen-rosters:v2") ?? "{}");
    held["scen-l1"].previous = { ...held["scen-l1"].current, fetchedAt: 1000 };
    window.localStorage.setItem("scen-rosters:v2", JSON.stringify(held));
    expect(loadPull("scen-l1").previous).toBeTruthy();

    // Room for two of these rosters, not the three that current + previous + a new
    // view's pull would need.
    capAt(Math.floor(JSON.stringify(loadPull("scen-l1").current).length * 2.5));
    rememberPull(pull(3000, [wide("A001")]));

    expect(storageReport().stored).toBe(true);
    expect(storageReport().shed.join(" ")).toContain("comparison point");
    // The thing on screen survived; the comparison point did not.
    expect(loadPull("scen-fy").current?.rows).toEqual([wide("A001")]);
    expect(loadPull("scen-l1").previous).toBeUndefined();
    expect(loadPull("scen-l1").current).toBeTruthy();
  });

  it("gives up a whole other view rather than the one being looked at", () => {
    rememberPull({ ...pull(1000, [wide("B001")]), presetId: "scen-l1" });
    const one = JSON.stringify(loadPull("scen-l1")).length;

    capAt(Math.floor(one * 1.2));
    rememberPull(pull(3000, [wide("A001")]));

    expect(storageReport().stored).toBe(true);
    expect(loadPull("scen-fy").current?.rows).toEqual([wide("A001")]);
    expect(loadPull("scen-l1").current).toBeUndefined();
  });
});

/*
 * Packing.
 *
 * A portal row carries up to thirty-nine fields and more than half of every stored row
 * was the field names, repeated once per student. A whole term is 2876 of them, which did
 * not fit beside the views a coordinator already had — the write was refused, the refusal
 * was discarded, and the table showed students with no names.
 */
describe("packing the rows", () => {
  const wide = (id: string) => ({
    SPRIDEN_ID: id,
    FULL_NAME: `Name ${id}`,
    MAJOR_CODE_DESC: "Applied Mathematics and Physics",
    JUSTIFY_ATTENDANCE_IND: "N",
    POTENTIAL_GRADUATE: "N",
    NATIONALITY_CAT: "GCC",
  });

  it("gives back exactly what went in", () => {
    const rows = [wide("A001"), wide("A002")];
    rememberPull(pull(1000, rows));

    expect(loadPull("scen-fy").current?.rows).toEqual(rows);
  });

  it("keeps a field one row has and another does not, without inventing it", () => {
    rememberPull(pull(1000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }, { SPRIDEN_ID: "A002" }]));

    const stored = loadPull("scen-fy").current?.rows ?? [];
    expect(stored[0]).toEqual({ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" });
    expect(stored[1]).toEqual({ SPRIDEN_ID: "A002" });
    expect("YEARLEVEL_CODE" in stored[1]).toBe(false);
  });

  it("writes the field names once for the pull, not once for each student", () => {
    const rows = Array.from({ length: 200 }, (_, i) => wide(`A${i}`));
    rememberPull(pull(1000, rows));

    const raw = window.localStorage.getItem("scen-rosters:v2") ?? "";
    // One mention in `fields`, and none in the rows themselves.
    expect(raw.split("MAJOR_CODE_DESC").length - 1).toBe(1);
    // Comfortably smaller than the same rows written as objects.
    expect(raw.length).toBeLessThan(JSON.stringify(rows).length * 0.6);
  });

  it("carries over a store written before packing existed", () => {
    const rows = [wide("A001"), wide("A002")];
    window.localStorage.setItem(
      "scen-rosters:v1",
      JSON.stringify({
        "scen-fy": { current: { presetId: "scen-fy", name: "SCEN — FY", count: 2, fetchedAt: 1000, rows } },
      }),
    );

    expect(loadPull("scen-fy").current?.rows).toEqual(rows);
    // Moved over rather than copied: two stores of names is the problem, not the fix.
    expect(window.localStorage.getItem("scen-rosters:v1")).toBeNull();
    expect(window.localStorage.getItem("scen-rosters:v2")).toBeTruthy();
  });
});
