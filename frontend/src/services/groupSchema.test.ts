import { describe, expect, it } from "vitest";

import {
  labelsFrom,
  readSets,
  subRowsNobodyIsOn,
  totalsOf,
  troubleWith,
  unknownMajors,
} from "@/services/groupSchema";
import { EMPTY_REQUEST } from "@/services/studentDatabase";
import type { CatalogueScope } from "@/services/studentDatabase";

const group = (id: string, label: string, assigned = 0, parentGroupId = "") =>
  ({ id, label, capacity: 0, note: "", program: "", parentGroupId, assigned, crns: {} });

/** A group holding sub-rows, which is what makes it open to some programmes and shut to the rest. */
const split = (id: string, label: string, programs: string[]) => ({
  ...group(id, label),
  majors: programs.map((program, at) => ({ id: `${id}-m${at}`, program, seats: 0, assigned: 0 })),
});

const HELD = ["MATH - Mathematics", "PHYS - Physics"];

const scope = (over: Partial<CatalogueScope>): CatalogueScope => ({
  id: "s1", code: "TD", name: "", note: "", termId: "t1", kind: "shared", parentScopeId: "",
  openToAll: false, courses: [], groups: [], ...over,
} as CatalogueScope);

describe("the shape of a semester", () => {
  it("counts what each set holds, and puts the department's sets last", () => {
    const own = scope({ id: "s1", code: "TD", courses: [{ id: "c1", code: "MATH-001", name: "", component: "", request: EMPTY_REQUEST }], groups: [group("g1", "1", 30), group("g2", "2", 28)] });
    const shared = scope({ id: "s2", code: "LANG", openToAll: true, groups: [group("g3", "A1", 24)], courses: [{ id: "c2", code: "SCEN-101", name: "", component: "", request: EMPTY_REQUEST }] });

    const readings = readSets([shared, own], "c-fys");

    expect(readings.map((reading) => reading.scope.code)).toEqual(["TD", "LANG"]);
    expect(readings[0]).toMatchObject({ groups: 2, courses: 1, placed: 58, shared: false });
    expect(totalsOf(readings)).toEqual({ sets: 2, groups: 3, courses: 2, placed: 82 });
  });

  it("says a set is the department's row, not this cohort's", () => {
    const lang = scope({ id: "s2", code: "LANG", openToAll: true, cohortId: "c-fys" });

    expect(readSets([lang], "c-fys")[0].ownedElsewhere).toBe(false);
    expect(readSets([lang], "c-l2")[0].ownedElsewhere).toBe(true);
  });

  it("names the two faults that actually break a fill, and the two that are merely idle", () => {
    const parent = scope({ id: "p", code: "TD", groups: [group("gp", "1")] });
    const byId = new Map([[parent.id, parent]]);

    // A nested set with no parent set at all, and one whose group sits in no parent group.
    expect(troubleWith(scope({ kind: "nested", parentScopeId: "" }), byId)).toContain("no parent set");
    const adrift = scope({ kind: "nested", parentScopeId: "p", groups: [group("g", "1A", 0, "gone")], courses: [{ id: "c", code: "X", name: "", component: "", request: EMPTY_REQUEST }] });
    expect(troubleWith(adrift, byId)).toEqual(["groups adrift"]);

    // Idle rather than broken: nothing to teach, or nobody to teach it to.
    expect(troubleWith(scope({ groups: [group("g", "1")] }), byId)).toEqual(["no course"]);
    expect(troubleWith(scope({ courses: [{ id: "c", code: "X", name: "", component: "", request: EMPTY_REQUEST }] }), byId)).toEqual(["no group"]);
    expect(troubleWith(parent, byId)).toEqual(["no course"]);
  });

  it("reads a range of labels as the groups it stands for", () => {
    expect(labelsFrom("TD 1-6")).toEqual(["TD 1", "TD 2", "TD 3", "TD 4", "TD 5", "TD 6"]);
    expect(labelsFrom("1–3")).toEqual(["1", "2", "3"]);
    expect(labelsFrom("G.2 to 4")).toEqual(["G.2", "G.3", "G.4"]);
    // Not a range: one group, named exactly that.
    expect(labelsFrom("A1-G1")).toEqual(["A1-G1"]);
    expect(labelsFrom("  ")).toEqual([]);
    // A range nobody meant is taken literally rather than making sixty groups.
    expect(labelsFrom("1-999")).toEqual(["1-999"]);
  });
});

describe("a sub-row nobody is on", () => {
  const byId = new Map<string, CatalogueScope>();

  it("says nothing while the registrar's wording is the one the students carry", () => {
    const set = scope({ groups: [split("g1", "1", ["MATH - Mathematics"]), split("g2", "2", ["PHYS - Physics"])] });

    expect(subRowsNobodyIsOn(set, HELD)).toEqual([]);
    expect(troubleWith(set, byId, HELD)).not.toContain("sub-row nobody is on");
  });

  it("still says nothing when the registrar has reworded the description", () => {
    // The whole reason the code decides: the words after it are not ours.
    const set = scope({ groups: [split("g1", "1", ["MATH - Mathematics and Statistics"])] });

    expect(subRowsNobodyIsOn(set, HELD)).toEqual([]);
  });

  it("names the group and the programme when the code itself matches nobody", () => {
    const set = scope({ groups: [split("g1", "1", ["ECMG - Economics and Management"])] });

    expect(subRowsNobodyIsOn(set, HELD)).toEqual([{ group: "1", program: "ECMG - Economics and Management" }]);
    expect(troubleWith(set, byId, HELD)).toContain("sub-row nobody is on");
  });

  it("judges nothing at all when this browser has pulled nobody", () => {
    // An unsynced browser knows of no programme, and would otherwise call every sub-row in
    // the department wrong.
    const set = scope({ groups: [split("g1", "1", ["ECMG - Economics and Management"])] });

    expect(subRowsNobodyIsOn(set, [])).toEqual([]);
    expect(troubleWith(set, byId, [])).not.toContain("sub-row nobody is on");
  });

  it("leaves a group with no sub-rows alone, since it is open to everybody", () => {
    expect(subRowsNobodyIsOn(scope({ groups: [group("g1", "1")] }), HELD)).toEqual([]);
  });

  it("carries the trouble through to the reading the page draws", () => {
    const set = scope({ groups: [split("g1", "1", ["ECMG - Economics and Management"])] });

    expect(readSets([set], "c-l1", HELD)[0].trouble).toContain("sub-row nobody is on");
    expect(readSets([set], "c-l1")[0].trouble).not.toContain("sub-row nobody is on");
  });
});

describe("a cohort expecting a major nobody is on", () => {
  it("accepts the code on its own, which is how a cohort writes it", () => {
    expect(unknownMajors(["MATH", "PHYS"], HELD)).toEqual([]);
  });

  it("accepts the registrar's full spelling, which is how some cohorts have it", () => {
    expect(unknownMajors(["MATH - Mathematics"], HELD)).toEqual([]);
  });

  it("names the code no student reads", () => {
    expect(unknownMajors(["MATH", "ECMG"], HELD)).toEqual(["ECMG"]);
  });

  it("judges nothing when this browser has pulled nobody", () => {
    expect(unknownMajors(["ECMG"], [])).toEqual([]);
  });
});
