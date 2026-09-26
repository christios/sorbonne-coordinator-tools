import { describe, expect, it } from "vitest";

import { clashKey } from "@/services/groupFill";
import { walkPlacements, walkSets } from "@/services/groupWalk";
import { EMPTY_SECTION, type CatalogueGroup, type CatalogueScope } from "@/services/studentDatabase";

const group = (id: string, label: string, extra: Partial<CatalogueGroup> = {}): CatalogueGroup => ({
  id,
  label,
  capacity: 0,
  note: "",
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
    expect(result.steps[1].plan.placements).toEqual([{ studentId: "A1", groupId: "tp-a", majorId: "", why: "least full" }]);
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

  it("places a student over capacity rather than leaving the set, and says so", () => {
    const result = walk(
      [
        set("cm", "CM", [group("cm-a", "A")]),
        set("td", "TD", [group("td-1", "1", { capacity: 1, assigned: 1 })]),
      ],
      [student("A1")],
    );

    expect(result.steps[0].plan.placements).toHaveLength(1);
    expect(result.steps[1].plan.placements.map((placement) => [placement.groupId, placement.over])).toEqual([["td-1", true]]);
  });

  it("leaves the languages for a person", () => {
    /*
     * They go by a placement test's level, which the platform does not hold. Planned on
     * capacity and clash, every student was proposed the emptiest group — the highest
     * level — which was wrong for nearly all of them.
     */
    const result = walk([set("lang", "LANG", [group("a0-f1", "A0-F1")], { openToAll: true })], [student("A1")]);

    expect(result.steps).toEqual([]);
    expect(result.skipped).toEqual([{ scopeId: "lang", scopeCode: "LANG", why: "chosen by level — choose it yourself" }]);
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
      { scopeId: "cm", byGroup: { "cm-a": ["A1", "A2"] }, majors: {} },
      { scopeId: "td", byGroup: { "td-1": ["A1"], "td-2": ["A2"] }, majors: {} },
    ]);
  });

  it("asks for nothing for a set nobody could be placed in", () => {
    const clashes = new Set([clashKey("td-1", "cm-a")]);
    const result = walk([set("td", "TD", [group("td-1", "1")])], [student("A1", { cm: "cm-a" })], clashes);

    expect(walkPlacements(result)).toEqual([]);
  });
});

describe("a cohort where the major decides", () => {
  const maths = (id: string) => ({ id, program: "MATH - Mathematics", seats: 0, assigned: 0 });
  const physics = (id: string) => ({ id, program: "PHYS - Physics", seats: 0, assigned: 0 });
  // L1, much reduced: TD 3 first for physicists; Philosophy the mathematicians' and linked
  // to TD; Optics the physicists' and linked to TD 3 only.
  const l1 = () => [
    set("td", "TD", [
      group("td-1", "1"),
      group("td-2", "2"),
      group("td-3", "3", { firstFor: "PHYS - Physics" }),
    ]),
    set("phil", "PHIL-TD", [
      group("phil-1", "1", { parentGroupIds: ["td-1"], majors: [maths("phil-1-m")] }),
      group("phil-2", "2", { parentGroupIds: ["td-2", "td-3"], majors: [maths("phil-2-m")] }),
    ], { kind: "nested", parentScopeId: "td" }),
    set("opt", "OPT-TD", [group("opt-1", "1", { parentGroupIds: ["td-3"], majors: [physics("opt-1-p")] })], {
      kind: "nested",
      parentScopeId: "td",
    }),
  ];
  const as = (studentId: string, program: string, held: Record<string, string> = {}) => ({ ...student(studentId, held), program });
  const placed = (result: ReturnType<typeof walk>, studentId: string) =>
    Object.fromEntries(
      result.steps.flatMap((step) =>
        step.plan.placements.filter((placement) => placement.studentId === studentId).map((placement) => [step.scopeCode, placement.groupId]),
      ),
    );

  it("puts a physicist in TD 3 with Optics, and never in Philosophy", () => {
    const result = walk(l1(), [as("P1", "PHYS - Physics")]);

    expect(placed(result, "P1")).toEqual({ TD: "td-3", "OPT-TD": "opt-1" });
    expect(result.skipped).toContainEqual({ scopeId: "phil", scopeCode: "PHIL-TD", why: "not taken by their major" });
  });

  it("keeps a physicist in TD 3 when TD 3 is full, because their Optics goes with nothing else", () => {
    const full = l1();
    full[0].groups[2] = { ...full[0].groups[2], capacity: 1, assigned: 1 };

    const result = walk(full, [as("P1", "PHYS - Physics")]);

    expect(placed(result, "P1").TD).toBe("td-3");
  });

  it("puts a mathematician in TD 1 or 2 and the Philosophy group that goes with it", () => {
    const result = walk(l1(), [as("M1", "MATH - Mathematics"), as("M2", "MATH - Mathematics")]);

    expect(placed(result, "M1")).toEqual({ TD: "td-1", "PHIL-TD": "phil-1" });
    expect(placed(result, "M2")).toEqual({ TD: "td-2", "PHIL-TD": "phil-2" });
  });

  it("keeps a TD that the Philosophy group they already hold goes with", () => {
    const result = walk(l1(), [as("M1", "MATH - Mathematics", { phil: "phil-2" })]);

    expect(placed(result, "M1").TD).toBe("td-2");
  });

  it("proposes nothing for a student whose major is not known here", () => {
    const result = walk(l1(), [student("X1")]);

    expect(result.steps.flatMap((step) => step.plan.placements)).toEqual([]);
    expect(result.notProposed).toEqual([{ studentId: "X1", why: "their major is not in this browser" }]);
  });

  it("still proposes where nothing depends on the major, as in Foundation Year", () => {
    const result = walk([set("td", "TD", [group("td-1", "1")])], [student("X1")]);

    expect(result.notProposed).toEqual([]);
    expect(result.steps[0].plan.placements).toHaveLength(1);
  });
});
