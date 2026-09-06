import { describe, expect, it } from "vitest";

import { buildCards } from "@/services/courseCards";
import { hoursColumn, hoursColumns, loadRows, loadTotals, sectionsTaughtBy, shownHoursColumns, teacherLoads } from "@/services/teacherLoad";
import type { ActiveTeacher } from "@/services/portalLists";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import { requestSheets, type RequestRow, type RequestSheet } from "@/services/timetableExport";

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  courseName: "Pre-calculus 1 G.1-TD", degree: "", ue: "", crn: "23223", parentCrn: "", subject: "MATH",
  courseNumber: "001", hours: "50", type: "TD", roomPref: "", teacher: "Samar Ghantous", teacherId: "act-1",
  timePref: "", dayPref: "", constraints: "", weeks: "", duration: "", anticipated: "", comments: "",
  ...over,
});

const sheet = (title: string, rows: RequestRow[]): RequestSheet => ({ title, heading: title, semester: "Semester 1", rows });

describe("what every teacher is carrying", () => {
  it("adds a teacher's hours up by sheet and by type", () => {
    const [samar] = teacherLoads([
      sheet("FYS-S1", [row(), row({ crn: "23224", hours: "20", type: "CM" })]),
      sheet("BSc-L1-S1", [row({ crn: "23634", hours: "30" })]),
    ]);

    expect(samar.teacher).toBe("Samar Ghantous");
    expect(samar.bySheet).toEqual([70, 30]);
    expect(samar.byType).toEqual({ TD: 80, CM: 20 });
    expect(samar.total).toBe(100);
    expect(samar.sections).toBe(3);
  });

  it("is one row per name printed, confirmed or not, as the workbook has it", () => {
    const loads = teacherLoads([
      sheet("FYS-S1", [
        row({ teacher: "Samar Ghantous", teacherId: "act-1" }),
        // The same person, on a section nobody has confirmed against the department's list.
        row({ crn: "2", teacher: "Samar Ghantous ", teacherId: "", hours: "20" }),
      ]),
    ]);

    // One row, or the workbook would go out with the same name twice.
    expect(loads).toHaveLength(1);
    expect(loads[0].total).toBe(70);
    // And it keeps the id, so the page can open their record.
    expect(loads[0].teacherId).toBe("act-1");
  });

  it("keeps a name nobody has confirmed apart from a name nobody has given", () => {
    const loads = teacherLoads([
      sheet("FYS-S1", [
        row({ teacher: "Grace Younes", teacherId: "" }),
        row({ crn: "2", teacher: "TBD", teacherId: "", hours: "12" }),
        row({ crn: "3", teacher: "", teacherId: "", hours: "8" }),
      ]),
    ]);

    // The unconfirmed name is still somebody; TBD and blank are the same nobody.
    expect(loads.map((load) => [load.teacher, load.total])).toEqual([["Grace Younes", 50], ["", 20]]);
    // And nobody comes last, whatever the alphabet says.
    expect(loads[loads.length - 1].teacher).toBe("");
  });

  it("counts the hours nobody is teaching, which the workbook leaves out", () => {
    const loads = teacherLoads([sheet("FYS-S1", [row(), row({ crn: "2", teacher: "", teacherId: "", hours: "15" })])]);

    expect(loadTotals(loads)).toEqual({ teachers: 1, hours: 65, unnamed: 15, sections: 2 });
  });

  it("says nothing about nobody when there is nobody to say it about", () => {
    expect(loadTotals(teacherLoads([sheet("FYS-S1", [row()])]))).toMatchObject({ teachers: 1, unnamed: 0 });
  });
});

const CATALOGUE: CohortCatalogue[] = [
  {
    cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
    scopes: [
      {
        id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [{ id: "td-math", code: "MATH001", name: "Pre-calculus 1", component: "TD", request: { ...EMPTY_REQUEST, hours: "36", teacherId: "act-2" } }],
        groups: [
          { id: "td-1", label: "1", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 30, crns: { "td-math": { ...EMPTY_SECTION, crn: "23223", teacherId: "act-1", hours: "50" } } },
          // Says nothing of its own, so its course answers for it — teacher included.
          { id: "td-2", label: "2", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 28, crns: { "td-math": { ...EMPTY_SECTION, crn: "23224" } } },
        ],
      },
    ],
  },
];

