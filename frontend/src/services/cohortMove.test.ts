import { describe, expect, it } from "vitest";

import { costOfMove, describeCost } from "@/services/cohortMove";
import type { Student } from "@/services/studentDatabase";

function student(
  studentId: string,
  cohortId: string | null,
  groups: { termId: string; scopeCode: string; groupLabel: string }[] = [],
): Student {
  return {
    studentId,
    status: "in_portal",
    cohortId,
    cohortName: cohortId ?? "",
    firstSeenAt: "",
    lastSeenAt: "",
    groups,
  };
}

const TERMS = { "term-1": "Semester 1", "term-2": "Semester 2" };
const td = (termId: string) => ({ termId, scopeCode: "TD", groupLabel: "1" });
const rdns = (termId: string) => ({ termId, scopeCode: "RDNS", groupLabel: "4" });

describe("what a cohort move would throw away", () => {
  it("counts every placement, in every semester, not only the one on screen", () => {
    const cost = costOfMove(
      [student("A1", "fy", [td("term-1"), rdns("term-1"), td("term-2")])],
      ["A1"],
      "l1",
      TERMS,
    );

    expect(cost).toEqual({ students: 1, placements: 3, semesters: ["Semester 1", "Semester 2"] });
  });

  it("costs nothing when they are already in the cohort being moved to", () => {
    const cost = costOfMove([student("A1", "fy", [td("term-1")])], ["A1"], "fy", TERMS);

    expect(cost).toEqual({ students: 0, placements: 0, semesters: [] });
  });

  it("costs nothing for a student nobody has placed", () => {
    expect(costOfMove([student("A1", "fy")], ["A1"], "l1", TERMS).placements).toBe(0);
  });

  it("counts taking them out of every cohort, which is a move to no cohort", () => {
    const cost = costOfMove([student("A1", "fy", [td("term-1")])], ["A1"], null, TERMS);

    expect(cost.placements).toBe(1);
  });

  it("ignores students who are not selected", () => {
    const cost = costOfMove(
      [student("A1", "fy", [td("term-1")]), student("A2", "fy", [td("term-1")])],
      ["A1"],
      "l1",
      TERMS,
    );

    expect(cost).toEqual({ students: 1, placements: 1, semesters: ["Semester 1"] });
  });

  it("falls back to the semester's id when its name is not known", () => {
    expect(costOfMove([student("A1", "fy", [td("term-9")])], ["A1"], "l1", TERMS).semesters).toEqual([
      "term-9",
    ]);
  });
});

describe("saying the cost", () => {
  it("says nothing at all when nothing is lost", () => {
    expect(describeCost({ students: 0, placements: 0, semesters: [] })).toBe("");
  });

  it("names the one semester when there is only one", () => {
    const said = describeCost({ students: 1, placements: 2, semesters: ["Semester 1"] });

    expect(said).toContain("1 student would lose 2 group placements in Semester 1");
  });

  it("names them all when the move reaches past this semester", () => {
    const said = describeCost({
      students: 6,
      placements: 11,
      semesters: ["Semester 1", "Semester 2"],
    });

    expect(said).toContain("6 students would lose 11 group placements across 2 semesters");
    expect(said).toContain("Semester 1, Semester 2");
  });
});
