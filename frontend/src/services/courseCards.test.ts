import { describe, expect, it } from "vitest";

import { buildCards, cardColumns, sectionsOf, teachersOf } from "@/services/courseCards";
import { EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

const section = (crn: string, teacherId = "") => ({ ...EMPTY_SECTION, crn, teacherId });

const FYS: CohortCatalogue = {
  cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
  scopes: [
    {
      id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
      courses: [{ id: "cm-math", code: "MATH001", name: "Pre-calculus 1", component: "CM", ue: "", parentCrn: "24226" }],
      groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 98, crns: { "cm-math": section("22151", "t-maaz") } }],
    },
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
      courses: [
        { id: "td-math", code: "MATH001", name: "", component: "TD", ue: "", parentCrn: "" },
        { id: "td-algo", code: "MATH011", name: "Algorithms", component: "TD", ue: "", parentCrn: "" },
      ],
      groups: [
        { id: "td-1", label: "1", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23223", "t-ghantous"), "td-algo": section("23652") } },
        { id: "td-2", label: "2", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 33, crns: { "td-math": section("23224") } },
      ],
    },
  ],
};

const termName = (id: string) => ({ "term-1": "Semester 1" })[id] ?? id;
const nameOf = (id: string) => ({ "t-maaz": "Bilal Maaz", "t-ghantous": "Samar Ghantous" })[id] ?? "";

describe("cards from the catalogue", () => {
  it("makes one card per course per semester, whichever sets carry it", () => {
    const cards = buildCards([FYS], termName);

    expect(cards.map((card) => card.code)).toEqual(["MATH001", "MATH011"]);
    const maths = cards[0];
    expect(maths.name).toBe("Pre-calculus 1");
    expect(maths.parentCrn).toBe("24226");
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
