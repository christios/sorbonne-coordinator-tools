import { describe, expect, it } from "vitest";

import { requisitionCheck, requisitionCourseCode } from "./requisitionCheck";

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
