import { beforeEach, describe, expect, it } from "vitest";

import {
  fieldsSeen,
  forgetHistory,
  historyFor,
  historySummary,
  historyForBackup,
  loadHistory,
  mergeHistories,
  resetSweepForTests,
  restoreHistories,
  recordPull,
} from "@/services/pullHistory";
import type { RosterRow } from "@/services/scenRosters";

const VIEW = "view-1";

const row = (id: string, over: Partial<RosterRow> = {}): RosterRow => ({
  SPRIDEN_ID: id,
  FULL_NAME: "Amira Haddad",
  YEARLEVEL_CODE: "FY",
  MAJOR_CODE_DESC: "Mathematics",
  ...over,
});

beforeEach(async () => {
  window.localStorage.clear();
  await forgetHistory();
});

describe("recording pulls", () => {
  it("treats the first pull as a baseline rather than a wave of arrivals", async () => {
    const history = await recordPull(VIEW, [row("A001"), row("A002")], 1_000);

    expect(history.pulls).toHaveLength(1);
    expect(history.pulls[0].arrived).toEqual([]);
    expect(historyFor(history, "A001")).toEqual([]);
  });

  it("records only the fields that moved", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    const history = await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" })], 2_000);

    expect(history.pulls[1].changed).toEqual({
      A001: [{ field: "YEARLEVEL_CODE", from: "FY", to: "L1" }],
    });
  });

  it("notices a field that has appeared, and one that has gone", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    const history = await recordPull(VIEW, 
      [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY", PSUAD_EMAIL: "a@b.c" }],
      2_000,
    );

    expect(history.pulls[1].changed.A001).toEqual([
      { field: "MAJOR_CODE_DESC", from: "Mathematics", to: "" },
      { field: "PSUAD_EMAIL", from: "", to: "a@b.c" },
    ]);
  });

  it("marks who arrived and who the portal stopped returning", async () => {
    await recordPull(VIEW, [row("A001"), row("A002")], 1_000);

    const history = await recordPull(VIEW, [row("A001"), row("A003")], 2_000);

    expect(history.pulls[1].arrived).toEqual(["A003"]);
    expect(history.pulls[1].departed).toEqual(["A002"]);
  });

  it("keeps the last known values of a student the portal has dropped", async () => {
    await recordPull(VIEW, [row("A001"), row("A002")], 1_000);

    const history = await recordPull(VIEW, [row("A001")], 2_000);

    expect(history.latest.A002.FULL_NAME).toBe("Amira Haddad");
  });

  it("stores nothing for a pull in which nothing moved", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    const history = await recordPull(VIEW, [row("A001")], 2_000);

    expect(history.pulls[1].changed).toEqual({});
    expect(history.pulls[1].arrived).toEqual([]);
    expect(history.pulls[1].departed).toEqual([]);
  });

  it("ignores a blank becoming a missing field, which is the same absence twice", async () => {
    await recordPull(VIEW, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira", MAJOR_CODE_DESC: "  " }], 1_000);

    const history = await recordPull(VIEW, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira" }], 2_000);

    expect(history.pulls[1].changed).toEqual({});
  });

  it("survives a round trip through storage", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001", { MAJOR_CODE_DESC: "Physics" })], 2_000);

    expect(historyFor(await loadHistory(VIEW), "A001")).toHaveLength(1);
  });

  it("falls back to an empty history when storage holds nonsense", async () => {
    window.localStorage.setItem("scen-pull-history:v1", "not json");

    expect((await loadHistory(VIEW)).pulls).toEqual([]);
  });
});

describe("one student's history", () => {
  it("leaves out the pulls nothing happened in, newest first", async () => {
    await recordPull(VIEW, [row("A001"), row("A002")], 1_000);
    await recordPull(VIEW, [row("A001"), row("A002")], 2_000); // quiet
    await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" }), row("A002")], 3_000);
    await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" }), row("A002")], 4_000); // quiet
    const history = await recordPull(VIEW, 
      [row("A001", { YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" }), row("A002")],
      5_000,
    );

    const entries = historyFor(history, "A001");

    expect(entries.map((entry) => entry.at)).toEqual([5_000, 3_000]);
    expect(entries[0].changes).toEqual([
      { field: "MAJOR_CODE_DESC", from: "Mathematics", to: "Physics" },
    ]);
  });

  it("says how much was collapsed, so the quiet pulls are still accounted for", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001")], 2_000);
    await recordPull(VIEW, [row("A001", { MAJOR_CODE_DESC: "Physics" })], 3_000);

    expect(historySummary(await loadHistory(VIEW), "A001")).toEqual({ shown: 1, total: 3, quiet: 2 });
  });

  it("shows an arrival and a departure as events in their own right", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001"), row("A002")], 2_000);
    const history = await recordPull(VIEW, [row("A001")], 3_000);

    expect(historyFor(history, "A002").map((entry) => entry.kind)).toEqual(["departed", "arrived"]);
  });

  it("has nothing to say about a student it has never seen", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    expect(historyFor(await loadHistory(VIEW), "A999")).toEqual([]);
  });
});

