import { describe, expect, it } from "vitest";

import { countsLine, summariseCatalogue } from "@/services/catalogueSummary";
import type { CatalogueScope } from "@/services/studentDatabase";

function scope(
  code: string,
  courses: string[],
  groups: { label: string; crns?: Record<string, string> }[],
): CatalogueScope {
  return {
    id: `s-${code}`,
    code,
    name: "",
    note: "",
    courses: courses.map((id) => ({ id, code: id, name: id, component: "" })),
    groups: groups.map((group, index) => ({
      id: `g-${code}-${index}`,
      label: group.label,
      capacity: 0,
      note: "",
      assigned: 0,
      crns: Object.fromEntries(
        Object.entries(group.crns ?? {}).map(([course, crn]) => [course, { crn, teacher: "" }]),
      ),
    })),
  };
}

describe("summarising the catalogue", () => {
  it("counts a cell for every group and course, filled or not", () => {
    const counts = summariseCatalogue([
      scope("TD", ["MATH001", "PHYS001"], [
        { label: "1", crns: { MATH001: "12345", PHYS001: "12346" } },
        { label: "2", crns: { MATH001: "12347" } },
      ]),
    ]);

    expect(counts).toEqual({ blocks: 1, groups: 2, courses: 2, filled: 3, cells: 4 });
  });

  it("does not count whitespace as a CRN", () => {
    const counts = summariseCatalogue([scope("TD", ["MATH001"], [{ label: "1", crns: { MATH001: "   " } }])]);

    expect(counts.filled).toBe(0);
  });

  it("adds up across blocks, because the semester is what gets published", () => {
    const counts = summariseCatalogue([
      scope("TD", ["MATH001"], [{ label: "1", crns: { MATH001: "1" } }]),
      scope("CM", ["PHYS001"], [{ label: "A", crns: { PHYS001: "2" } }]),
    ]);

    expect(counts).toEqual({ blocks: 2, groups: 2, courses: 2, filled: 2, cells: 2 });
  });

  it("says how many CRNs are still missing", () => {
    expect(countsLine({ blocks: 3, groups: 12, courses: 9, filled: 34, cells: 36 })).toBe(
      "3 blocks · 12 groups · 9 courses · 34 of 36 CRNs filled",
    );
  });

  it("stops counting once nothing is missing", () => {
    expect(countsLine({ blocks: 1, groups: 2, courses: 2, filled: 4, cells: 4 })).toBe(
      "1 block · 2 groups · 2 courses · every CRN filled",
    );
  });

  it("leaves the CRNs out of a block with no groups yet, rather than saying 0 of 0", () => {
    expect(countsLine({ blocks: 1, groups: 0, courses: 0, filled: 0, cells: 0 })).toBe(
      "1 block · 0 groups · 0 courses",
    );
  });
});
