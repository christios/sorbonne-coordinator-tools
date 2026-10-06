import { describe, expect, it } from "vitest";

import { academicYearOfTerm, crnDistribution, hoursRowsFor, type HoursSource } from "@/services/teacherHoursRows";
import type { ActiveTeacher } from "@/services/portalLists";
import type { RequestRow, RequestSheet } from "@/services/timetableExport";

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  courseName: "Mechanics TD", degree: "", ue: "", crn: "23223", parentCrn: "", subject: "PHYS",
  courseNumber: "101", hours: "40", type: "TD", roomPref: "", teacher: "Hani Sayes", teacherId: "act-1",
  timePref: "", dayPref: "", constraints: "", weeks: "", duration: "", anticipated: "", comments: "", retired: false,
  ...over,
});
const HANI = { id: "act-1", fullName: "Hani Sayes", partTimeTeacherId: "pt-1" } as ActiveTeacher;

/** Hani is planned for 40 h of teaching; the requisitions pay for 40 h of it and 12 h of admin in 2026-27. */
function source(over: Partial<HoursSource> = {}): HoursSource {
  const sheets: RequestSheet[] = [{ title: "BSc-L1-S1", heading: "BSc-L1-S1", semester: "Semester 1", rows: [row()] }];
  return {
    sheets,
    teachers: [HANI],
    notes: [],
    sections: [],
    booked: {},
    owners: new Map(),
    submitted: [],
    contracts: {
      "pt-1": {
        requisitions: 2,
        contractedHours: 40,
        adminHours: 20,
        byYear: {
          "2026-2027": { requisitions: 1, teachingHours: 40, adminHours: 12 },
          "2025-2026": { requisitions: 1, teachingHours: 0, adminHours: 8 },
        },
        timeSheets: 0,
        newestTimeSheet: null,
        hasDocuments: false,
      },
    },
    decided: new Map(),
    threshold: 2,
    today: "2026-09-26",
    ...over,
  };
}
const WHOLE = { from: "0000-01-01", to: "9999-12-31" };

describe("admin hours on Teacher hours", () => {
  it("are the semester's own year's, in a column of their own", () => {
    const [hani] = hoursRowsFor(source({ academicYear: "2026-2027" }), WHOLE, true);

    expect(hani.adminHours).toBe(12);
    expect(hani.total).toBe(40);
  });

  it("show the teaching the requisitions pay for beside them, the same year's", () => {
    expect(hoursRowsFor(source({ academicYear: "2026-2027" }), WHOLE, true)[0].requisitionedHours).toBe(40);
    expect(hoursRowsFor(source({ academicYear: "2025-2026" }), WHOLE, true)[0].requisitionedHours).toBe(0);
    expect(hoursRowsFor(source(), WHOLE, true)[0].requisitionedHours).toBe(40);
  });

  it("are every year's where the semester's year is not known", () => {
    expect(hoursRowsFor(source(), WHOLE, true)[0].adminHours).toBe(20);
  });

  it("never make a warning: the teaching the requisitions pay for matches the plan", () => {
    const [hani] = hoursRowsFor(source({ academicYear: "2026-2027" }), WHOLE, true);

    expect(hani.warnings.map((warning) => warning.kind)).not.toContain("plan_vs_contract");
  });
});

describe("the academic year of a portal term", () => {
  it("is read from the first four digits of its code", () => {
    expect(academicYearOfTerm("262710")).toBe("2026-2027");
    expect(academicYearOfTerm("")).toBe("");
  });
});

