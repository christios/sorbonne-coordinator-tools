import { describe, expect, it } from "vitest";

import { asMemberOf, cohortIn, inSemester, isIn, latestCohort, type Student, type StudentCohort } from "@/services/studentDatabase";

// L1 in Semester 1, and L1 again in Semester 2 once rolled over.
const AUTUMN: StudentCohort = { id: "l1", name: "L1", since: "2026-09-01", termId: "s1" };
const SPRING: StudentCohort = { id: "l1", name: "L1", since: "2027-01-10", termId: "s2" };

const student = (cohorts: StudentCohort[]): Student => ({
  studentId: "A001",
  status: "in_portal",
  cohorts,
  cohortId: null,
  cohortName: "",
  cohortSince: "",
  firstSeenAt: "",
  lastSeenAt: "",
  groups: [],
});

describe("a student's cohort, semester by semester", () => {
  it("finds their cohort in a semester, and none where they have none", () => {
    expect(cohortIn(student([AUTUMN, SPRING]), "s2")?.since).toBe("2027-01-10");
    expect(cohortIn(student([AUTUMN]), "s2")).toBeNull();
    expect(isIn(student([AUTUMN]), "l1")).toBe(true);
    expect(isIn(student([AUTUMN]), "l1", "s2")).toBe(false);
  });

  it("reads a student as the semester on screen sees them", () => {
    const [seen] = inSemester([student([AUTUMN, SPRING])], "s1");

    expect([seen.cohortId, seen.cohortName, seen.cohortSince]).toEqual(["l1", "L1", "2026-09-01"]);
    expect(inSemester([student([AUTUMN])], "s2")[0].cohortId).toBeNull();
  });

  it("reads them as the cohort they joined last when no semester is named", () => {
    const other: StudentCohort = { id: "l2", name: "L2", since: "2027-01-12", termId: "s2" };

    expect(latestCohort([AUTUMN, other])?.name).toBe("L2");
    expect(inSemester([student([other, AUTUMN])])[0].cohortName).toBe("L2");
    expect(inSemester([student([])])[0].cohortId).toBeNull();
  });

  it("reads them as one cohort has them, for that cohort's page", () => {
    const other: StudentCohort = { id: "l2", name: "L2", since: "2027-01-12", termId: "s2" };

    expect(asMemberOf([student([AUTUMN, other])], "l1")[0].cohortSince).toBe("2026-09-01");
    expect(asMemberOf([student([other])], "l1")[0].cohortId).toBeNull();
  });
});
