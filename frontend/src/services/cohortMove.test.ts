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
    cohortSince: "",
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

    expect(cost).toEqual({ students: 1, placements: 3, semesters: ["Semester 1", "Semester 2"], retained: 0 });
  });

  it("costs nothing when they are already in the cohort being moved to", () => {
    const cost = costOfMove([student("A1", "fy", [td("term-1")])], ["A1"], "fy", TERMS);

    expect(cost).toEqual({ students: 0, placements: 0, semesters: [], retained: 0 });
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

    expect(cost).toEqual({ students: 1, placements: 1, semesters: ["Semester 1"], retained: 0 });
  });

  it("falls back to the semester's id when its name is not known", () => {
    expect(costOfMove([student("A1", "fy", [td("term-9")])], ["A1"], "l1", TERMS).semesters).toEqual([
      "term-9",
    ]);
  });
});

describe("saying the cost", () => {
  it("says nothing at all when nothing is lost", () => {
    expect(describeCost({ students: 0, placements: 0, semesters: [], retained: 0 })).toBe("");
  });

  it("names the one semester when there is only one", () => {
    const said = describeCost({ students: 1, placements: 2, semesters: ["Semester 1"], retained: 0 });

    expect(said).toContain("1 student would lose 2 group placements in Semester 1");
  });

  it("names them all when the move reaches past this semester", () => {
    const said = describeCost({
      students: 6,
      placements: 11,
      semesters: ["Semester 1", "Semester 2"],
      retained: 0,
    });

    expect(said).toContain("6 students would lose 11 group placements across 2 semesters");
    expect(said).toContain("Semester 1, Semester 2");
  });
});

/*
 * The languages are the university's sets, not a cohort's. A student moving from L1 to L2
 * does not thereby stop being in French A1 — the server keeps those placements now, and
 * the dialog used to threaten them.
 */
describe("what a move keeps", () => {
  const student = (over: Partial<Student> = {}): Student =>
    ({
      studentId: "A1", status: "in_portal", cohortId: "c1", cohortName: "L1", cohortSince: "",
      firstSeenAt: "", lastSeenAt: "",
      groups: [
        { termId: "t1", scopeCode: "TD", groupLabel: "1", openToAll: false },
        { termId: "t1", scopeCode: "LANG", groupLabel: "A1", openToAll: true },
      ],
      ...over,
    }) as Student;

  it("counts a shared placement as kept, not as lost", () => {
    const cost = costOfMove([student()], ["A1"], "c2", {});

    expect(cost.placements).toBe(1);
    expect(cost.retained).toBe(1);
  });

  it("says so, so the warning does not overstate the damage", () => {
    const said = describeCost(costOfMove([student()], ["A1"], "c2", { t1: "Semester 1" }));

    expect(said).toMatch(/would lose 1 group placement/);
    expect(said).toMatch(/1 placement in sets open to every cohort — the languages — is kept/);
  });

  it("costs nothing at all when every placement is a shared one", () => {
    // Nothing is lost, so nothing is said: a dialog that appears to reassure gets clicked
    // through, and this move genuinely needs no confirmation.
    const only = student({ groups: [{ termId: "t1", scopeCode: "LANG", groupLabel: "A1", openToAll: true }] });

    expect(describeCost(costOfMove([only], ["A1"], "c2", {}))).toBe("");
  });
});
