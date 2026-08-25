import { describe, expect, it } from "vitest";

import { formatTeachingHours, lastIncompleteRequisitionStep, missingRequisitionFields, totalTeachingHours } from "./requisitions";

describe("missingRequisitionFields", () => {
  it("reports incomplete request details and manual course fields before save or export", () => {
    expect(missingRequisitionFields({
      label: "Semester 1",
      academicYear: "",
      content: {
        department: "",
        program: "",
        jobTitle: "Part Time Lecturer",
        classType: "",
        employeeType: "PT",
        contractFrom: "",
        contractTo: "",
        courses: [{ id: "course-1", title: "", subjectCode: "RMAS", courseNumber: "", level: "", hours: "" }],
      },
    })).toEqual([
      "Academic year",
      "Hiring department",
      "Programme",
      "Type of class",
      "Contract from",
      "Contract to",
      "Course 1 title",
      "Course 1 number",
      "Course 1 level",
      "Course 1 hours",
      "Course 1 class type",
    ]);
  });
});

describe("lastIncompleteRequisitionStep", () => {
  it("sends export validation to the final incomplete workflow section and its first field", () => {
    expect(lastIncompleteRequisitionStep({
      label: "Semester 1",
      academicYear: "2026-2027",
      content: {
        department: "Science",
        program: "Foundation year in Sciences",
        jobTitle: "Part Time Lecturer",
        classType: "TD",
        employeeType: "PT",
        contractFrom: "2026-09-01",
        contractTo: "2026-12-20",
        courses: [{ id: "course-1", title: "", subjectCode: "PHY", courseNumber: "101", level: "", hours: "24" }],
      },
    })).toEqual({ section: "courses", focusTarget: "course:course-1:title" });
  });

  it("targets the first missing detail when the teaching load is complete", () => {
    expect(lastIncompleteRequisitionStep({
      label: "Semester 1",
      academicYear: "",
      content: {
        department: "",
        program: "Foundation year in Sciences",
        jobTitle: "Part Time Lecturer",
        classType: "TD",
        employeeType: "PT",
        contractFrom: "2026-09-01",
        contractTo: "2026-12-20",
        courses: [{ id: "course-1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "24", classType: "TD" }],
      },
    })).toEqual({ section: "details", focusTarget: "academic-year" });
  });
});

describe("totalTeachingHours", () => {
  it("preserves decimal teaching hours in totals and display values", () => {
    const total = totalTeachingHours([
      { id: "course-1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "1.5 TD" },
      { id: "course-2", title: "Lab", subjectCode: "PHY", courseNumber: "102", level: "L1", hours: "2.25" },
    ]);

    expect(total).toBe(3.75);
    expect(formatTeachingHours(total)).toBe("3.75");
  });
});
