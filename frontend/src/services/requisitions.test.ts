import { describe, expect, it } from "vitest";

import { missingRequisitionFields } from "./requisitions";

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
    ]);
  });
});
