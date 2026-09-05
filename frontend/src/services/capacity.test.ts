import { describe, expect, it } from "vitest";

import { capacityRows, groupTotals, statusOf } from "@/services/capacity";
import { EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

const section = (crn: string, over: Partial<typeof EMPTY_SECTION> = {}) => ({ ...EMPTY_SECTION, crn, ...over });

const group = (id: string, label: string, capacity: number, assigned: number, crns: Record<string, unknown>) => ({
  id,
  label,
  capacity,
  note: "",
  program: "",
  parentGroupId: "",
  assigned,
  crns,
}) as never;

const FYS: CohortCatalogue = {
  cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
  scopes: [
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
      openToAll: false,
      courses: [
        { id: "td-math", code: "MATH-001", name: "Pre-calculus 1", component: "TD" },
        { id: "td-algo", code: "MATH-011", name: "Algorithms", component: "TD" },
      ],
      groups: [
        group("td-1", "1", 33, 34, { "td-math": section("23223", { teacherId: "t1" }), "td-algo": section("23652") }),
        group("td-2", "2", 33, 33, { "td-math": section("23224") }),
        // A retired section: nobody is in it and nobody will be.
        group("td-7", "7", 30, 0, { "td-math": section("23899", { retired: true }) }),
      ],
    },
    {
      id: "s-lang", code: "LANG", name: "Languages", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
      openToAll: true,
      courses: [{ id: "lang", code: "SCEN-101", name: "Languages", component: "TD" }],
      groups: [group("a1", "A1-G1", 24, 22, { lang: section("23304") })],
    },
  ],
};

const termName = (id: string) => (id === "term-1" ? "Semester 1" : id);
const ACTIVE = [
  { id: "a1", courseCode: "MATH-001", title: "Pre-calculus 1", ue: "UL1MA001", parentCrn: "24226", addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
];

describe("how full every group is", () => {
  it("gives one row per section, with the group's seats and the group's enrolment", () => {
    const rows = capacityRows([FYS], termName, ACTIVE, (id) => (id === "t1" ? "Samar Ghantous" : ""));

    // Three live sections of TD and one of LANG; the retired one is not listed. Ordered
    // by course and then by group, the way the workbook's sheet reads.
    expect(rows.map((row) => `${row.set} ${row.group} ${row.courseCode}`)).toEqual([
      "LANG A1-G1 SCEN-101",
      "TD 1 MATH-001",
      "TD 2 MATH-001",
      "TD 1 MATH-011",
    ]);
    const maths = rows.find((row) => row.crn === "23223")!;
    expect(maths).toMatchObject({ capacity: 33, enrolled: 34, free: -1, status: "Over", ue: "UL1MA001", teacher: "Samar Ghantous" });
    // The sections of one group read the same count, because enrolment is the group's.
    expect(rows.filter((row) => row.group === "1").map((row) => row.enrolled)).toEqual([34, 34]);
  });

  it("says which sets the whole department shares", () => {
    const rows = capacityRows([FYS], termName);

    expect(rows.find((row) => row.set === "LANG")!.shared).toBe(true);
    expect(rows.find((row) => row.set === "TD")!.shared).toBe(false);
  });

  it("falls back to the section's anticipated students when a group has no capacity", () => {
    const loose: CohortCatalogue = {
      ...FYS,
      scopes: [{ ...FYS.scopes[0], groups: [group("td-1", "1", 0, 5, { "td-math": section("23223", { anticipated: 40 }) })] }],
    };

    const [row] = capacityRows([loose], termName);

    expect([row.capacity, row.free, row.status]).toEqual([40, 35, "Room"]);
  });

  it("counts seats only where a group states a capacity, and says how many state none", () => {
    const loose: CohortCatalogue = {
      ...FYS,
      scopes: [
        {
          ...FYS.scopes[0],
          groups: [
            group("td-1", "1", 30, 12, { "td-math": section("23223") }),
            group("td-2", "2", 0, 20, { "td-math": section("23224") }),
          ],
        },
      ],
    };

    // Adding a zero to the seats would say 30 seats hold 32 students, which is not so.
    expect(groupTotals(capacityRows([loose], termName))).toMatchObject({
      groups: 2,
      capacity: 30,
      seated: 1,
      enrolled: 32,
      withoutCapacity: 1,
    });
  });

  it("reads the numbers the way a coordinator would say them", () => {
    expect(statusOf(30, 31)).toBe("Over");
    expect(statusOf(30, 30)).toBe("Full");
    expect(statusOf(30, 12)).toBe("Room");
    expect(statusOf(30, 0)).toBe("Empty");
    expect(statusOf(0, 12)).toBe("No capacity set");
  });

  it("counts a group once for the totals, however many courses its set carries", () => {
    const totals = groupTotals(capacityRows([FYS], termName));

    // TD 1, TD 2 and LANG A1-G1 — not the four section rows.
    expect(totals).toEqual({
      groups: 3,
      capacity: 33 + 33 + 24,
      seated: 3,
      enrolled: 34 + 33 + 22,
      over: 1,
      withoutCapacity: 0,
    });
  });
});
