import { describe, expect, it } from "vitest";

import { cohortsOfGroup } from "@/services/groupCohorts";
import { ALL_COHORTS, asMemberOf, isIn, type Student } from "@/services/studentDatabase";

const groups = { placed: new Map([["A1-G1", new Set(["L1", "FYS"])]]), every: ["FYS", "L1", "L2", "L3"] };

describe("whose a class is", () => {
  it("is its set's cohort's", () => {
    expect(cohortsOfGroup({ cohortId: "l1", cohortName: "L1" }, "TD-1", groups)).toEqual(["L1"]);
  });

  it("is, for All cohorts' sets, the cohorts of the students in its group", () => {
    expect(cohortsOfGroup({ cohortId: ALL_COHORTS, cohortName: "All cohorts" }, "A1-G1", groups)).toEqual(["FYS", "L1"]);
  });

  it("is every cohort's for a language group nobody is placed in yet", () => {
    expect(cohortsOfGroup({ cohortId: ALL_COHORTS, cohortName: "All cohorts" }, "B2-G1", groups)).toEqual(["FYS", "L1", "L2", "L3"]);
  });
});

describe("All cohorts, as a membership", () => {
  const student = {
    studentId: "A001",
    cohorts: [
      { id: "fys", name: "FYS", termId: "s1", since: "2026-09-01" },
      { id: "l1", name: "L1", termId: "s2", since: "2026-11-10" },
    ],
  } as unknown as Student;

  it("takes anybody a cohort holds in the semester", () => {
    expect(isIn(student, ALL_COHORTS, "s1")).toBe(true);
    expect(isIn(student, ALL_COHORTS, "s3")).toBe(false);
    expect(isIn(student, "fys", "s2")).toBe(false);
  });

  it("reads a student from a language group's roster as in their own cohort", () => {
    expect(asMemberOf([student], ALL_COHORTS, "s1")[0].cohortName).toBe("FYS");
    expect(asMemberOf([student], ALL_COHORTS)[0].cohortName).toBe("L1");
  });
});
