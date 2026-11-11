import { describe, expect, it } from "vitest";

import { studentsIn } from "@/components/CohortMenu";

describe("a cohort's students", () => {
  // Rolled over, L1 holds the same 109 students in both semesters; its every-semester count
  // is 109 distinct students, and a page on one semester wants that semester's.
  const l1 = { id: "l1", name: "L1", memberCount: 112, memberCounts: { "plan:262710": 109, "plan:262720": 108 } };

  it("are the semester on screen's", () => {
    expect(studentsIn(l1, "plan:262720")).toBe(108);
    expect(studentsIn(l1, "plan:262810")).toBe(0);
  });

  it("are every semester's when no semester is said", () => {
    expect(studentsIn(l1)).toBe(112);
  });
});
