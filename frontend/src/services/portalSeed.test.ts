import { describe, expect, it } from "vitest";

import { portalCourses, proposeRows, seedSteps } from "@/services/portalSeed";
import type { CatalogueScope } from "@/services/studentDatabase";

const CRNS = {
  "23224": { courseCode: "MATH-001", title: "Pre-calculus 1", teacherName: "Jad Tarsissi", status: "in_portal" },
  "23223": { courseCode: "MATH-001", title: "Pre-calculus 1", teacherName: "Samar Ghantous", status: "in_portal" },
  "23899": { courseCode: "MATH-001", title: "Pre-calculus 1", teacherName: "", status: "not_in_portal" },
  "23302": { courseCode: "SCEN-101", title: "French", teacherName: "Mme B", status: "in_portal" },
};

const TD: CatalogueScope = {
  id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
  courses: [],
  groups: [{ id: "g1", label: "1", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} }],
};

describe("starting a card from the portal", () => {
  it("lists the term's courses with their CRNs in order", () => {
    const courses = portalCourses(CRNS);

    expect(courses.map((course) => course.courseCode)).toEqual(["MATH-001", "SCEN-101"]);
    expect(courses[0].sections.map((section) => section.crn)).toEqual(["23223", "23224", "23899"]);
  });

  it("proposes the set's groups in order, counting on past the last, and skips what the portal dropped", () => {
    const [maths] = portalCourses(CRNS);

    const rows = proposeRows(maths, TD);

    expect(rows.map((row) => `${row.crn}:${row.groupLabel}${row.skip ? "!" : ""}`)).toEqual(["23223:1", "23224:2", "23899:3!"]);
  });

  it("makes the course once per set, the missing groups, then every section", () => {
    const [maths] = portalCourses(CRNS);
    const rows = proposeRows(maths, TD);

    const steps = seedSteps(maths, rows, [TD]);

    expect(steps).toEqual([
      { kind: "course", scopeId: "s-td", code: "MATH-001", name: "Pre-calculus 1", component: "TD" },
      { kind: "section", scopeId: "s-td", groupLabel: "1", code: "MATH-001", crn: "23223", teacherName: "Samar Ghantous" },
      { kind: "group", scopeId: "s-td", label: "2" },
      { kind: "section", scopeId: "s-td", groupLabel: "2", code: "MATH-001", crn: "23224", teacherName: "Jad Tarsissi" },
    ]);
  });
});
