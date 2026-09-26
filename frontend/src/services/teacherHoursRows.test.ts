import { describe, expect, it } from "vitest";

import { academicYearOfTerm, hoursRowsFor, type HoursSource } from "@/services/teacherHoursRows";
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
