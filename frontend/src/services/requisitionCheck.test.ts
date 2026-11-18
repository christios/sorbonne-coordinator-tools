import { describe, expect, it } from "vitest";

import { daysOfSemester, requisitionCheck, requisitionCourseCode, semesterContract, semestersOfRequisition } from "./requisitionCheck";

const course = (code: string, hours: string) => ({
  id: code,
  courseCode: code,
  subjectCode: "",
  courseNumber: "",
  level: "",
  title: "",
  hours,
});

describe("requisitionCheck", () => {
  it("says nothing when the contract and the planning name the same courses for the same hours", () => {
    const warnings = requisitionCheck(
      [
        { courseCode: "ENGL-101", hours: "21" },
        { courseCode: "ENGL-101", hours: "21" },
      ],
      [{ content: { courses: [course("ENGL-101", "42 h")] } }],
    );
    expect(warnings).toEqual([]);
  });

  it("warns both ways, and on the hours where both sides name the course", () => {
    const warnings = requisitionCheck(
      [
        { courseCode: "ENGL-101", hours: "21" },
        { courseCode: "ENGL-102", hours: "21" },
        { courseCode: "SPAN-101", hours: "21", retired: true },
      ],
      [{ content: { courses: [course("ENGL-101", "42"), course("GERM-101", "21")] } }],
    );
    expect(warnings.map((warning) => [warning.kind, warning.courseCode])).toEqual([
      ["hours", "ENGL-101"],
      ["unpaid", "ENGL-102"],
      ["untaught", "GERM-101"],
    ]);
    expect(warnings[0].text).toBe("ENGL-101: the requisition pays for 42 h, the planning gives 21 h");
    expect(warnings[1].text).toContain("no requisition covers");
    expect(warnings[2].text).toContain("never gives them");
  });

  it("reads a requisition line's course from its subject and number when no code was typed", () => {
    expect(requisitionCourseCode({ courseCode: "", subjectCode: "engl", courseNumber: "101" })).toBe("ENGL-101");
    expect(requisitionCourseCode({ courseCode: "ENGL 101", subjectCode: "", courseNumber: "" })).toBe("ENGL101");
    expect(requisitionCourseCode({ courseCode: "ENGL-101", subjectCode: "x", courseNumber: "9" })).toBe("ENGL-101");
  });
});

describe("a requisition's semester", () => {
  // As live on 18 Nov 2026: Semester 1 from 31 Aug for 15 weeks, Semester 2 from 25 Jan for 17.
  const S1 = { id: "plan:262710", academicYear: "2026-2027", ...daysOfSemester("2026-08-31", 15)! };
  const S2 = { id: "plan:262720", academicYear: "2026-2027", ...daysOfSemester("2027-01-25", 17)! };
  const requisition = (from: string, to: string, ...courses: ReturnType<typeof course>[]) => ({
    academicYear: "2026-2027",
    content: { contractFrom: from, contractTo: to, courses },
  });

  it("runs from Week 1's Monday to the Sunday ending its last week", () => {
    expect(daysOfSemester("2026-08-31", 15)).toEqual({ from: "2026-08-31", to: "2026-12-13" });
    expect(daysOfSemester("", 15)).toBeNull();
  });

  it("is the semester its contract dates overlap — Semester 1's run to 31 December, short of Semester 2", () => {
    expect(semestersOfRequisition(requisition("2026-08-31", "2026-12-31"), [S1, S2])).toEqual(["plan:262710"]);
    expect(semestersOfRequisition(requisition("2027-01-18", "2027-05-31"), [S1, S2])).toEqual(["plan:262720"]);
    expect(semestersOfRequisition(requisition("2026-09-01", "2027-06-30"), [S1, S2])).toEqual(["plan:262710", "plan:262720"]);
  });

  it("goes by its academic year when it has no dates, or its dates miss every semester", () => {
    expect(semestersOfRequisition(requisition("", ""), [S1, S2])).toEqual(["plan:262710", "plan:262720"]);
    expect(semestersOfRequisition(requisition("2027-07-01", "2027-07-31"), [S1, S2])).toEqual(["plan:262710", "plan:262720"]);
    expect(semestersOfRequisition({ ...requisition("", ""), academicYear: "2025-2026" }, [S1, S2])).toEqual([]);
  });

  it("holds a semester's requisitions against that semester's sections only (Bilal Maaz, 18 Nov 2026)", () => {
    const sections = [
      { termId: "plan:262710", courseCode: "MATH-001", hours: "50" },
      { termId: "plan:262720", courseCode: "MATH-002", hours: "60" },
    ];
    const paid = [requisition("2026-08-31", "2026-12-31", course("MATH-001", "50"))];

    const first = semesterContract(sections, paid, [S1, S2], "plan:262710");
    expect(first.requisitions).toEqual(paid);
    expect(first.warnings).toEqual([]);

    // Semester 2 has no requisition yet: its lecture is said unpaid, Semester 1's is not.
    const second = semesterContract(sections, paid, [S1, S2], "plan:262720");
    expect(second.requisitions).toEqual([]);
    expect(second.warnings.map((warning) => [warning.kind, warning.courseCode, warning.planned])).toEqual([["unpaid", "MATH-002", 60]]);
  });

  it("holds a requisition for the whole year against both semesters' sections, and says it runs past this one", () => {
    const sections = [
      { termId: "plan:262710", courseCode: "MATH-001", hours: "50" },
      { termId: "plan:262720", courseCode: "MATH-002", hours: "60" },
    ];
    const year = requisition("2026-09-01", "2027-06-30", course("MATH-001", "50"), course("MATH-002", "60"));

    const first = semesterContract(sections, [year], [S1, S2], "plan:262710");
    expect(first.warnings).toEqual([]);
    expect(first.runsPast).toEqual([year]);
  });

  it("says nothing of a semester with neither sections nor a requisition", () => {
    const sections = [{ termId: "plan:262710", courseCode: "MATH-001", hours: "50" }];
    const paid = [requisition("2026-08-31", "2026-12-31", course("MATH-001", "50"))];
    expect(semesterContract(sections, paid, [S1, S2], "plan:262720")).toEqual({ requisitions: [], runsPast: [], warnings: [] });
  });
});
