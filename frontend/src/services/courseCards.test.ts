import { describe, expect, it } from "vitest";

import { teaches, buildCards, cardColumns, sectionsOf, teachersOf } from "@/services/courseCards";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

const section = (crn: string, teacherId = "") => ({ ...EMPTY_SECTION, crn, teacherId });

const FYS: CohortCatalogue = {
  cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
  scopes: [
    {
      id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "cm-math", code: "MATH001", name: "Pre-calculus 1", component: "CM", program: "", request: EMPTY_REQUEST }],
      groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 98, crns: { "cm-math": section("22151", "t-maaz") } }],
    },
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [
        { id: "td-math", code: "MATH001", name: "", component: "TD", program: "", request: EMPTY_REQUEST },
        { id: "td-algo", code: "MATH011", name: "Algorithms", component: "TD", program: "", request: EMPTY_REQUEST },
      ],
      groups: [
        { id: "td-1", label: "1", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23223", "t-ghantous"), "td-algo": section("23652") } },
        { id: "td-2", label: "2", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23224") } },
      ],
    },
  ],
};

const termName = (id: string) => ({ "term-1": "Semester 1" })[id] ?? id;
const ACTIVE = [
  { id: "a1", courseCode: "MATH001", title: "Pre-calculus 1", ue: "UL1MA001", mutualized: "" as const, addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
];
const nameOf = (id: string) => ({ "t-maaz": "Bilal Maaz", "t-ghantous": "Samar Ghantous" })[id] ?? "";

describe("cards from the catalogue", () => {
  it("makes one card per course per semester, whichever sets carry it", () => {
    const cards = buildCards([FYS], termName, ACTIVE, new Map([["23223", "24226"]]));

    expect(cards.map((card) => card.code)).toEqual(["MATH001", "MATH011"]);
    const maths = cards[0];
    expect(maths.name).toBe("Pre-calculus 1");
    // The UE is the active course's; a course not on that list has none.
    expect([maths.ue, maths.active?.id]).toEqual(["UL1MA001", "a1"]);
    expect([cards[1].ue, cards[1].active]).toEqual(["", null]);
    // The parent CRN is the register's answer for that very CRN, section by section.
    const rows = maths.sets.flatMap((set) => set.rows);
    expect(rows.filter((row) => row.parentCrn).map((row) => [row.section?.crn, row.parentCrn])).toEqual([["23223", "24226"]]);
    expect(maths.termName).toBe("Semester 1");
    expect(maths.sets.map((set) => set.scope.code)).toEqual(["CM", "TD"]);
  });

  it("gives every group of a set a row, empty where the group holds nothing for the course", () => {
    const [, algorithms] = buildCards([FYS], termName);

    const rows = sectionsOf(algorithms);
    expect(rows.map((row) => `${row.group.label}:${row.section?.crn ?? "-"}`)).toEqual(["1:23652", "2:-"]);
  });

  it("names the teachers, and lets the filter ask by set, type, teacher and CRN", () => {
    const [maths] = buildCards([FYS], termName);
    const columns = Object.fromEntries(cardColumns(nameOf).map((column) => [column.id, column]));

    expect(teachersOf(maths, nameOf)).toEqual(["Bilal Maaz", "Samar Ghantous"]);
    expect(columns.sets.accessor(maths)).toEqual(["CM", "TD"]);
    expect(columns.types.accessor(maths)).toEqual(["CM", "TD"]);
    expect(columns.crns.accessor(maths)).toEqual(["22151", "23223", "23224"]);
    expect(columns.missing.accessor(maths)).toBe("All set");
  });
});

describe("a set split by programme rather than by group number", () => {
  /*
   * L3's CM set carries the Maths courses and the Physics courses and holds a group called
   * "Mathematics" and one called "Physics". The matrix's assumption — every group teaches
   * every course of its set — is right for Foundation Year's numbered groups and wrong
   * here, and it produced 45 sections "without a CRN" across L2 and L3, none of them real.
   */
  const maths = { program: "Mathematics" };
  const physics = { program: "Physics" };

  it("says a course is taught to the group of its own programme", () => {
    expect(teaches(maths, { program: "Mathematics" })).toBe(true);
    expect(teaches(physics, { program: "Physics" })).toBe(true);
  });

  it("says it is not taught to the other one, which is the whole point", () => {
    expect(teaches(physics, { program: "Mathematics" })).toBe(false);
    expect(teaches(maths, { program: "Physics" })).toBe(false);
  });

  it("treats a blank on either side as everyone, so a set that says nothing is unchanged", () => {
    // Every set in the department says nothing today, and none of them may change
    // behaviour because this exists.
    expect(teaches({ program: "" }, { program: "Mathematics" })).toBe(true);
    expect(teaches(maths, { program: "" })).toBe(true);
    expect(teaches({}, {})).toBe(true);
  });

  it("compares past the case and the spaces the two were typed with", () => {
    // The two are typed on different pages, months apart, by the same person.
    expect(teaches({ program: " mathematics " }, { program: "Mathematics" })).toBe(true);
  });
});
