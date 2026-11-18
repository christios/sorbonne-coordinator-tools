import { describe, expect, it } from "vitest";

import {
  coursePlanDrift,
  hoursIn,
  layoutWords,
  planStanding,
  proposedWeeks,
  rowDrift,
  sessionsOf,
  spreadEvenly,
  type CoursePlan,
} from "@/services/coursePlans";
import type { Plan, PlanSection, PlanSeries } from "@/services/semesterPlans";

const PLAN: CoursePlan = {
  courseCode: "MATH-002",
  title: "Elements of Calculus",
  coefficient: "",
  active: true,
  components: { CM: { hours: 24, length: 1.5 }, TD: { hours: 21, length: 1.5 }, TP: { hours: null, length: null } },
  hoursUpdatedAt: "",
  hoursUpdatedBy: "",
  leadId: "valerie",
  leadName: "Valerie Le Guyon",
  leadSetAt: "",
  leadSetBy: "",
  weeks: {},
  note: "",
  answeredAt: "",
  answeredBy: "",
  answerSource: "",
};

const weeks = (from: number, to: number, count = 1) =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, index) => [String(from + index), count]));

const section = (over: Partial<PlanSection> = {}): PlanSection => ({
  id: "td1",
  crn: "22869",
  parentCrn: "",
  courseCode: "MATH-002",
  title: "Elements of Calculus",
  ue: "",
  component: "TD",
  programmes: ["FYS"],
  groupLabel: "TD 1",
  teacherName: "Zanin Kavazovic",
  hours: 21,
  hoursSaid: "21",
  duration: "1.5",
  places: [],
  gone: false,
  comments: "",
  position: 0,
  updatedAt: "",
  updatedBy: "",
  ...over,
});

const series = (over: Partial<PlanSeries> & Pick<PlanSeries, "id" | "weeks">): PlanSeries => ({
  sectionId: "td1",
  weekday: 2,
  startsAt: "10:00",
  endsAt: "11:30",
  room: "",
  teacherName: "",
  note: "",
  revision: 1,
  moves: [],
  createdAt: "",
  createdBy: "",
  updatedAt: "",
  updatedBy: "",
  ...over,
});

/** A plan of 15 weeks whose classes are its series' weeks, every one at its series' time. */
const planOf = (all: PlanSeries[], skipped: number[] = []): Plan => ({
  termCode: "262720",
  semesterId: "plan:262720",
  name: "Semester 2",
  weekOne: "2027-01-11",
  weeks: 15,
  without: [],
  holidays: [],
  updatedAt: "",
  updatedBy: "",
  sections: [section()],
  series: all,
  classes: all.flatMap((one) =>
    one.weeks
      .filter((week) => !skipped.includes(week))
      .map((week) => ({ ...one, seriesId: one.id, week, meetsOn: `w${week}`, moved: false })),
  ),
  skipped: [],
});

describe("spreading a target evenly", () => {
  it("turns hours into whole sessions over every week, the extra ones evenly apart", () => {
    const spread = spreadEvenly(24, 1.5, Array.from({ length: 14 }, (_, index) => index + 1));
    expect(sessionsOf(spread)).toBe(16);
    expect(Object.values(spread).filter((count) => count === 2)).toHaveLength(2);
    // Fewer sessions than weeks: some weeks go without, spread through the semester.
    const thin = spreadEvenly(15, 1.5, Array.from({ length: 14 }, (_, index) => index + 1));
    expect(sessionsOf(thin)).toBe(10);
    expect(Math.max(...Object.values(thin))).toBe(1);
    expect(thin["14"]).toBe(1);
    expect(spreadEvenly(0, 1.5, [1, 2])).toEqual({});
  });
});

