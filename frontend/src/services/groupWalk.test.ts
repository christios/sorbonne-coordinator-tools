import { describe, expect, it } from "vitest";

import { clashKey } from "@/services/groupFill";
import { walkPlacements, walkSets } from "@/services/groupWalk";
import { EMPTY_SECTION, type CatalogueGroup, type CatalogueScope } from "@/services/studentDatabase";

const group = (id: string, label: string, extra: Partial<CatalogueGroup> = {}): CatalogueGroup => ({
  id,
  label,
  capacity: 0,
  note: "",
  program: "",
  parentGroupId: "",
  assigned: 0,
  crns: {},
  ...extra,
});

const set = (id: string, code: string, groups: CatalogueGroup[], extra: Partial<CatalogueScope> = {}): CatalogueScope => ({
  id,
  code,
  name: code,
  note: "",
  kind: "shared",
  parentScopeId: "",
  openToAll: false,
  courses: [],
  groups,
  ...extra,
});

const student = (studentId: string, held: Record<string, string> = {}) => ({
  studentId,
  first: "",
  last: "",
  program: "",
  held,
});

const walk = (scopes: CatalogueScope[], candidates: ReturnType<typeof student>[], clashes = new Set<string>()) =>
  walkSets({ scopes, candidates, clashes, order: "id", policy: "balanced", seed: 1 });

describe("walking a student through every set of a semester", () => {
  it("proposes one group per set, and says which set each belongs to", () => {
    const result = walk([set("cm", "CM", [group("cm-a", "A")]), set("td", "TD", [group("td-1", "1")])], [student("A1")]);

    expect(result.steps.map((step) => [step.scopeCode, step.plan.placements[0]?.groupId])).toEqual([
      ["CM", "cm-a"],
      ["TD", "td-1"],
    ]);
  });

  it("plans a parent set before the set nested inside it", () => {
    /*
     * `planFill` keeps a student inside the group their nested set sits in by reading what
     * they already hold. Plan the nested one first and every candidate reports "not yet in
     * a group of the set this one nests in" — about a student the walk is about to place
     * in one.
     */
    const parent = set("td", "TD", [group("td-1", "1")]);
    const nested = set("tp", "TP", [group("tp-a", "A", { parentGroupId: "td-1" })], {
      kind: "nested",
      parentScopeId: "td",
    });

    // Handed to the walk in the wrong order on purpose.
    const result = walk([nested, parent], [student("A1")]);

    expect(result.steps.map((step) => step.scopeCode)).toEqual(["TD", "TP"]);
    expect(result.steps[1].plan.placements).toEqual([{ studentId: "A1", groupId: "tp-a", why: "least full" }]);
  });

  it("folds each set's choice into what the student holds, so the next cannot be at the same hour", () => {
    // The load-bearing case. Without the fold the walk seats A1 in TD 1 and then in RDNS 8,
    // which meet at the same hour — the clash rule defeated by the loop wrapped around it.
    const clashes = new Set([clashKey("td-1", "rdns-8")]);
    const result = walk(
      [
        set("td", "TD", [group("td-1", "1")]),
        set("rdns", "RDNS", [group("rdns-8", "8"), group("rdns-9", "9")]),
      ],
      [student("A1")],
      clashes,
    );

    expect(result.steps[0].plan.placements[0].groupId).toBe("td-1");
    expect(result.steps[1].plan.placements[0].groupId).toBe("rdns-9");
  });

  it("is constrained by groups the student holds in sets the walk is not planning", () => {
    // A set left out of the walk still says when the student is busy.
    const clashes = new Set([clashKey("elsewhere-3", "td-1")]);
    const result = walk([set("td", "TD", [group("td-1", "1"), group("td-2", "2")])], [student("A1", { other: "elsewhere-3" })], clashes);

    expect(result.steps[0].plan.placements[0].groupId).toBe("td-2");
  });

  it("drops a group whose own sections meet at the same hour", () => {
    // Such a group cannot hold anyone at all, so it is not offered and then refused.
    const clashes = new Set([clashKey("td-1", "td-1")]);
    const result = walk([set("td", "TD", [group("td-1", "1"), group("td-2", "2")])], [student("A1")], clashes);

    expect(result.steps[0].plan.sizes.map((size) => size.groupId)).toEqual(["td-2"]);
  });

  it("places the sets it can and names the one where every group is full", () => {
    const result = walk(
      [
        set("cm", "CM", [group("cm-a", "A")]),
        set("td", "TD", [group("td-1", "1", { capacity: 1, assigned: 1 })]),
      ],
      [student("A1")],
    );

    expect(result.steps[0].plan.placements).toHaveLength(1);
    expect(result.steps[1].plan.unplaced).toEqual([{ studentId: "A1", why: "every group is full" }]);
  });

  it("leaves a set open to every cohort for a person, and says why", () => {
    /*
     * The languages. A group there is decided by a placement test the platform holds no
     * result for, so one picked on capacity and major would be confidently wrong. Naming
     * the set is the useful half — it is a step somebody still has to take.
     */
    const result = walk([set("lang", "LANG", [group("a0-f1", "A0-F1")], { openToAll: true })], [student("A1")]);

    expect(result.steps).toEqual([]);
    expect(result.skipped).toEqual([
      { scopeId: "lang", scopeCode: "LANG", why: "chosen by level, so a person places these by hand" },
    ]);
  });

  it("says nothing about a set the student is already in", () => {
    const result = walk([set("td", "TD", [group("td-1", "1")])], [student("A1", { td: "td-1" })]);

    expect(result.steps).toEqual([]);
    expect(result.skipped[0].why).toBe("already in a group of this set");
  });

  it("skips a set whose every group has stopped running", () => {
    const retired = group("td-1", "1", {
      crns: { "course-1": { ...EMPTY_SECTION, crn: "23456", retired: true } },
    });

    const result = walk([set("td", "TD", [retired])], [student("A1")]);

    expect(result.skipped[0].why).toBe("no group of this set can take anybody");
  });

  it("keeps two students out of one seat, because the sets are planned once for all of them", () => {
    const result = walk([set("td", "TD", [group("td-1", "1", { capacity: 1 }), group("td-2", "2", { capacity: 1 })])], [
      student("A1"),
      student("A2"),
    ]);

    expect(result.steps[0].plan.placements.map((placement) => placement.groupId).sort()).toEqual(["td-1", "td-2"]);
  });
});

describe("what the walk would write", () => {
  it("is one request per set, grouped the way the server takes them", () => {
    const result = walk(
      [set("cm", "CM", [group("cm-a", "A")]), set("td", "TD", [group("td-1", "1"), group("td-2", "2")])],
      [student("A1"), student("A2")],
    );

    expect(walkPlacements(result)).toEqual([
      { scopeId: "cm", byGroup: { "cm-a": ["A1", "A2"] } },
      { scopeId: "td", byGroup: { "td-1": ["A1"], "td-2": ["A2"] } },
    ]);
  });

  it("asks for nothing for a set nobody could be placed in", () => {
    const result = walk([set("td", "TD", [group("td-1", "1", { capacity: 1, assigned: 1 })])], [student("A1")]);

    expect(walkPlacements(result)).toEqual([]);
  });
});
