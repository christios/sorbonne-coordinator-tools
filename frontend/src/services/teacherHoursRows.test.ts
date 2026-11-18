import { describe, expect, it } from "vitest";

import {
  academicYearOfTerm,
  claimsOfSemester,
  crnDistribution,
  hoursRowsFor,
  semesterAsItWent,
  type HoursSource,
} from "@/services/teacherHoursRows";
import { asTaught } from "@/services/teacherLoad";
import type { ActiveTeacher } from "@/services/portalLists";
import type { RequestRow, RequestSheet } from "@/services/timetableExport";

const row = (over: Partial<RequestRow> = {}): RequestRow => ({
  courseName: "Mechanics TD", degree: "", ue: "", crn: "23223", parentCrn: "", subject: "PHYS",
  courseNumber: "101", hours: "40", type: "TD", roomPref: "", teacher: "Hani Sayes", teacherId: "act-1",
  timePref: "", dayPref: "", constraints: "", weeks: "", duration: "", anticipated: "", comments: "", retired: false,
  ...over,
});
const HANI = { id: "act-1", fullName: "Hani Sayes", partTimeTeacherId: "pt-1" } as ActiveTeacher;

/** Hani is planned for 40 h of teaching; his Semester 1 requisition pays for 40 h of it and 12 h of admin. */
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
        requisitionList: [
          { academicYear: "2026-2027", contractFrom: "2026-08-31", contractTo: "2026-12-31", teachingHours: 40, adminHours: 12 },
          { academicYear: "2025-2026", contractFrom: "2025-09-01", contractTo: "2025-12-31", teachingHours: 0, adminHours: 8 },
        ],
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

// As live on 18 Nov 2026: Semester 1 from 31 Aug for 15 weeks, Semester 2 from 25 Jan for 17.
const DAYS = [
  { id: "plan:262710", academicYear: "2026-2027", from: "2026-08-31", to: "2026-12-13" },
  { id: "plan:262720", academicYear: "2026-2027", from: "2027-01-25", to: "2027-05-23" },
];
const S1 = { semester: { id: "plan:262710", days: DAYS } };
const S2 = { semester: { id: "plan:262720", days: DAYS } };

