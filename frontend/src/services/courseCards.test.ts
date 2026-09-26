import { describe, expect, it } from "vitest";

import { teaches, buildCards, cardColumns, sectionsOf, teachersOf } from "@/services/courseCards";
import { type CatalogueScope, type CohortCatalogue, EMPTY_REQUEST, EMPTY_SECTION } from "@/services/studentDatabase";

const section = (crn: string, teacherId = "") => ({ ...EMPTY_SECTION, crn, teacherId });

const FYS: CohortCatalogue = {
  cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
  scopes: [
    {
      id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "cm-math", code: "MATH001", name: "Pre-calculus 1", component: "CM", request: EMPTY_REQUEST }],
      groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 98, crns: { "cm-math": section("22151", "t-maaz") } }],
    },
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [
        { id: "td-math", code: "MATH001", name: "", component: "TD", request: EMPTY_REQUEST },
        { id: "td-algo", code: "MATH011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST },
      ],
      groups: [
        { id: "td-1", label: "1", capacity: 33, note: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23223", "t-ghantous"), "td-algo": section("23652") } },
        { id: "td-2", label: "2", capacity: 33, note: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23224") } },
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

describe("a group with sub-rows, one per major it holds", () => {
  /*
   * L1's lecture set is one group for everybody, and under it the mathematicians and the
   * physicists are taught different things: the shared lecture under both, philosophy on
   * the mathematics sub-row, the physics option on the other — and each is not taught the
   * other's. The card reads the group through its sub-rows, one row each.
   */
  const scope: CatalogueScope = {
    id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
    courses: [
      { id: "c-shared", code: "CPSC-100", name: "Computer Science", component: "CM", request: EMPTY_REQUEST },
      { id: "c-phil", code: "MATH-113", name: "Philosophy", component: "CM", request: EMPTY_REQUEST },
    ],
    groups: [
      {
        id: "g1", label: "1", capacity: 110, note: "", parentGroupId: "", assigned: 100,
        majors: [
          { id: "m-maths", program: "MATH - Mathematics", seats: 90, assigned: 85 },
          { id: "m-phys", program: "PHYS - Physics", seats: 20, assigned: 15 },
        ],
        crns: { "c-shared": { ...EMPTY_SECTION, crn: "22155" } },
        byMajor: {
          "m-maths": { "c-phil": { ...EMPTY_SECTION, crn: "23307", majorId: "m-maths" } },
          "m-phys": { "c-phil": { ...EMPTY_SECTION, majorId: "m-phys", notTaught: true } },
        },
      },
    ],
  };
  const cards = buildCards([{ cohort: { id: "c1", name: "L1-S1", term: "2026-27" }, scopes: [scope] }], () => "Semester 1");
  // One card per course; each carries the set's rows for that course.
  const rowsOf = (code: string) => cards.find((card) => card.code === code)?.sets[0]?.rows ?? [];

  it("shows a lecture every major of the group shares as one row, the group's own", () => {
    // CPSC-100's lecture is the mathematicians' and the physicists' together: one class,
    // one CRN, one row — not the same CRN once per major.
    const rows = rowsOf("CPSC-100");
    expect(rows.map((row) => [row.group.label, row.section?.crn, row.major, row.sharedCell, row.firstSubRow])).toEqual([
      ["1", "22155", null, false, true],
    ]);
    // The id stays the group's: a placement is into the group.
    expect(rows[0].group.id).toBe("g1");
  });

  it("reads a course the majors are taught differently as one row per sub-row, with the sub-row's seats", () => {
    expect(rowsOf("MATH-113").map((row) => [row.group.label, row.group.capacity, row.group.assigned])).toEqual([
      ["1 · Mathematics", 90, 85],
      ["1 · Physics", 20, 15],
    ]);
    expect(rowsOf("MATH-113").every((row) => row.group.id === "g1")).toBe(true);
  });

  it("gives a sub-row its own cell over the shared one, and says when it is not taught a course", () => {
    const [maths, physics] = rowsOf("MATH-113");
    expect(maths.section?.crn).toBe("23307");
    expect(maths.sharedCell).toBe(false);
    expect(teaches(maths)).toBe(true);
    expect(physics.section).toBeNull();
    expect(physics.notTaught).toBe(true);
    expect(teaches(physics)).toBe(false);
  });

  it("leaves a group with no sub-rows exactly as it was", () => {
    const plain = buildCards(
      [{ cohort: { id: "c1", name: "FYS", term: "2026-27" }, scopes: [{ ...scope, groups: [{ ...scope.groups[0], majors: [], byMajor: {} }] }] }],
      () => "Semester 1",
    );
    const [row] = plain[0].sets[0].rows;
    expect([row.group.label, row.major, row.sharedCell, teaches(row)]).toEqual(["1", null, false, true]);
  });
});