describe("the fields the history knows about", () => {
  it("names every field any pull has carried", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001", { PSUAD_EMAIL: "a@b.c" })], 2_000);

    expect(fieldsSeen(await loadHistory(VIEW))).toEqual([
      "FULL_NAME",
      "MAJOR_CODE_DESC",
      "PSUAD_EMAIL",
      "SPRIDEN_ID",
      "YEARLEVEL_CODE",
    ]);
  });
});

describe("a history per view", () => {
  it("does not show one view's pulls in another's history", async () => {
    // Four views synced once each used to read as four pulls against whichever view you
    // happened to be looking at.
    await recordPull("fy", [row("A001")], 1_000);
    await recordPull("l1", [row("A002")], 2_000);
    await recordPull("l2", [row("A003")], 3_000);

    expect((await loadHistory("fy")).pulls).toHaveLength(1);
    expect((await loadHistory("l1")).pulls).toHaveLength(1);
    expect((await loadHistory("l2")).pulls).toHaveLength(1);
  });

  it("does not treat a student another view returned as having left this one", async () => {
    await recordPull("fy", [row("A001")], 1_000);
    await recordPull("l1", [row("A002")], 2_000);

    expect((await loadHistory("fy")).pulls[0].departed).toEqual([]);
    expect((await loadHistory("l1")).pulls[0].departed).toEqual([]);
  });

  it("forgets one view without forgetting the rest", async () => {
    await recordPull("fy", [row("A001")], 1_000);
    await recordPull("l1", [row("A002")], 2_000);

    await forgetHistory("fy");

    expect((await loadHistory("fy")).pulls).toEqual([]);
    expect((await loadHistory("l1")).pulls).toHaveLength(1);
  });
});

describe("leaving is a transition, not a state", () => {
  it("reports a departure once, not at every pull after it", async () => {
    await recordPull(VIEW, [row("A001"), row("A002")], 1_000);
    await recordPull(VIEW, [row("A001")], 2_000);
    await recordPull(VIEW, [row("A001")], 3_000);
    const history = await recordPull(VIEW, [row("A001")], 4_000);

    // A002 left once. The three pulls since are not three more departures.
    expect(history.pulls.map((pull) => pull.departed)).toEqual([[], ["A002"], [], []]);
    expect(historyFor(history, "A002")).toHaveLength(1);
  });

  it("counts a student the view returns again as newly arrived", async () => {
    await recordPull(VIEW, [row("A001"), row("A002")], 1_000);
    await recordPull(VIEW, [row("A001")], 2_000);
    const history = await recordPull(VIEW, [row("A001"), row("A002")], 3_000);

    expect(history.pulls[2].arrived).toEqual(["A002"]);
    expect(history.pulls[2].departed).toEqual([]);
  });

  it("keeps a departed student's values, so their history still reads", async () => {
    await recordPull(VIEW, [row("A002", { FULL_NAME: "Karim Nasser" })], 1_000);
    const history = await recordPull(VIEW, [], 2_000);

    expect(history.latest.A002.FULL_NAME).toBe("Karim Nasser");
    expect(history.present).toEqual([]);
  });
});

/*
 * Keys left behind by a migration that returned before it got to them.
 *
 * v1 held one shared history that could not be split into per-view ones, so it was
 * superseded rather than converted — and then stranded, because once the database holds
 * the history the read returns before it looks at localStorage again. It was still
 * sitting in a real coordinator's browser at 0.17 MB.
 */