describe("requisitions on Teacher hours", () => {
  it("are the semester's own: those whose contract dates fall in it, admin in a column of its own", () => {
    const [hani] = hoursRowsFor(source(S1), WHOLE, true);

    expect(hani.requisitionedHours).toBe(40);
    expect(hani.adminHours).toBe(12);
    expect(hani.total).toBe(40);
  });

  it("leave another semester's requisitions out", () => {
    const [hani] = hoursRowsFor(source(S2), WHOLE, true);

    expect(hani.requisitionedHours).toBe(0);
    expect(hani.adminHours).toBe(0);
  });

  it("are every requisition's where the semester is not known", () => {
    expect(hoursRowsFor(source(), WHOLE, true)[0].requisitionedHours).toBe(40);
    expect(hoursRowsFor(source(), WHOLE, true)[0].adminHours).toBe(20);
  });

  it("make no warning when the semester's requisition pays for its plan", () => {
    const [hani] = hoursRowsFor(source(S1), WHOLE, true);

    expect(hani.warnings.map((warning) => warning.kind)).not.toContain("plan_vs_contract");
  });

  it("say a semester planned for him that none of his requisitions is for yet", () => {
    const [hani] = hoursRowsFor(source(S2), WHOLE, true);
    const unpaid = hani.warnings.find((warning) => warning.kind === "plan_vs_contract");

    expect(unpaid?.label).toBe("Requisition short 40 h");
    expect(unpaid?.sentence).toBe("Hani Sayes: we plan 40 h this semester and none of their requisitions is for it yet.");
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

  it("holds the portal against the plan as the semester went, as the portal books it", () => {
    // Samar took his 7 Sep class and he covered two of hers: 40 h planned comes to 42 h,
    // which is what the portal books under him. Held against the 40 h, that was "Portal over 2 h".
    const held = busy();
    held.notes = [
      note({ crn: "23223", meetsOn: "2026-09-07", kind: "covered", coverTeacherId: "act-2", coverTeacherName: "Samar Ghantous" }),
      note({ crn: "23224", meetsOn: "2026-09-08", kind: "covered", coverTeacherId: "act-1", coverTeacherName: "Hani Sayes" }),
      note({ crn: "23224", meetsOn: "2026-09-15", kind: "covered", coverTeacherId: "act-1", coverTeacherName: "Hani Sayes" }),
    ];
    held.booked = {
      "23223": {
        courseCode: "PHYS-101", teacherName: "Hani Sayes", hours: 40,
        byTeacher: [{ teacherName: "Hani Sayes", hours: 38 }, { teacherName: "Samar Ghantous", hours: 2 }],
      },
      "23224": {
        courseCode: "PHYS-101", teacherName: "Samar Ghantous", hours: 40,
        byTeacher: [{ teacherName: "Samar Ghantous", hours: 36 }, { teacherName: "Hani Sayes", hours: 4 }],
      },
    };

    const [hani] = hoursRowsFor(held, WHOLE, true);

    expect(hani.registrarHours).toBe(42);
    expect(hani.warnings.map((warning) => warning.kind)).not.toContain("plan_vs_registrar");
  });

  it("holds a time sheet's teaching against the timetable, and leaves its admin out", () => {
    // September as the timetable has it: his 7 Sep class and the one he covered on 15 Sep.
    const line = (date: string, kind: "teaching" | "admin") => ({ day: "", date, from: "08:30", to: "10:30", hours: 2, details: "", kind });
    const claiming = (third: "teaching" | "admin") => {
      const held = busy();
      held.submitted = [
        {
          teacherId: "pt-1", periodStart: "2026-09-01", periodEnd: "2026-09-30", periodLabel: "Sep 2026", claimedHours: 6,
          days: [line("2026-09-07", "teaching"), line("2026-09-15", "teaching"), line("2026-09-16", third)],
        } as never,
      ];
      return hoursRowsFor(held, WHOLE, true)[0].warnings.filter((warning) => warning.kind === "claim_vs_taught");
    };

    // A test invigilated is paid, and never on the timetable.
    expect(claiming("admin")).toEqual([]);
    // A third class the timetable does not have is still 2 h over it.
    expect(claiming("teaching").map((warning) => warning.label)).toEqual(["Claim over 2 h"]);
  });

  it("gives the teacher record the row's own Total, the plan as the semester went", () => {
    const held = busy();
    const [row] = hoursRowsFor(held, WHOLE, true);

    const went = semesterAsItWent(held.sheets, held.teachers, held.notes, { id: "act-1", name: "Hani Sayes" });

    // 40 h planned, the 14 Sep class cancelled, Samar's 15 Sep class covered.
    expect(went).toEqual({ planned: 40, cancelled: 2, coveredByOthers: 0, coveredForOthers: 2, total: 40 });
    expect(went?.total).toBe(asTaught(row));
    // Found by name too, for somebody opened from the portal's list with no id of ours.
    expect(semesterAsItWent(held.sheets, held.teachers, held.notes, { id: "", name: "hani sayes" })?.total).toBe(40);
    // Nothing planned and nothing covered that semester: nothing to say.
    expect(semesterAsItWent(held.sheets, held.teachers, held.notes, { id: "act-9", name: "Nobody Here" })).toBeNull();
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

  it("counts the portal's figure on the classes that name them, on the row and on its lines alike", () => {
    // The section is Hani's now, but the portal names Sachin Valera on its first class.
    const held = busy();
    held.sections = held.sections.map((section) =>
      section.crn === "23223"
        ? { ...section, meetings: section.meetings.map((meeting, index) => (index === 0 ? { ...meeting, teacherName: "Sachin Valera" } : meeting)) }
        : section,
    );
    held.booked = {
      "23223": {
        courseCode: "PHYS-101",
        teacherName: "Hani Sayes",
        hours: 6,
        byTeacher: [
          { teacherName: "Hani Sayes", hours: 4 },
          { teacherName: "Sachin Valera", hours: 2 },
        ],
      },
    };
    const september = { from: "2026-09-01", to: "2026-09-30" };

    const [whole] = hoursRowsFor(held, WHOLE, true);
    expect(whole.registrarHours).toBe(4);
    expect(crnDistribution(held, whole, WHOLE, true)[0].booked).toBe(4);

    const [hani] = hoursRowsFor(held, september, false);
    expect(hani.registrarHours).toBe(2);
    expect(crnDistribution(held, hani, september, false)[0].booked).toBe(2);
  });
});

describe("the claims of one semester", () => {
  // On Semester 2 every Semester 1 claim read "the timetable has 0 h".
  const weekOnes = { "plan:262710": "2026-09-07", "plan:262720": "2027-01-25" };
  const claims = [
    { periodStart: "2026-08-26", periodEnd: "2026-09-25" },
    { periodStart: "2026-12-26", periodEnd: "2027-01-25" },
    { periodStart: "2027-01-26", periodEnd: "2027-02-25" },
  ];

  it("are the ones whose period ends once that semester has begun, and before the next has", () => {
    expect(claimsOfSemester(claims, "plan:262710", weekOnes).map((claim) => claim.periodStart)).toEqual([
      "2026-08-26",
    ]);
    expect(claimsOfSemester(claims, "plan:262720", weekOnes).map((claim) => claim.periodStart)).toEqual([
      "2026-12-26",
      "2027-01-26",
    ]);
  });

  it("are all of them when the semester's Week 1 is not set", () => {
    expect(claimsOfSemester(claims, "plan:262810", weekOnes)).toHaveLength(3);
  });
});
