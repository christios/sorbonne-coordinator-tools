import { describe, expect, it } from "vitest";

import {
  coursePlanDrift,
  examClasses,
  examWords,
  orderChoices,
  orderWords,
  readyReason,
  startsWithoutCm,
  withExams,
  type CoursePlan,
} from "@/services/coursePlans";
import type { Plan, PlanClass, PlanSection } from "@/services/semesterPlans";

/** A course with lectures, tutorials and practicals: a professor's feedback (26 Nov 2026). */
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
  note: "",
  answeredAt: "",
  answeredBy: "",
  answerSource: "",
};

const section = (id: string, component: string, groupLabel: string): PlanSection => ({
  id,
  crn: id,
  parentCrn: "",
  courseCode: "PHYS-101",
  title: "Mechanics",
  ue: "",
  component,
  programmes: ["L1"],
  groupLabel,
  teacherName: "",
  hours: 6,
  hoursSaid: "6",
  duration: component === "TP" ? "3" : "1.5",
  places: [],
  gone: false,
  comments: "",
  position: 0,
  updatedAt: "",
  updatedBy: "",
});

/** A class of a section in a week, on a day of that week, at a time. */
const lesson = (sectionId: string, week: number, meetsOn: string, startsAt: string, endsAt: string): PlanClass => ({
  seriesId: `${sectionId}-s`,
  sectionId,
  week,
  meetsOn,
  weekday: new Date(`${meetsOn}T00:00:00`).getDay(),
  startsAt,
  endsAt,
  room: "",
  teacherName: "",
  moved: false,
});

const planOf = (sections: PlanSection[], classes: PlanClass[]): Plan => ({
  termCode: "262720",
  semesterId: "plan:262720",
  name: "Semester 2",
  weekOne: "2027-01-11",
  weeks: 4,
  without: [],
  holidays: [],
  updatedAt: "",
  updatedBy: "",
  sections,
  series: sections.map((one) => ({
    id: `${one.id}-s`,
    sectionId: one.id,
    weekday: 1,
    startsAt: "08:00",
    endsAt: "09:30",
    room: "",
    teacherName: "",
    weeks: [1, 2, 3, 4],
    note: "",
    revision: 1,
    moves: [],
    createdAt: "",
    createdBy: "",
    updatedAt: "",
    updatedBy: "",
  })),
  classes,
  skipped: [],
});

describe("the order of a week's kinds", () => {
  it("offers a tick box only for the kinds the course has", () => {
    expect(orderChoices(COURSE)).toEqual({ cm: ["TD", "TP"], td: true });
    const noTp = { ...COURSE, components: { ...COURSE.components, TP: { hours: null, length: null } } };
    expect(orderChoices(noTp)).toEqual({ cm: ["TD"], td: false });
    const cmOnly = { ...noTp, components: { ...noTp.components, TD: { hours: null, length: null } } };
    expect(orderChoices(cmOnly)).toEqual({ cm: null, td: false });
  });

  it("says what the lead ticked, and nothing for a tick the course has no kinds for", () => {
    expect(orderWords(COURSE)).toEqual([]);
    expect(orderWords({ ...COURSE, cmFirst: true, tdBeforeTp: true })).toEqual(["CM before TD/TP", "TD before TP"]);
    const noTp = { ...COURSE, components: { ...COURSE.components, TP: { hours: null, length: null } }, tdBeforeTp: true };
    expect(orderWords(noTp)).toEqual([]);
  });

  it("warns when the first week with sessions has no CM, once the CM is laid out somewhere", () => {
    expect(startsWithoutCm(COURSE, COURSE.weeks, [1, 2, 3, 4])).toBeNull();
    const tdFirst = { ...COURSE.weeks, CM: { "2": 1, "3": 1, "4": 1 } };
    expect(startsWithoutCm(COURSE, tdFirst, [1, 2, 3, 4])).toEqual({ week: 1, kinds: ["TD"] });
    // No CM laid out yet: the lead has not got to it, so nothing is said.
    expect(startsWithoutCm(COURSE, { TD: { "1": 1 } }, [1, 2, 3, 4])).toBeNull();
  });

  it("offers the usual reason when the practicals come later", () => {
    expect(readyReason(COURSE)).toBe("CM and TD first, to prepare for the TPs");
    const noTp = { ...COURSE, components: { ...COURSE.components, TP: { hours: null, length: null } } };
    expect(readyReason(noTp)).toBe("");
  });
});

describe("exams", () => {
  it("keeps a week's exams to its sessions, and says them", () => {
    const one = withExams({}, "TD", 4, [2, 1, 2], 2);
    expect(one).toEqual({ TD: { "4": [1, 2] } });
    // A session taken away takes its exam with it; a week with none keeps no exams.
    expect(withExams(one, "TD", 4, [1, 2], 1)).toEqual({ TD: { "4": [1] } });
    expect(withExams(one, "TD", 4, [1, 2], 0)).toEqual({});
    expect(examWords({ TD: { "4": [1] }, CM: { "2": [1], "4": [1] } })).toEqual(["TD exam in week 4", "CM exams in weeks 2, 4"]);
  });

  it("tags the class at the exam's place among its week's classes, in the order they meet", () => {
    const td = section("td", "TD", "G1");
    const plan = planOf(
      [td],
      [
        lesson("td", 4, "2027-02-04", "10:00", "11:30"),
        lesson("td", 4, "2027-02-01", "10:00", "11:30"),
        lesson("td", 3, "2027-01-25", "10:00", "11:30"),
      ],
    );
    const course = { ...COURSE, weeks: { ...COURSE.weeks, TD: { ...COURSE.weeks.TD, "4": 2 } }, exams: { TD: { "4": [2] } } };
    const tagged = [...examClasses(plan, new Map([["PHYS-101", course]]))];
    expect(tagged.map((entry) => entry.meetsOn)).toEqual(["2027-02-04"]);
  });
});

describe("the Semester plan, against the order the lead asked for", () => {
  const cm = section("cm", "CM", "");
  const td = section("td", "TD", "G1");
  const tp = section("tp", "TP", "G1");
  const plan = planOf(
    [cm, td, tp],
    [
      // Week 3: the TD on Monday, before Tuesday's CM; the TP on Wednesday, after both.
      lesson("cm", 3, "2027-01-26", "08:00", "09:30"),
      lesson("td", 3, "2027-01-25", "10:00", "11:30"),
      lesson("tp", 3, "2027-01-27", "10:00", "13:00"),
      // Week 4: CM, then the TP, then the TD.
      lesson("cm", 4, "2027-02-01", "08:00", "09:30"),
      lesson("tp", 4, "2027-02-02", "10:00", "13:00"),
      lesson("td", 4, "2027-02-03", "10:00", "11:30"),
    ],
  );

  it("flags a TD placed before that week's CM, and a TP before that week's TD", () => {
    const course = { ...COURSE, cmFirst: true, tdBeforeTp: true };
    const drift = coursePlanDrift(plan, new Map([["PHYS-101", course]]));
    expect(drift.get("td")?.lines).toContain("Before that week's CM in week 3: the lead asks for the CM first");
    expect(drift.get("tp")?.lines).toContain("Before that week's TD in week 4: the lead asks for the TD first");
    expect(drift.get("cm")?.lines.some((line) => line.startsWith("Before"))).toBeFalsy();
  });

  it("flags nothing of the order when the lead ticked nothing", () => {
    const drift = coursePlanDrift(plan, new Map([["PHYS-101", COURSE]]));
    for (const id of ["cm", "td", "tp"]) expect(drift.get(id)?.lines.some((line) => line.startsWith("Before"))).toBeFalsy();
  });
});
