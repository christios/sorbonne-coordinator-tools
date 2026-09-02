import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as browser from "@/services/browserStore";
import {
  describeAge,
  fieldHeld,
  forgetRosters,
  lastSync,
  loadPull,
  namesHeld,
  rememberPull,
  rememberSync,
  rowsHeld,
  storageReport,
} from "@/services/rosterStore";
import type { PortalRoster } from "@/services/scenRosters";

const KEY = "scen-rosters:v2";

const pull = (fetchedAt: number, rows: { SPRIDEN_ID: string; YEARLEVEL_CODE?: string }[]): PortalRoster => ({
  presetId: "scen-fy",
  name: "SCEN — First Year",
  count: rows.length,
  expect: rows.length,
  warning: null,
  fetchedAt,
  rows,
});

/** What the store actually put in the drawer, as text, for size and shape assertions. */
const raw = async () => JSON.stringify((await browser.read(KEY)) ?? "");

beforeEach(async () => {
  window.localStorage.clear();
  await forgetRosters();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await forgetRosters();
});

describe("the browser's roster store", () => {
  it("gives a pull back after the page has been left and returned to", async () => {
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));

    expect((await loadPull("scen-fy")).current?.rows).toEqual([{ SPRIDEN_ID: "A001" }]);
  });

  it("knows nothing about a preset that was never pulled", async () => {
    expect(await loadPull("scen-l2")).toEqual({});
  });

  it("keeps each saved search apart", async () => {
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));
    await rememberPull({ ...pull(2000, [{ SPRIDEN_ID: "B001" }]), presetId: "scen-l1" });

    expect((await loadPull("scen-fy")).current?.rows).toEqual([{ SPRIDEN_ID: "A001" }]);
    expect((await loadPull("scen-l1")).current?.rows).toEqual([{ SPRIDEN_ID: "B001" }]);
  });

  /*
   * The store used to keep the previous pull whole, so the table could work out what had
   * changed. The history already records that, pull by pull — so this kept a second copy
   * of 45 fields a student in order to compare six of them, and a term of it did not fit.
   */
  it("does not keep a second copy of the pull before this one", async () => {
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }]));

    const stored = await rememberPull(pull(2000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "L1" }]));

    expect(stored.current?.fetchedAt).toBe(2000);
    expect(stored.previous).toBeUndefined();
  });

  it("still reads a comparison point left by an older version", async () => {
    // A view last synced before the change, which the next sync replaces.
    await browser.write(KEY, {
      "scen-fy": {
        current: { presetId: "scen-fy", name: "n", count: 1, fetchedAt: 2000,
                   fields: ["SPRIDEN_ID"], values: [["A001"]] },
        previous: { presetId: "scen-fy", name: "n", count: 1, fetchedAt: 1000,
                    fields: ["SPRIDEN_ID", "YEARLEVEL_CODE"], values: [["A001", "FY"]] },
      },
    });

    expect((await loadPull("scen-fy")).previous?.rows).toEqual([
      { SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" },
    ]);
  });

  it("forgets everything when asked", async () => {
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));

    await forgetRosters();

    expect(await loadPull("scen-fy")).toEqual({});
  });

  it("survives storage that cannot be read", async () => {
    window.localStorage.setItem("scen-rosters:v1", "not json");

    expect(await loadPull("scen-fy")).toEqual({});
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
 * A drawer that will not take it.
 *
 * IndexedDB is measured in hundreds of megabytes rather than five, so this should not
 * happen any more — but a quota is still a quota, and the failure this guards against is
 * the one that actually bit: the write was refused, the refusal was discarded, and the
 * sync reported success over a table of students with no names.
 */
describe("when the drawer will not take it", () => {
  /** Refuse any write over `limit` characters, the way a quota does. */
  const capAt = (limit: number) => {
    const real = browser.write;
    vi.spyOn(browser, "write").mockImplementation(async (key: string, value: unknown) =>
      JSON.stringify(value).length > limit ? false : real(key, value),
    );
  };

  const wide = (id: string) => ({ SPRIDEN_ID: id, FULL_NAME: "x".repeat(400) });

  it("says so, rather than quietly losing the names", async () => {
    capAt(50);
    await rememberPull(pull(1000, [wide("A001")]));

    expect(storageReport().stored).toBe(false);
  });

  it("gives up another view's comparison point before this view's roster", async () => {
    // A comparison point from an older version — nothing writes one now, but a
    // coordinator can still be holding them, and they are what should go first.
    await rememberPull({ ...pull(2000, [wide("B002")]), presetId: "scen-l1" });
    const held = (await browser.read<Record<string, { current: unknown; previous?: unknown }>>(KEY))!;
    held["scen-l1"].previous = { ...(held["scen-l1"].current as object), fetchedAt: 1000 };
    await browser.write(KEY, held);
    expect((await loadPull("scen-l1")).previous).toBeTruthy();

    // Room for two of these rosters, not the three that current + previous + a new
    // view's pull would need.
    capAt(Math.floor(JSON.stringify(held["scen-l1"].current).length * 2.5));
    await rememberPull(pull(3000, [wide("A001")]));

    expect(storageReport().stored).toBe(true);
    expect(storageReport().shed.join(" ")).toContain("comparison point");
    // The thing on screen survived; the comparison point did not.
    expect((await loadPull("scen-fy")).current?.rows).toEqual([wide("A001")]);
    expect((await loadPull("scen-l1")).previous).toBeUndefined();
    expect((await loadPull("scen-l1")).current).toBeTruthy();
  });

  it("gives up a whole other view rather than the one being looked at", async () => {
    await rememberPull({ ...pull(1000, [wide("B001")]), presetId: "scen-l1" });
    const one = (await raw()).length;

    capAt(Math.floor(one * 1.2));
    await rememberPull(pull(3000, [wide("A001")]));

    expect(storageReport().stored).toBe(true);
    expect((await loadPull("scen-fy")).current?.rows).toEqual([wide("A001")]);
    expect((await loadPull("scen-l1")).current).toBeUndefined();
  });
});

/*
 * Packing.
 *
 * A portal row carries up to thirty-nine fields and more than half of every stored row
 * was the field names, repeated once per student.
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

  it("gives back exactly what went in", async () => {
    const rows = [wide("A001"), wide("A002")];
    await rememberPull(pull(1000, rows));

    expect((await loadPull("scen-fy")).current?.rows).toEqual(rows);
  });

  it("keeps a field one row has and another does not, without inventing it", async () => {
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" }, { SPRIDEN_ID: "A002" }]));

    const stored = (await loadPull("scen-fy")).current?.rows ?? [];
    expect(stored[0]).toEqual({ SPRIDEN_ID: "A001", YEARLEVEL_CODE: "FY" });
    expect(stored[1]).toEqual({ SPRIDEN_ID: "A002" });
    expect("YEARLEVEL_CODE" in stored[1]).toBe(false);
  });

  it("writes the field names once for the pull, not once for each student", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => wide(`A${i}`));
    await rememberPull(pull(1000, rows));

    const held = await raw();
    // One mention in `fields`, and none in the rows themselves.
    expect(held.split("MAJOR_CODE_DESC").length - 1).toBe(1);
    // Comfortably smaller than the same rows written as objects.
    expect(held.length).toBeLessThan(JSON.stringify(rows).length * 0.6);
  });

  it("carries over a store written before packing existed", async () => {
    const rows = [wide("A001"), wide("A002")];
    window.localStorage.setItem(
      "scen-rosters:v1",
      JSON.stringify({
        "scen-fy": { current: { presetId: "scen-fy", name: "SCEN — FY", count: 2, fetchedAt: 1000, rows } },
      }),
    );

    expect((await loadPull("scen-fy")).current?.rows).toEqual(rows);
    // Moved over rather than copied: two stores of names is the problem, not the fix.
    expect(window.localStorage.getItem("scen-rosters:v1")).toBeNull();
    expect(await browser.read(KEY)).toBeTruthy();
  });

  it("carries over a packed store left in localStorage before the move", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        "scen-fy": {
          current: { presetId: "scen-fy", name: "n", count: 1, fetchedAt: 1000,
                     fields: ["SPRIDEN_ID", "FULL_NAME"], values: [["A001", "Ada"]] },
        },
      }),
    );

    expect((await loadPull("scen-fy")).current?.rows).toEqual([{ SPRIDEN_ID: "A001", FULL_NAME: "Ada" }]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("the names this browser holds", () => {
  it("keeps a departed student's name, which the history still has", async () => {
    // The roster no longer returns B002, but an export still needs their name.
    await browser.write("scen-pull-history:v2", {
      "scen-fy": {
        pulls: [{ id: "1", at: 500, count: 2, changed: {}, arrived: [], departed: [] }],
        latest: {
          A001: { FULL_NAME: "Ada", MAJOR_CODE_DESC: "Maths" },
          B002: { FULL_NAME: "Grace", MAJOR_CODE_DESC: "Physics" },
        },
        present: ["A001"],
      },
    });
    await rememberPull(pull(1000, [{ SPRIDEN_ID: "A001" }]));

    expect(await namesHeld()).toEqual({ A001: "Ada", B002: "Grace" });
    expect(await fieldHeld("MAJOR_CODE_DESC")).toEqual({ A001: "Maths", B002: "Physics" });
  });

  it("prefers the pull's spelling to the history's, since it is newer", async () => {
    await browser.write("scen-pull-history:v2", {
      "scen-fy": {
        pulls: [{ id: "1", at: 500, count: 1, changed: {}, arrived: [], departed: [] }],
        latest: { A001: { FULL_NAME: "A. Lovelace" } },
        present: ["A001"],
      },
    });
    await rememberPull({
      ...pull(1000, [{ SPRIDEN_ID: "A001" }]),
      rows: [{ SPRIDEN_ID: "A001", FULL_NAME: "Ada Lovelace" }],
    });

    expect((await namesHeld()).A001).toBe("Ada Lovelace");
  });
});

/*
 * A view is a question about which students, not a separate account of what is true
 * about them. Syncing the whole-term view used to leave the same student stale in the L1
 * view — and it disagreed with the workbook export, which has always taken the newest
 * across views.
 */
describe("what the portal last said about each student", () => {
  const row = (id: string, name: string, extra: Record<string, string> = {}) => ({
    SPRIDEN_ID: id,
    FULL_NAME: name,
    ...extra,
  });

  it("takes a student's newest row whichever view pulled it", async () => {
    await rememberPull({ ...pull(1000, [row("A001", "Old Name")]), presetId: "scen-l1" });
    await rememberPull({ ...pull(2000, [row("A001", "New Name")]), presetId: "scen-term" });

    const held = await rowsHeld();

    expect(held).toHaveLength(1);
    expect(held[0].FULL_NAME).toBe("New Name");
  });

  it("does not let an older view's pull overwrite a newer one", async () => {
    // Synced in the other order: the term view is still the newer answer.
    await rememberPull({ ...pull(2000, [row("A001", "New Name")]), presetId: "scen-term" });
    await rememberPull({ ...pull(1000, [row("A001", "Old Name")]), presetId: "scen-l1" });

    expect((await rowsHeld())[0].FULL_NAME).toBe("New Name");
  });

  it("carries every student across every view, not only the one asked about", async () => {
    await rememberPull({ ...pull(1000, [row("A001", "Ada")]), presetId: "scen-l1" });
    await rememberPull({ ...pull(2000, [row("B002", "Grace")]), presetId: "scen-term" });

    const byId = new Map((await rowsHeld()).map((r) => [r.SPRIDEN_ID, r.FULL_NAME]));
    expect(byId.get("A001")).toBe("Ada");
    expect(byId.get("B002")).toBe("Grace");
  });

  it("still knows a student no view returns any more, from the history", async () => {
    await browser.write("scen-pull-history:v2", {
      "scen-l1": {
        pulls: [{ id: "1", at: 500, count: 1, changed: {}, arrived: [], departed: [] }],
        latest: { GONE1: { FULL_NAME: "Departed Student", MAJOR_CODE_DESC: "Maths" } },
        present: [],
      },
    });
    await rememberPull({ ...pull(1000, [row("A001", "Ada")]), presetId: "scen-l1" });

    const byId = new Map((await rowsHeld()).map((r) => [r.SPRIDEN_ID, r.FULL_NAME]));
    expect(byId.get("A001")).toBe("Ada");
    // Not returned by any view, but still known.
    expect((await rowsHeld()).find((r) => r.FULL_NAME === "Departed Student")).toBeTruthy();
  });

  it("prefers a pull to the history, since a pull is what just happened", async () => {
    await browser.write("scen-pull-history:v2", {
      "scen-l1": {
        pulls: [{ id: "1", at: 500, count: 1, changed: {}, arrived: [], departed: [] }],
        latest: { A001: { FULL_NAME: "Stale Name" } },
        present: ["A001"],
      },
    });
    await rememberPull({ ...pull(1000, [row("A001", "Fresh Name")]), presetId: "scen-l1" });

    expect((await rowsHeld())[0].FULL_NAME).toBe("Fresh Name");
  });

  it("agrees with the names the workbook export uses", async () => {
    await rememberPull({ ...pull(1000, [row("A001", "Old Name")]), presetId: "scen-l1" });
    await rememberPull({ ...pull(2000, [row("A001", "New Name")]), presetId: "scen-term" });

    const fromTable = (await rowsHeld()).find((r) => r.SPRIDEN_ID === "A001")?.FULL_NAME;
    expect(fromTable).toBe((await namesHeld()).A001);
  });
});
