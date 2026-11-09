import { describe, expect, it } from "vitest";

import { semestersToPull } from "@/services/syncTargets";

const LINKS = { "plan:262610": "262610", "plan:262710": "262710", "plan:262720": "262720", "hub-x": "262730" };
const TERMS = [
  { id: "plan:262610", name: "Semester 1 2025-26" },
  { id: "plan:262710", name: "Semester 1 2026-27" },
  { id: "plan:262720", name: "Semester 2 2026-27" },
  { id: "hub-x", name: "Summer 2026-27" },
];
const PLANS = [
  { semesterId: "plan:262610", weekOne: "2025-09-01", weeks: 15 },
  { semesterId: "plan:262710", weekOne: "2026-08-31", weeks: 15 },
  { semesterId: "plan:262720", weekOne: "", weeks: 0 },
];

describe("the semesters a sync asks the portal about", () => {
  it("are those with a portal term, in its order, but not one whose teaching ended two months ago", () => {
    const pulled = semestersToPull(LINKS, TERMS, PLANS, new Date(2026, 10, 9));

    // Last year's ended in December 2025; this year's first runs to December; the second's
    // weeks are not said yet, and the Hub's never were.
    expect(pulled).toEqual([
      { code: "262710", name: "Semester 1 2026-27" },
      { code: "262720", name: "Semester 2 2026-27" },
      { code: "262730", name: "Summer 2026-27" },
    ]);
  });

  it("lets a semester go about two months after its last teaching week", () => {
    const codes = (today: Date) => semestersToPull(LINKS, TERMS, PLANS, today).map((semester) => semester.code);

    // 31 August + 15 weeks is 14 December; sixty days on is 12 February.
    expect(codes(new Date(2027, 1, 10))).toContain("262710");
    expect(codes(new Date(2027, 1, 14))).not.toContain("262710");
  });
});