describe("keys nothing reads any more", () => {
  it("clears them even when the history is already in the database", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    window.localStorage.setItem("scen-pull-history:v1", "x".repeat(1000));
    window.localStorage.setItem("scen-rosters:synced", "{}");
    // A fresh page: the sweep runs once, and this is that once.
    resetSweepForTests();

    await loadHistory(VIEW);

    expect(window.localStorage.getItem("scen-pull-history:v1")).toBeNull();
    expect(window.localStorage.getItem("scen-rosters:synced")).toBeNull();
  });

  it("leaves the keys that are still in use alone", async () => {
    window.localStorage.setItem("scen-rosters:synced:v2", '{"fy":"2026-08-23"}');
    window.localStorage.setItem("scen-student-columns:v1", '{"order":[]}');
    resetSweepForTests();

    await loadHistory(VIEW);

    expect(window.localStorage.getItem("scen-rosters:synced:v2")).toBe('{"fy":"2026-08-23"}');
    expect(window.localStorage.getItem("scen-student-columns:v1")).toBe('{"order":[]}');
  });
});

/*
 * A backup and a browser are two partial accounts of the same thing: the file may be
 * older, the browser may have been wiped and re-synced since, and either may hold pulls
 * the other never saw. Restoring has to bring them together without inventing anything.
 */
describe("bringing a restored history together with this browser's", () => {
  const record = (at: number, changed: Record<string, { field: string; from: string; to: string }[]> = {}) => ({
    id: `${at}`,
    at,
    count: 1,
    changed,
    arrived: [],
    departed: [],
  });
  const history = (pulls: ReturnType<typeof record>[], latest = {}, present: string[] = []) => ({
    pulls,
    latest,
    present,
  });

  it("keeps the pulls only the backup has", () => {
    const mine = history([record(3_000)]);
    const theirs = history([record(1_000), record(2_000)]);

    expect(mergeHistories(mine, theirs).pulls.map((p) => p.at)).toEqual([1_000, 2_000, 3_000]);
  });

  it("changes nothing when the same file is restored twice", () => {
    const theirs = history([record(1_000), record(2_000)]);
    const once = mergeHistories(history([]), theirs);

    expect(mergeHistories(once, theirs)).toEqual(once);
  });

  it("takes the newer side's snapshot whole, rather than mixing two", () => {
    // latest and present describe one moment; a blend of two would be a moment that
    // never happened.
    const mine = history([record(3_000)], { A001: { FULL_NAME: "Newer" } }, ["A001"]);
    const theirs = history([record(1_000)], { A001: { FULL_NAME: "Older" }, B002: { FULL_NAME: "Gone" } }, ["A001", "B002"]);

    const merged = mergeHistories(mine, theirs);
    expect(merged.latest).toEqual({ A001: { FULL_NAME: "Newer" } });
    expect(merged.present).toEqual(["A001"]);
  });

  it("takes the backup's snapshot when the backup is the newer one", () => {
    const mine = history([record(1_000)], { A001: { FULL_NAME: "Older" } }, ["A001"]);
    const theirs = history([record(9_000)], { A001: { FULL_NAME: "Newer" } }, ["A001"]);

    expect(mergeHistories(mine, theirs).latest).toEqual({ A001: { FULL_NAME: "Newer" } });
  });

  it("lets this browser's account of a pull stand where both saw it", () => {
    const mine = history([record(1_000, { A001: [{ field: "YEARLEVEL_CODE", from: "FY", to: "L1" }] })]);
    const theirs = history([record(1_000)]);

    expect(mergeHistories(mine, theirs).pulls[0].changed).toEqual({
      A001: [{ field: "YEARLEVEL_CODE", from: "FY", to: "L1" }],
    });
  });

  it("rebuilds a wiped browser from a backup", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" })], 2_000);
    const saved = await historyForBackup();

    await forgetHistory();
    expect((await loadHistory(VIEW)).pulls).toEqual([]);

    const touched = await restoreHistories(saved);

    expect(touched).toBe(1);
    expect((await loadHistory(VIEW)).pulls).toHaveLength(2);
    expect(historyFor(await loadHistory(VIEW), "A001")).toHaveLength(1);
  });

  it("does not double up when a backup is restored over a live history", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);
    const saved = await historyForBackup();

    await restoreHistories(saved);

    expect((await loadHistory(VIEW)).pulls).toHaveLength(1);
  });

  it("ignores a file whose histories are not histories", async () => {
    await restoreHistories({ "view-x": { pulls: "nonsense" } as never });

    expect((await loadHistory("view-x")).pulls).toEqual([]);
  });
});
