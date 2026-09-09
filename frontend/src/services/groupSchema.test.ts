import { describe, expect, it } from "vitest";

import { labelsFrom, readSets, totalsOf, troubleWith } from "@/services/groupSchema";
import { EMPTY_REQUEST } from "@/services/studentDatabase";
import type { CatalogueScope } from "@/services/studentDatabase";

const group = (id: string, label: string, assigned = 0, parentGroupId = "") =>
  ({ id, label, capacity: 0, note: "", program: "", parentGroupId, assigned, crns: {} });

const scope = (over: Partial<CatalogueScope>): CatalogueScope => ({
  id: "s1", code: "TD", name: "", note: "", termId: "t1", kind: "shared", parentScopeId: "",
  openToAll: false, courses: [], groups: [], ...over,
} as CatalogueScope);

describe("the shape of a semester", () => {
  it("counts what each set holds, and puts the department's sets last", () => {
    const own = scope({ id: "s1", code: "TD", courses: [{ id: "c1", code: "MATH-001", name: "", component: "", program: "", request: EMPTY_REQUEST }], groups: [group("g1", "1", 30), group("g2", "2", 28)] });
    const shared = scope({ id: "s2", code: "LANG", openToAll: true, groups: [group("g3", "A1", 24)], courses: [{ id: "c2", code: "SCEN-101", name: "", component: "", program: "", request: EMPTY_REQUEST }] });

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
    const adrift = scope({ kind: "nested", parentScopeId: "p", groups: [group("g", "1A", 0, "gone")], courses: [{ id: "c", code: "X", name: "", component: "", program: "", request: EMPTY_REQUEST }] });
    expect(troubleWith(adrift, byId)).toEqual(["groups adrift"]);

    // Idle rather than broken: nothing to teach, or nobody to teach it to.
    expect(troubleWith(scope({ groups: [group("g", "1")] }), byId)).toEqual(["no course"]);
    expect(troubleWith(scope({ courses: [{ id: "c", code: "X", name: "", component: "", program: "", request: EMPTY_REQUEST }] }), byId)).toEqual(["no group"]);
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
