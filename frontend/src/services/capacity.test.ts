import { describe, expect, it } from "vitest";

import { capacityByGroup, capacityBySet, capacityRows, groupTotals, roomReading, statusOf, type RoomUse } from "@/services/capacity";
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

  it("reads seats only, never a number typed on the section beside them", () => {
    const loose: CohortCatalogue = {
      ...FYS,
      scopes: [{ ...FYS.scopes[0], groups: [group("td-1", "1", 0, 5, { "td-math": section("23223", { anticipated: 40 }) })] }],
    };

    const [row] = capacityRows([loose], termName);

    expect([row.capacity, row.free, row.status]).toEqual([0, 0, "No capacity set"]);
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

describe("a class four cohorts sit in", () => {
  /*
   * A shared set is carried by every cohort that teaches it: each holds its own record of
   * "A0-F5", and all of them name the same CRN, because there is one French class at that
   * hour and the whole point of a shared set is that four years sit in it together.
   *
   * Read as four groups, the languages came to 2184 seats where the university has 546.
   */
  const langOf = (cohortId: string, cohortName: string, assigned: number): CohortCatalogue => ({
    cohort: { id: cohortId, name: cohortName, term: "2026-27" },
    scopes: [
      {
        id: `s-lang-${cohortId}`, code: "LANG", name: "Languages", note: "", termId: "term-1",
        kind: "shared", parentScopeId: "", openToAll: true,
        courses: [{ id: "lang", code: "SCEN-101", name: "Languages", component: "TD", request: EMPTY_REQUEST }],
        groups: [group(`a0f5-${cohortId}`, "A0-F5", 30, assigned, { lang: section("23582") })],
      },
    ],
  });
  const fourYears = [langOf("c1", "FYS-S1", 0), langOf("c2", "L1-S1", 4), langOf("c3", "L2-S1", 0), langOf("c4", "L3-S1", 24)];

  it("is one class, not one per cohort", () => {
    const groups = capacityByGroup(capacityRows(fourYears, termName));

    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe("A0-F5");
  });

  it("adds the students up and counts the seats once", () => {
    // The enrolments are four cohorts' students in one room; the seats are the same thirty
    // chairs, and adding those four times is where 546 became 2184.
    const [held] = capacityByGroup(capacityRows(fourYears, termName));

    expect(held.enrolled).toBe(28);
    expect(held.capacity).toBe(30);
    expect(held.free).toBe(2);
    expect(held.status).toBe("Room");
  });

  it("names the class's CRN once, not once per cohort", () => {
    const [held] = capacityByGroup(capacityRows(fourYears, termName));

    expect(held.sections.map((entry) => entry.crn)).toEqual(["23582"]);
  });

  it("says which years are in it", () => {
    const [held] = capacityByGroup(capacityRows(fourYears, termName));

    expect(held.cohortNames).toEqual(["FYS-S1", "L1-S1", "L2-S1", "L3-S1"]);
  });

  it("makes the set's totals the real ones", () => {
    const [set] = capacityBySet(capacityByGroup(capacityRows(fourYears, termName)));

    expect(set.capacity).toBe(30);
    expect(set.enrolled).toBe(28);
  });

  it("goes over when the four years together go over", () => {
    const crowded = [langOf("c1", "FYS-S1", 10), langOf("c2", "L1-S1", 10), langOf("c3", "L2-S1", 10), langOf("c4", "L3-S1", 10)];

    const [held] = capacityByGroup(capacityRows(crowded, termName));

    // Thirty-one in thirty chairs, which no single cohort's copy could have shown.
    expect(held.enrolled).toBe(40);
    expect(held.status).toBe("Over");
  });

  it("leaves a cohort's own group alone, however many cohorts have one of that name", () => {
    // "TD 1" in Foundation Year and "TD 1" in L1 are two rooms, two teachers and two
    // classes. Only a set open to every cohort means one class.
    const own = (cohortId: string, cohortName: string): CohortCatalogue => ({
      cohort: { id: cohortId, name: cohortName, term: "2026-27" },
      scopes: [
        {
          id: `s-td-${cohortId}`, code: "TD", name: "Tutorials", note: "", termId: "term-1",
          kind: "shared", parentScopeId: "", openToAll: false,
          courses: [{ id: "td", code: "MATH-001", name: "Pre-calculus", component: "TD", request: EMPTY_REQUEST }],
          groups: [group(`td1-${cohortId}`, "1", 30, 20, { td: section(`crn-${cohortId}`) })],
        },
      ],
    });

    expect(capacityByGroup(capacityRows([own("c1", "FYS-S1"), own("c2", "L1-S1")], termName))).toHaveLength(2);
  });

  it("keeps two shared classes apart when they only share a name", () => {
    /*
     * The fold merges records of ONE class. Two language groups called "A0-F5" under
     * different CRNs are two classes at two hours that happen to be named the same, and
     * adding their students together would invent a class nobody teaches — a worse fault
     * than the one the fold fixes.
     */
    const named = (cohortId: string, cohortName: string, crn: string): CohortCatalogue => ({
      cohort: { id: cohortId, name: cohortName, term: "2026-27" },
      scopes: [
        {
          id: `s-lang-${cohortId}`, code: "LANG", name: "Languages", note: "", termId: "term-1",
          kind: "shared", parentScopeId: "", openToAll: true,
          courses: [{ id: "lang", code: "SCEN-101", name: "French", component: "TD", request: EMPTY_REQUEST }],
          groups: [group(`g-${cohortId}`, "A0-F5", 30, 12, { lang: section(crn) })],
        },
      ],
    });

    const groups = capacityByGroup(capacityRows([named("c1", "FYS-S1", "23582"), named("c2", "L1-S1", "24999")], termName));

    expect(groups).toHaveLength(2);
    expect(groups.map((held) => held.enrolled)).toEqual([12, 12]);
  });

  it("keeps a second real section of a shared group, which is not a copy", () => {
    // Two courses in one language set is two sections of the same class, not the same
    // section twice — and both are worth naming under it.
    const twoCourses: CohortCatalogue = {
      cohort: { id: "c1", name: "FYS-S1", term: "2026-27" },
      scopes: [
        {
          id: "s-lang", code: "LANG", name: "Languages", note: "", termId: "term-1",
          kind: "shared", parentScopeId: "", openToAll: true,
          courses: [
            { id: "lang", code: "SCEN-101", name: "French", component: "TD", request: EMPTY_REQUEST },
            { id: "lab", code: "SCEN-105", name: "Lab", component: "TP", request: EMPTY_REQUEST },
          ],
          groups: [group("a0f5", "A0-F5", 30, 12, { lang: section("23582"), lab: section("23583") })],
        },
      ],
    };

    const [held] = capacityByGroup(capacityRows([twoCourses], termName));

    expect(held.sections.map((entry) => entry.crn).sort()).toEqual(["23582", "23583"]);
    // One cohort, so its twelve students are counted once and not once per section.
    expect(held.enrolled).toBe(12);
  });
});

describe("a group whose majors share some lectures", () => {
  it("counts a lecture they all attend as one room, and a major's own lecture as its own", () => {
    // L1's CM as one group: MATH-100 for all 109, MATH-113 the 91 mathematicians' alone.
    const l1: CohortCatalogue = {
      cohort: { id: "c-l1", name: "L1-S1", term: "2026-27" },
      scopes: [
        {
          id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [
            { id: "c-m100", code: "MATH-100", name: "Mathematics 1", component: "CM", request: EMPTY_REQUEST },
            { id: "c-m113", code: "MATH-113", name: "Philosophy of AI", component: "CM", request: EMPTY_REQUEST },
          ],
          groups: [
            {
              id: "cm-1", label: "1", capacity: 120, note: "", parentGroupId: "", assigned: 109,
              crns: { "c-m100": { ...EMPTY_SECTION, crn: "22134" }, "c-m113": { ...EMPTY_SECTION, crn: "23307" } },
              majors: [
                { id: "m-math", program: "MATH - Mathematics", seats: 100, assigned: 91 },
                { id: "m-phys", program: "PHYS - Physics", seats: 20, assigned: 18 },
              ],
              byMajor: { "m-phys": { "c-m113": { ...EMPTY_SECTION, notTaught: true } } },
            },
          ],
        },
      ],
    };

    const rows = capacityRows([l1], () => "Semester 1");

    expect(rows.map((row) => [row.crn, row.group, row.capacity, row.enrolled])).toEqual([
      ["22134", "1", 120, 109],
      ["23307", "1 · Mathematics", 100, 91],
    ]);
  });
});

describe("a group whose programmes are taught different lectures", () => {
  /*
   * L1's CM: one group of 109 in 120 seats — 91 mathematicians on 100, 18 physicists on 20.
   * All of them sit the shared lecture; MATH-113 is the mathematicians' and PHYS-118 the
   * physicists'. Three bars, one group: the set said "3 groups · 218 in 240 seats".
   */
  const L1: CohortCatalogue = {
    cohort: { id: "c-l1", name: "L1-S1", term: "2026-27" },
    scopes: [
      {
        id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
        openToAll: false,
        courses: [
          { id: "c-shared", code: "MATH-100", name: "Mathematics 1", component: "CM", request: EMPTY_REQUEST },
          { id: "c-m113", code: "MATH-113", name: "Philosophy of AI", component: "CM", request: EMPTY_REQUEST },
          { id: "c-p118", code: "PHYS-118", name: "Optics", component: "CM", request: EMPTY_REQUEST },
        ],
        groups: [
          {
            ...(group("cm-1", "1", 120, 109, {
              "c-shared": section("22134"),
              "c-m113": section("23307"),
              "c-p118": section("22150"),
            }) as object),
            majors: [
              { id: "m-math", program: "MATH - Mathematics", seats: 100, assigned: 91 },
              { id: "m-phys", program: "PHYS - Physics", seats: 20, assigned: 18 },
            ],
            byMajor: {
              "m-math": { "c-p118": { ...EMPTY_SECTION, notTaught: true } },
              "m-phys": { "c-m113": { ...EMPTY_SECTION, notTaught: true } },
            },
          } as never,
        ],
      },
    ],
  };
  const rows = capacityRows([L1], () => "Semester 1");

  it("draws the group once, with every lecture under it and its parts beside them", () => {
    const [line] = capacityByGroup(rows);

    expect([line.group, line.enrolled, line.capacity]).toEqual(["1", 109, 120]);
    expect(line.sections.map((section) => [section.crn, section.part])).toEqual([
      ["22134", ""],
      ["23307", "Mathematics"],
      ["22150", "Physics"],
    ]);
    expect(line.parts.map((part) => [part.name, part.enrolled, part.capacity])).toEqual([
      ["Mathematics", 91, 100],
      ["Physics", 18, 20],
    ]);
  });

  it("counts the set as the one group it is", () => {
    const [cm] = capacityBySet(capacityByGroup(rows));

    expect(cm).toMatchObject({ enrolled: 109, capacity: 120, over: 0 });
    expect(cm.groups).toHaveLength(1);
  });

  it("counts a part over its own seats, though the group has room", () => {
    // 22 physicists on 20 seats, in a group of 113 on 120: the Physics part is what is over.
    const crowded: CohortCatalogue = JSON.parse(JSON.stringify(L1));
    const cm = crowded.scopes[0].groups[0] as unknown as { assigned: number; majors: { assigned: number }[] };
    cm.assigned = 113;
    cm.majors[1].assigned = 22;
    const [set] = capacityBySet(capacityByGroup(capacityRows([crowded], () => "Semester 1")));

    expect(set.groups[0].status).toBe("Room");
    expect(set.groups[0].parts[1]).toMatchObject({ name: "Physics", status: "Over" });
    expect(set.over).toBe(1);
  });

  it("counts it once in the totals too", () => {
    expect(groupTotals(rows)).toMatchObject({ groups: 1, capacity: 120, placements: 109, over: 0 });
  });
});

describe("reading a line against its rooms", () => {
  const rooms: Record<string, RoomUse[]> = {
    "22134": [{ name: "Roberto Sorbonne", seats: 154, sessions: 28 }],
    "22135": [{ name: "Roberto Sorbonne", seats: 154, sessions: 20 }, { name: "5.104", seats: 16, sessions: 1 }],
    "23639": [{ name: "5.104", seats: 16, sessions: 12 }],
    "24999": [{ name: "9.999", seats: null, sessions: 4 }],
  };
  const roomsOf = (crn: string) => rooms[crn];

  it("reads against the room, and says the plan beside it", () => {
    // MTP 1A: planned for 14, in a room of 16, with 15 in it — over the plan, not the room.
    const reading = roomReading(["23639"], roomsOf, 14, 15);

    expect(reading).toMatchObject({ seats: 16, against: 16, byRoom: true, free: 1, overRoom: 0, overPlan: 1, status: "Room" });
  });

  it("is over when the room will not hold them", () => {
    expect(roomReading(["23639"], roomsOf, 14, 19)).toMatchObject({ overRoom: 3, overPlan: 5, status: "Over" });
  });

  it("reads against the room most of its sessions are in, and names the others", () => {
    // L1's CM: the lectures in Roberto Sorbonne, one session moved to a room of 16.
    const reading = roomReading(["22134", "22135"], roomsOf, 120, 109);

    expect(reading.rooms).toEqual([
      { name: "Roberto Sorbonne", seats: 154, sessions: 48 },
      { name: "5.104", seats: 16, sessions: 1 },
    ]);
    // Not eighty-five over because of one session elsewhere: 109 in 154.
    expect(reading).toMatchObject({ seats: 154, overRoom: 0, free: 45, status: "Room" });
    // But that session is said: a room too small for the line.
    expect(reading.tooSmall.map((room) => room.name)).toEqual(["5.104"]);
    expect(reading.tooSmallSessions).toBe(1);
  });

  it("falls back to the plan when no room's seats are known", () => {
    const reading = roomReading(["24999", "00000"], roomsOf, 20, 18);

    expect(reading).toMatchObject({ seats: null, against: 20, byRoom: false, free: 2, overRoom: 0, status: "Room" });
    expect(reading.rooms).toEqual([{ name: "9.999", seats: null, sessions: 4 }]);
  });
});
