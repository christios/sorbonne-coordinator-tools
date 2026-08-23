import { beforeEach, describe, expect, it } from "vitest";

import {
  fieldsSeen,
  forgetHistory,
  historyFor,
  historySummary,
  loadHistory,
  recordPull,
} from "@/services/pullHistory";
import type { RosterRow } from "@/services/scenRosters";

const row = (id: string, over: Partial<RosterRow> = {}): RosterRow => ({
  SPRIDEN_ID: id,
  FULL_NAME: "Amira Haddad",
  YEARLEVEL_CODE: "FY",
  MAJOR_CODE_DESC: "Mathematics",
  ...over,
});

beforeEach(() => forgetHistory());

describe("recording pulls", () => {
  it("treats the first pull as a baseline rather than a wave of arrivals", () => {
    const history = recordPull([row("A001"), row("A002")], 1_000);

    expect(history.pulls).toHaveLength(1);
    expect(history.pulls[0].arrived).toEqual([]);
    expect(historyFor(history, "A001")).toEqual([]);
  });

  it("records only the fields that moved", () => {
    recordPull([row("A001")], 1_000);

    const history = recordPull([row("A001", { YEARLEVEL_CODE: "L1" })], 2_000);

    expect(history.pulls[1].changed).toEqual({
      A001: [{ field: "YEARLEVEL_CODE", from: "FY", to: "L1" }],
    });
  });

  it("notices a field that has appeared, and one that has gone", () => {
    recordPull([row("A001")], 1_000);

    const history = recordPull(
      [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY", PSUAD_EMAIL: "a@b.c" }],
      2_000,
    );

    expect(history.pulls[1].changed.A001).toEqual([
      { field: "MAJOR_CODE_DESC", from: "Mathematics", to: "" },
      { field: "PSUAD_EMAIL", from: "", to: "a@b.c" },
    ]);
  });

  it("marks who arrived and who the portal stopped returning", () => {
    recordPull([row("A001"), row("A002")], 1_000);

    const history = recordPull([row("A001"), row("A003")], 2_000);

    expect(history.pulls[1].arrived).toEqual(["A003"]);
    expect(history.pulls[1].departed).toEqual(["A002"]);
  });

  it("keeps the last known values of a student the portal has dropped", () => {
    recordPull([row("A001"), row("A002")], 1_000);

    const history = recordPull([row("A001")], 2_000);

    expect(history.latest.A002.FULL_NAME).toBe("Amira Haddad");
  });

  it("stores nothing for a pull in which nothing moved", () => {
    recordPull([row("A001")], 1_000);

    const history = recordPull([row("A001")], 2_000);

    expect(history.pulls[1].changed).toEqual({});
    expect(history.pulls[1].arrived).toEqual([]);
    expect(history.pulls[1].departed).toEqual([]);
  });

  it("ignores a blank becoming a missing field, which is the same absence twice", () => {
    recordPull([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira", MAJOR_CODE_DESC: "  " }], 1_000);

    const history = recordPull([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira" }], 2_000);

    expect(history.pulls[1].changed).toEqual({});
  });

  it("survives a round trip through storage", () => {
    recordPull([row("A001")], 1_000);
    recordPull([row("A001", { MAJOR_CODE_DESC: "Physics" })], 2_000);

    expect(historyFor(loadHistory(), "A001")).toHaveLength(1);
  });

  it("falls back to an empty history when storage holds nonsense", () => {
    window.localStorage.setItem("scen-pull-history:v1", "not json");

    expect(loadHistory().pulls).toEqual([]);
  });
});

describe("one student's history", () => {
  it("leaves out the pulls nothing happened in, newest first", () => {
    recordPull([row("A001"), row("A002")], 1_000);
    recordPull([row("A001"), row("A002")], 2_000); // quiet
    recordPull([row("A001", { YEARLEVEL_CODE: "L1" }), row("A002")], 3_000);
    recordPull([row("A001", { YEARLEVEL_CODE: "L1" }), row("A002")], 4_000); // quiet
    const history = recordPull(
      [row("A001", { YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" }), row("A002")],
      5_000,
    );

    const entries = historyFor(history, "A001");

    expect(entries.map((entry) => entry.at)).toEqual([5_000, 3_000]);
    expect(entries[0].changes).toEqual([
      { field: "MAJOR_CODE_DESC", from: "Mathematics", to: "Physics" },
    ]);
  });

  it("says how much was collapsed, so the quiet pulls are still accounted for", () => {
    recordPull([row("A001")], 1_000);
    recordPull([row("A001")], 2_000);
    recordPull([row("A001", { MAJOR_CODE_DESC: "Physics" })], 3_000);

    expect(historySummary(loadHistory(), "A001")).toEqual({ shown: 1, total: 3, quiet: 2 });
  });

  it("shows an arrival and a departure as events in their own right", () => {
    recordPull([row("A001")], 1_000);
    recordPull([row("A001"), row("A002")], 2_000);
    const history = recordPull([row("A001")], 3_000);

    expect(historyFor(history, "A002").map((entry) => entry.kind)).toEqual(["departed", "arrived"]);
  });

  it("has nothing to say about a student it has never seen", () => {
    recordPull([row("A001")], 1_000);

    expect(historyFor(loadHistory(), "A999")).toEqual([]);
  });
});

describe("the fields the history knows about", () => {
  it("names every field any pull has carried", () => {
    recordPull([row("A001")], 1_000);
    recordPull([row("A001", { PSUAD_EMAIL: "a@b.c" })], 2_000);

    expect(fieldsSeen(loadHistory())).toEqual([
      "FULL_NAME",
      "MAJOR_CODE_DESC",
      "PSUAD_EMAIL",
      "SPRIDEN_ID",
      "YEARLEVEL_CODE",
    ]);
  });
});
