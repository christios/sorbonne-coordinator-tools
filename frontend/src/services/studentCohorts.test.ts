import { describe, expect, it } from "vitest";

import { cohortBeside, inSemester, isIn, latestCohort, sameSemester, type Student, type StudentCohort } from "@/services/studentDatabase";

const S1: StudentCohort = { id: "l1-s1", name: "L1-S1", since: "2026-09-01", terms: ["262710"] };
const S2: StudentCohort = { id: "l1-s2", name: "L1-S2", since: "2027-01-10", terms: ["262720"] };

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

describe("a student's cohort, one per semester", () => {
  it("counts two cohorts as one semester's when they share a portal term, or neither names one", () => {
    expect(sameSemester(S1, { terms: ["262710", "262720"] })).toBe(true);
    expect(sameSemester(S1, S2)).toBe(false);
    expect(sameSemester({ terms: [] }, { terms: [] })).toBe(true);
    expect(sameSemester({ terms: [] }, S1)).toBe(false);
  });

  it("finds their cohort of another cohort's semester, and none where they have none", () => {
    const both = student([S1, S2]);

    expect(cohortBeside(both, { id: "l2-s2", terms: ["262720"] })?.id).toBe("l1-s2");
    expect(cohortBeside(student([S1]), { id: "l2-s2", terms: ["262720"] })).toBeNull();
    expect(isIn(both, "l1-s1") && isIn(both, "l1-s2")).toBe(true);
  });

  it("reads a student as the semester on screen sees them", () => {
    const [seen] = inSemester([student([S1, S2])], ["l1-s1", "l2-s1"]);

    expect([seen.cohortId, seen.cohortName, seen.cohortSince]).toEqual(["l1-s1", "L1-S1", "2026-09-01"]);
    expect(inSemester([student([S1])], ["l1-s2"])[0].cohortId).toBeNull();
  });

  it("reads them as their latest cohort when no semester is named", () => {
    expect(latestCohort([S1, S2])?.id).toBe("l1-s2");
    expect(inSemester([student([S2, S1])])[0].cohortName).toBe("L1-S2");
    expect(inSemester([student([])])[0].cohortId).toBeNull();
  });
});