describe("saying a layout", () => {
  it("names the weeks as a timetable does, and the weeks holding more", () => {
    expect(layoutWords(weeks(2, 14))).toBe("Weeks 2–14");
    expect(layoutWords({ ...weeks(1, 14), "5": 2, "9": 2 })).toBe("Weeks 1–14 · 2 in weeks 5, 9");
    expect(layoutWords(weeks(1, 3, 2))).toBe("Weeks 1–3 · 2 a week");
    expect(layoutWords({})).toBe("No weeks");
  });

  it("says where the lead's answer stands, and which components miss their target", () => {
    expect(planStanding({ ...PLAN, leadId: "" }).state).toBe("no-lead");
    expect(planStanding(PLAN).state).toBe("waiting");
    const answered = { ...PLAN, answeredAt: "2026-11-18", weeks: { CM: weeks(1, 16), TD: weeks(1, 13) } };
    expect(planStanding(answered)).toEqual({ state: "answered", offTarget: ["TD"] });
  });
});

describe("a Groups & CRNs row against the course plan", () => {
  it("reads one number of hours, and says what differs", () => {
    expect(hoursIn("24")).toBe(24);
    expect(hoursIn("1,5 h")).toBe(1.5);
    expect(hoursIn("60CM")).toBeNull();
    expect(rowDrift({ hours: "21", duration: "2" }, PLAN.components.TD)).toEqual({ hours: "same", length: "differs" });
    expect(rowDrift({ hours: "", duration: "about 1h" }, PLAN.components.TD)).toEqual({ hours: "unsaid", length: "unreadable" });
  });
});

describe("the Semester plan and the course plan", () => {
  const laid = new Map([["MATH-002", { ...PLAN, weeks: { TD: weeks(2, 15) } }]]);

  it("proposes the weeks the course plan still has sessions for", () => {
    const empty = planOf([]);
    expect(proposedWeeks(empty, section(), { component: "TD", hours: 21, length: 1.5, weeks: weeks(2, 15) })).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 2),
    );
    // Two a week in week 5: a second series is proposed week 5 alone.
    const twice = { component: "TD" as const, hours: 22.5, length: 1.5, weeks: { ...weeks(2, 15), "5": 2 } };
    const one = planOf([series({ id: "s1", weeks: Array.from({ length: 14 }, (_, index) => index + 2) })]);
    expect(proposedWeeks(one, section(), twice)).toEqual([5]);
    // The series being changed does not count against itself.
    expect(proposedWeeks(one, section(), twice, "s1")).toHaveLength(14);
    // Nothing laid out: nothing proposed, the plan's own default stands.
    expect(proposedWeeks(empty, section(), { component: "TD", hours: 21, length: 1.5, weeks: {} })).toBeNull();
  });

  it("flags nothing for a class that keeps to its course plan, or has no series yet", () => {
    expect(coursePlanDrift(planOf([]), laid).size).toBe(0);
    const kept = planOf([series({ id: "s1", weeks: Array.from({ length: 14 }, (_, index) => index + 2) })]);
    expect(coursePlanDrift(kept, laid).size).toBe(0);
  });

  it("flags other weeks, missing weeks, a week a holiday took, and a different length", () => {
    const off = planOf(
      [series({ id: "s1", weeks: Array.from({ length: 12 }, (_, index) => index + 1), endsAt: "12:00" })],
      [7],
    );
    const lines = coursePlanDrift(off, laid).get("td1")?.lines ?? [];
    expect(lines[0]).toBe("Course plan · TD in weeks 2–15, sessions of 1.5 h");
    expect(lines).toContain("Sessions of 2 h, not 1.5 h");
    expect(lines).toContain("Meets in week 1, which the course plan leaves free");
    // Week 7's class fell on a holiday: it counts as not placed.
    expect(lines).toContain("Nothing placed in weeks 7, 13–15");
    expect(lines.some((line) => line.startsWith("Week 2: 2 h placed, 1.5 h planned"))).toBe(true);
  });

  it("leaves a class alone whose component the course has no hours for", () => {
    const tp = planOf([series({ id: "s1", weeks: [1] })]);
    tp.sections = [section({ component: "TP" })];
    expect(coursePlanDrift(tp, laid).size).toBe(0);
  });
});
