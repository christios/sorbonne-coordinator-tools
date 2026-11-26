import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseWeeks } from "@/components/RequestSummary";
import type { CoursePlan, TeachingWeek } from "@/services/coursePlans";

const WEEKS: TeachingWeek[] = [1, 2, 3, 4].map((week) => ({ week, monday: `2027-01-${String(4 + week * 7).padStart(2, "0")}`, holidays: [] }));
const COURSE: CoursePlan = {
  courseCode: "PHYS-101",
  title: "Mechanics",
  coefficient: "",
  active: true,
  components: { CM: { hours: 6, length: 1.5 }, TD: { hours: 6, length: 1.5 }, TP: { hours: 6, length: 3 } },
  hoursUpdatedAt: "",
  hoursUpdatedBy: "",
  leadId: "lead",
  leadName: "A Lead",
  leadSetAt: "",
  leadSetBy: "",
  weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 }, TD: { "1": 1, "2": 1, "3": 1, "4": 1 }, TP: { "3": 1, "4": 1 } },
  exams: { TD: { "4": [1] } },
  cmFirst: true,
  tdBeforeTp: true,
  note: "",
  answeredAt: "2026-11-26T10:00:00Z",
  answeredBy: "A Lead",
  answerSource: "lead",
};

describe("a course's weeks, read back (26 Nov 2026)", () => {
  it("marks the exam's week and says the exams and the order the lead asked for", () => {
    render(<CourseWeeks course={COURSE} weeks={WEEKS} />);
    expect(screen.getByRole("img", { name: "Week 4: 1 TD session of 1.5 h, with an exam" }).textContent).toContain("1E");
    const said = document.querySelector("[data-order-exams]")?.textContent ?? "";
    expect(said).toContain("TD exam in week 4");
    expect(said).toContain("In the same week: CM before TD/TP · TD before TP");
  });

  it("says nothing of either when the lead asked for neither", () => {
    render(<CourseWeeks course={{ ...COURSE, exams: {}, cmFirst: false, tdBeforeTp: false }} weeks={WEEKS} />);
    expect(document.querySelector("[data-order-exams]")).toBeNull();
  });
});
