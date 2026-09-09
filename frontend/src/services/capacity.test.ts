import { describe, expect, it } from "vitest";

import { capacityByGroup, capacityBySet, capacityRows, groupTotals, statusOf } from "@/services/capacity";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

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
        { id: "td-math", code: "MATH-001", name: "Pre-calculus 1", component: "TD", request: EMPTY_REQUEST },
        { id: "td-algo", code: "MATH-011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST },
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
      courses: [{ id: "lang", code: "SCEN-101", name: "Languages", component: "TD", request: EMPTY_REQUEST }],
      groups: [group("a1", "A1-G1", 24, 22, { lang: section("23304") })],
    },
  ],
};

const termName = (id: string) => (id === "term-1" ? "Semester 1" : id);
const ACTIVE = [
  { id: "a1", courseCode: "MATH-001", title: "Pre-calculus 1", ue: "UL1MA001", mutualized: "" as const, parentCrn: "24226", addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
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
      placements: 32,
      withoutCapacity: 1,
    });
  });

  it("keeps a shared set's seats out of one cohort's totals", () => {
    // Twenty language groups would swamp a year's four, and their seats are not that
    // year's to count — the page shows them apart, and the totals are of the year's own.
    const rows = capacityRows([FYS], termName);
    const own = rows.filter((row) => !row.shared);

    expect(groupTotals(own)).toMatchObject({ groups: 2, capacity: 66, placements: 67 });
    expect(groupTotals(rows).groups).toBe(3);
  });

  it("reads the numbers the way a coordinator would say them", () => {
    expect(statusOf(30, 31)).toBe("Over");
    expect(statusOf(30, 30)).toBe("Full");
    expect(statusOf(30, 12)).toBe("Room");
    expect(statusOf(30, 0)).toBe("Empty");
    expect(statusOf(0, 12)).toBe("No capacity set");
  });

  it("reads a group once, keeping the sections it is taught in", () => {
    const groups = capacityByGroup(capacityRows([FYS], termName));

    expect(groups.map((group) => `${group.set} ${group.group}`)).toEqual(["LANG A1-G1", "TD 1", "TD 2"]);
    // TD 1 carries two courses and is still one class of thirty-four.
    const first = groups.find((group) => group.group === "1")!;
    expect([first.enrolled, first.capacity, first.status]).toEqual([34, 33, "Over"]);
    expect(first.sections.map((section) => section.courseCode)).toEqual(["MATH-001", "MATH-011"]);
  });

  it("gathers the groups by set, with the shared ones last and a scale for the bars", () => {
    const sets = capacityBySet(capacityByGroup(capacityRows([FYS], termName)));

    // A set the whole department shares comes after the cohort's own.
    expect(sets.map((set) => [set.code, set.shared])).toEqual([
      ["TD", false],
      ["LANG", true],
    ]);
    const tutorials = sets[0];
    expect([tutorials.enrolled, tutorials.capacity, tutorials.over]).toEqual([67, 66, 1]);
    // The bars of a set are drawn against its fullest group, not against the page.
    expect(tutorials.peak).toBe(34);
  });

  it("says seats taken, not students: a student in three groups is three of them", () => {
    // The mistake this guards: a cohort of two reading as sixty-seven.
    const totals = groupTotals(capacityRows([FYS], termName).filter((row) => !row.shared));

    expect(totals.placements).toBe(67);
    expect(totals.groups).toBe(2);
  });

  it("counts a group once for the totals, however many courses its set carries", () => {
    const totals = groupTotals(capacityRows([FYS], termName));

    // TD 1, TD 2 and LANG A1-G1 — not the four section rows.
    expect(totals).toEqual({
      groups: 3,
      capacity: 33 + 33 + 24,
      seated: 3,
      placements: 34 + 33 + 22,
      over: 1,
      withoutCapacity: 0,
    });
  });
});

describe("a course handed from one professor to another at mid-semester", () => {
  /** MATH-351: 23436 to late October, 24311 after it — one group, one course, two CRNs. */
  const SPLIT: CohortCatalogue = {
    cohort: { id: "c3", name: "Third year", term: "2026-27" },
    scopes: [
      {
        id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
        openToAll: false,
        courses: [{ id: "cm-alg", code: "MATH-351", name: "Algebra & Cryptography", component: "CM", request: EMPTY_REQUEST }],
        groups: [
          group("cm-a", "Mathematics", 0, 8, {
            "cm-alg": {
              ...section("23436", { teacher: "Grace Younes", anticipated: 6 }),
              parts: [
                { ...EMPTY_SECTION, part: 1, crn: "23436", teacher: "Grace Younes", anticipated: 6 },
                { ...EMPTY_SECTION, part: 2, crn: "24311", teacher: "Sudarshan Shinde", anticipated: 6 },
              ],
            },
          }),
        ],
      },
    ],
  };

  it("gives every CRN a line, because every CRN is a thing the registrar has to seat", () => {
    /*
     * A row per part, not per section. Reading the section alone gave the first half a
     * line and left the second with none, so half a term's teaching had no seats anywhere
     * on the page that exists to count them.
     */
    const rows = capacityRows([SPLIT], () => "Semester 1");

    expect(rows.map((row) => row.crn)).toEqual(["23436", "24311"]);
    expect(rows.map((row) => row.teacher)).toEqual(["Grace Younes", "Sudarshan Shinde"]);
  });

  it("counts the group once, however many stretches it is taught in", () => {
    // The same eight people sit in both halves. Counting them twice would report a class
    // of sixteen and, on a group with a capacity, invent an overflow that is not there.
    const [only] = capacityByGroup(capacityRows([SPLIT], () => "Semester 1"));

    expect(only.enrolled).toBe(8);
    expect(only.sections.map((row) => row.crn)).toEqual(["23436", "24311"]);
  });

  it("leaves a retired half out and keeps the one still running", () => {
    const half: CohortCatalogue = JSON.parse(JSON.stringify(SPLIT));
    half.scopes[0].groups[0].crns["cm-alg"].parts[0].retired = true;

    const rows = capacityRows([half], () => "Semester 1");

    expect(rows.map((row) => row.crn)).toEqual(["24311"]);
  });
});
