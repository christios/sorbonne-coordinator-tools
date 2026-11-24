import { describe, expect, it } from "vitest";

import {
  classPlanOf,
  paceOf,
  paceWords,
  unevenComponents,
  coursePlanDrift,
  hoursIn,
  hoursLaidOut,
  lengthWords,
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

describe("a week whose sessions last other than usual", () => {
  it("counts its own length in the hours, and is said by week", () => {
    expect(hoursLaidOut(PLAN, { CM: { "1": 1, "8": 1 } }, "CM", { CM: { "8": [3] } })).toBe(4.5);
    // Two sessions in a week, each its own length: a usual one and a three-hour exam.
    expect(hoursLaidOut(PLAN, { CM: { "8": 2 } }, "CM", { CM: { "8": [1.5, 3] } })).toBe(4.5);
    expect(lengthWords({ "8": [3], "12": [3], "2": [1], "10": [1.5, 3] })).toBe(
      "1 h in week 2 · 3 h in weeks 8, 12 · 1.5 h + 3 h in week 10",
    );
    // Fifteen sessions of 1.5 h, week 8's lasting 3 h: 24 h, the target.
    const answered = { ...PLAN, answeredAt: "x", weeks: { CM: weeks(1, 15), TD: weeks(1, 14) }, lengths: { CM: { "8": [3] } } };
    expect(planStanding(answered)).toEqual({ state: "answered", offTarget: [] });
    expect(planStanding({ ...answered, weeks: { ...answered.weeks, CM: weeks(1, 16) } }).offTarget).toEqual(["CM"]);
  });

  it("flags the week on the plan by its hours, not as a session of the wrong length", () => {
    const own = new Map([["MATH-002", { ...PLAN, weeks: { TD: weeks(2, 15) }, lengths: { TD: { "8": [3] } } }]]);
    const placed = planOf([series({ id: "s1", weeks: Array.from({ length: 14 }, (_, index) => index + 2) })]);
    const lines = coursePlanDrift(placed, own).get("td1")?.lines ?? [];
    expect(lines[0]).toBe("Course plan · TD in weeks 2–15, sessions of 1.5 h (3 h in week 8)");
    expect(lines).toEqual([lines[0], "Week 8: 1.5 h placed, 3 h planned"]);
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
    expect(proposedWeeks(empty, section(), { component: "TD", hours: 21, length: 1.5, weeks: weeks(2, 15), lengths: {} })).toEqual(
      Array.from({ length: 14 }, (_, index) => index + 2),
    );
    // Two a week in week 5: a second series is proposed week 5 alone.
    const twice = { component: "TD" as const, hours: 22.5, length: 1.5, weeks: { ...weeks(2, 15), "5": 2 }, lengths: {} };
    const one = planOf([series({ id: "s1", weeks: Array.from({ length: 14 }, (_, index) => index + 2) })]);
    expect(proposedWeeks(one, section(), twice)).toEqual([5]);
    // The series being changed does not count against itself.
    expect(proposedWeeks(one, section(), twice, "s1")).toHaveLength(14);
    // Nothing laid out: nothing proposed, the plan's own default stands.
    expect(proposedWeeks(empty, section(), { component: "TD", hours: 21, length: 1.5, weeks: {}, lengths: {} })).toBeNull();
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

describe("an even pace over the semester (23 Nov 2026)", () => {
  const plan = (hours: number, length = 1.5) => ({
    components: { CM: { hours, length }, TD: { hours: null, length: null }, TP: { hours: null, length: null } },
  });
  const weeksOf = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
  const layout = (byWeek: Record<string, number>) => ({ CM: byWeek });
  const run = (from: number, to: number, each: number) =>
    Object.fromEntries(weeksOf(to).filter((week) => week >= from).map((week) => [String(week), each]));

  it("never calls an even spread uneven, however few or many sessions", () => {
    for (const count of [4, 14, 15, 17]) {
      for (let sessions = 1; sessions <= 60; sessions += 1) {
        const weeks = weeksOf(count);
        const even = spreadEvenly(sessions * 1.5, 1.5, weeks);
        expect(paceOf(plan(sessions * 1.5), layout(even), {}, "CM", weeks)?.state, `${sessions} over ${count}`).toBe("even");
      }
    }
  });

  it("calls lectures bunched up front ahead, and says by how much", () => {
    // MATH-002: 60 h of 1.5 h lectures over 17 weeks, four a week from week 1 until done.
    const weeks = weeksOf(17);
    const pace = paceOf(plan(60), layout(run(1, 10, 4)), {}, "CM", weeks);
    expect(pace?.state).toBe("ahead");
    // Widest at week 10, when all 60 h are done and an even pace has done 35.3 h.
    expect(paceWords(pace!)).toBe("Too many sessions in weeks 1\u2060–\u206010");
    expect(pace?.usual).toBe("2–3 sessions a week");
    // Off pace from week 3, more than two even weeks (7.1 h) ahead, until week 15 catches up.
    expect(pace?.weeks.filter((week) => week.off).map((week) => week.week)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it("lets a course start or end a couple of weeks late or early, but not four", () => {
    const weeks = weeksOf(17);
    // TD from week 3, evenly over the fifteen weeks left: 30 sessions, two a week.
    expect(paceOf(plan(45), layout(run(3, 17, 2)), {}, "CM", weeks)?.state).toBe("even");
    // Done by week 15, two weeks early.
    expect(paceOf(plan(45), layout(run(1, 15, 2)), {}, "CM", weeks)?.state).toBe("even");
    // Done by week 13: four weeks early.
    expect(paceOf(plan(39), layout(run(1, 13, 2)), {}, "CM", weeks)?.state).toBe("ahead");
    // Nothing until week 6: behind.
    const late = paceOf(plan(36), layout(run(6, 17, 2)), {}, "CM", weeks);
    expect(late?.state).toBe("behind");
    expect(paceWords(late!)).toMatch(/^Too few sessions in weeks 1\u2060–\u2060\d+$/);
  });

  it("guides an empty row with an even pace in sessions", () => {
    expect(paceWords(paceOf(plan(60), {}, {}, "CM", weeksOf(17))!)).toBe("Aim for 2–3 sessions a week");
    expect(paceOf(plan(7.5, 1.5), {}, {}, "CM", weeksOf(17))?.usual).toBe("1 session every 3–4 weeks");
    expect(paceOf(plan(15, 1.5), {}, {}, "CM", weeksOf(14))?.usual).toBe("1 session most weeks");
    expect(paceOf(plan(42, 1.5), {}, {}, "CM", weeksOf(14))?.usual).toBe("2 sessions a week");
  });

  it("names a course's uneven components", () => {
    const course = { ...plan(6), weeks: { CM: { "1": 4 } }, lengths: {} };
    expect(unevenComponents(course, weeksOf(4))).toEqual(["CM"]);
    expect(unevenComponents({ ...course, weeks: { CM: { "1": 1, "2": 1, "3": 1, "4": 1 } } }, weeksOf(4))).toEqual([]);
  });
});

describe("a class placed on the Semester plan, from an unevenly laid-out course", () => {
  it("carries how far off an even pace its lead's weeks are, and why", () => {
    // 14 TD sessions crammed into the first seven of fourteen weeks, two a week.
    const crammed = { ...PLAN, weeks: { TD: weeks(1, 7, 2) }, paceReason: "Labs before the mid-term" };
    const byCode = new Map([["MATH-002", crammed]]);
    const placed = classPlanOf(section(), byCode, Array.from({ length: 14 }, (_, index) => index + 1));
    expect(placed?.uneven).toEqual({
      words: "Too many sessions in weeks 1\u2060–\u20607",
      reason: "Labs before the mid-term",
    });
    // Without the teaching weeks, nothing is said; spread evenly, nothing either.
    expect(classPlanOf(section(), byCode)?.uneven).toBeUndefined();
    const even = new Map([["MATH-002", { ...PLAN, weeks: { TD: weeks(1, 14, 1) } }]]);
    expect(classPlanOf(section(), even, Array.from({ length: 14 }, (_, index) => index + 1))?.uneven).toBeNull();
  });
});