describe("a teacher's hours, CRN by CRN", () => {
  const meet = (meetsOn: string) => ({ meetsOn, startsAt: "08:30", endsAt: "10:30", room: "5.110" });
  const note = (over: Record<string, string>) =>
    ({ id: over.meetsOn, termCode: "262710", startsAt: "08:30", endsAt: "10:30", coverTeacherId: "", coverTeacherName: "", note: "", ...over }) as never;
  /** Hani's 23223 meets three times; Samar's 23224 twice, once with Hani standing in. */
  function busy(): HoursSource {
    return source({
      sheets: [
        {
          title: "BSc-L1-S1",
          heading: "",
          semester: "Semester 1",
          rows: [row(), row({ crn: "23224", teacher: "Samar Ghantous", teacherId: "act-2", courseName: "Mechanics TD 2" })],
        },
      ],
      sections: [
        { crn: "23223", courseCode: "PHYS-101", title: "", teacherName: "Hani Sayes", state: "published", meetings: [meet("2026-09-07"), meet("2026-09-14"), meet("2026-10-05")] },
        { crn: "23224", courseCode: "PHYS-101", title: "", teacherName: "Samar Ghantous", state: "published", meetings: [meet("2026-09-08"), meet("2026-09-15")] },
      ],
      notes: [
        note({ crn: "23223", meetsOn: "2026-09-14", kind: "cancelled" }),
        note({ crn: "23224", meetsOn: "2026-09-15", kind: "covered", coverTeacherId: "act-1", coverTeacherName: "Hani Sayes" }),
      ],
      owners: new Map([
        ["23223", { id: "act-1", name: "Hani Sayes" }],
        ["23224", { id: "act-2", name: "Samar Ghantous" }],
      ]),
      booked: { "23223": { courseCode: "PHYS-101", teacherName: "Hani Sayes", hours: 6 } },
    });
  }

  it("adds up to the row over a window: what met, less the cancelled, and the class covered as a line of its own", () => {
    const window = { from: "2026-09-01", to: "2026-09-30" };
    const [hani] = hoursRowsFor(busy(), window, false);
    const lines = crnDistribution(busy(), hani, window, false);

    expect(lines.map((line) => [line.crn, line.booked, line.cancelled, line.taught, line.coveringFor])).toEqual([
      ["23223", 4, 2, 2, ""],
      ["23224", 0, 0, 2, "Samar Ghantous"],
    ]);
    expect(lines.reduce((sum, line) => sum + line.taught, 0)).toBe(hani.total);
  });

  it("keeps the semester's warnings whatever window is being counted", () => {
    const whole = hoursRowsFor(busy(), WHOLE, true)[0].warnings.map((warning) => warning.key);
    const september = hoursRowsFor(busy(), { from: "2026-09-01", to: "2026-09-30" }, false)[0].warnings.map((warning) => warning.key);

    expect(whole.length).toBeGreaterThan(0);
    expect(september).toEqual(whole);
  });

  it("over the whole semester, lists somebody whose only teaching was cover, with nothing planned", () => {
    // Sachin Valera's groups went to Ahmed Menaa; the classes he had taught are his cover.
    const held = busy();
    held.notes = [
      ...held.notes,
      note({ crn: "23223", meetsOn: "2026-09-07", kind: "covered", coverTeacherId: "act-3", coverTeacherName: "Sachin Valera" }),
    ];

    const rows = hoursRowsFor(held, WHOLE, true);
    const sachin = rows.find((entry) => entry.teacher === "Sachin Valera");

    expect(sachin).toMatchObject({ total: 0, coverGiven: 2, crns: [] });
    // Hani covered too, but has a plan of his own: one row, not two.
    expect(rows.filter((entry) => entry.teacher === "Hani Sayes")).toHaveLength(1);
  });

  it("over the whole semester, puts the plan beside what happened to it", () => {
    const [hani] = hoursRowsFor(busy(), WHOLE, true);
    const [own] = crnDistribution(busy(), hani, WHOLE, true);

    expect(own).toMatchObject({ crn: "23223", planned: 40, booked: 6, cancelled: 2, sections: ["Mechanics TD"], cohorts: ["BSc-L1-S1"] });
    expect(own.planned).toBe(hani.total);
  });
});