describe("what one teacher teaches", () => {
  const cards = buildCards(CATALOGUE, () => "Semester 1", [], new Map());

  it("finds the sections chosen for them", () => {
    const taught = sectionsTaughtBy(cards, "act-1");

    expect(taught.map((section) => [section.scopeCode, section.groupLabel, section.hours])).toEqual([["TD", "1", "50"]]);
    expect(taught[0].students).toBe(30);
  });

  it("finds the ones their course names them for, as the workbook will", () => {
    const taught = sectionsTaughtBy(cards, "act-2");

    // TD 2 says nothing; its course says act-2 and 36 hours, so that is the row.
    expect(taught.map((section) => [section.groupLabel, section.hours])).toEqual([["2", "36"]]);
  });

  it("finds the sections that carry only their name, unconfirmed as they are", () => {
    // Most sections carry what the registrar wrote and have never been confirmed; matching
    // on the id alone said somebody teaching four classes teaches nothing.
    const typed = buildCards(
      [
        {
          ...CATALOGUE[0],
          scopes: [
            {
              ...CATALOGUE[0].scopes[0],
              courses: [{ ...CATALOGUE[0].scopes[0].courses[0], request: EMPTY_REQUEST }],
              groups: [
                { id: "td-1", label: "1", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 4, crns: { "td-math": { ...EMPTY_SECTION, crn: "1", teacher: " Grace Younes " } } },
                { id: "td-2", label: "2", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 4, crns: { "td-math": { ...EMPTY_SECTION, crn: "2", teacher: "Grace Younes", teacherId: "act-9" } } },
              ],
            },
          ],
        },
      ],
      () => "Semester 1",
      [],
      new Map(),
    );

    expect(sectionsTaughtBy(typed, "", "Grace Younes").map((section) => section.crn)).toEqual(["1"]);
    // A section given to somebody else is not theirs, whatever its row is called.
    expect(sectionsTaughtBy(typed, "act-9", "Grace Younes").map((section) => section.crn)).toEqual(["1", "2"]);
    expect(sectionsTaughtBy(typed, "", "nobody at all")).toEqual([]);
  });

  it("counts the same hours the request sheets do", () => {
    const sheets = requestSheets(cards, "term-1", "Semester 1", () => "", (id) => (id === "act-1" ? "Grace" : "Sudarshan"));
    const loads = teacherLoads(sheets);

    expect(loads.map((load) => [load.teacher, load.total])).toEqual([["Grace", 50], ["Sudarshan", 36]]);
  });
});


const ACTIVE = (over: Partial<ActiveTeacher>): ActiveTeacher => ({
  id: "act-1", portalTeacherId: "", partTimeTeacherId: "", fullName: "Samar Ghantous", email: "samar@sorbonne.ae",
  source: "portal", addedAt: "", addedBy: "", teacherStatus: "", category: "Lecturer", type: "Full Time",
  lastTerm: "", department: "SCEN", rank: "", courses: "", institution: "", portalStatus: "",
  ...over,
});

describe("the table's rows and columns", () => {
  it("joins a load to the department's list by id, or failing that by name", () => {
    const loads = teacherLoads([
      sheet("FYS-S1", [
        row({ teacher: "Samar Ghantous", teacherId: "act-1" }),
        // On the list, but every one of their sections carries only what the registrar typed.
        row({ crn: "2", teacher: "Grace Younes", teacherId: "" }),
        row({ crn: "3", teacher: "", teacherId: "" }),
      ]),
    ]);

    const joined = loadRows(loads, [ACTIVE({}), ACTIVE({ id: "act-2", fullName: "Grace Younes", type: "Part-Time" })]);

    expect(joined.map((held) => [held.teacher, held.standing, held.active?.type ?? ""])).toEqual([
      ["Grace Younes", "Not confirmed", "Part-Time"],
      ["Samar Ghantous", "Confirmed", "Full Time"],
      ["", "Nobody yet", ""],
    ]);
  });

  it("gives each cohort a column of its own, named the way the workbook names it", () => {
    const columns = hoursColumns(["FYS-S1", "BSc-L2-S3"]);

    expect(columns.map((column) => column.id)).toEqual([
      "teacher", "standing", "total", "sheet:FYS-S1", "sheet:BSc-L2-S3",
      "type:CM", "type:TD", "type:TP", "sections", "type", "category", "department", "email",
    ]);
    expect(columns.find((column) => column.id === "sheet:BSc-L2-S3")?.displayName).toBe("BSc L2");
    expect(hoursColumn("FYS-S1")).toBe("FYS");
  });

  it("reads a cohort's hours out of the row in the order the sheets came", () => {
    const [first, second] = hoursColumns(["A-S1", "B-S1"]).filter((column) => column.id.startsWith("sheet:"));
    const held = loadRows(teacherLoads([sheet("A-S1", [row()]), sheet("B-S1", [row({ crn: "2", hours: "30" })])]), [])[0];

    expect(first.accessor(held)).toBe(50);
    expect(second.accessor(held)).toBe(30);
  });

  it("shows every cohort to begin with, and keeps who the person is in the picker", () => {
    const shown = shownHoursColumns(["FYS-S1", "BSc-L1-S1"]);

    expect(shown).toContain("sheet:FYS-S1");
    expect(shown).toContain("sheet:BSc-L1-S1");
    // A cohort waiting in the picker is a cohort somebody forgets to count; a department is not.
    expect(shown).not.toContain("department");
    expect(shown).not.toContain("email");
  });
});
