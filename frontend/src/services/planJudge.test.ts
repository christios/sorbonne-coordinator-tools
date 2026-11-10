import { describe, expect, it } from "vitest";

import { judgeSlot } from "@/services/planJudge";
import type { Plan, PlanClass, PlanSection } from "@/services/semesterPlans";
import type { WishTeacher } from "@/services/teacherWishes";

const SECTIONS = [
  { id: "td2", courseCode: "MATH-114", groupLabel: "TD 2", teacherId: "bilal", teacherName: "Bilal Maaz", places: [], programmes: [], component: "" },
  { id: "phys", courseCode: "PHYS-126", groupLabel: "CM", teacherId: "samar", teacherName: "Samar Ghantous", places: [], programmes: [], component: "" },
  { id: "chem", courseCode: "CHEM-101", groupLabel: "CM", teacherId: "bilal", teacherName: "Bilal Maaz", places: [], programmes: [], component: "" },
] as unknown as PlanSection[];

// Week 1 starts Monday 11 January 2027: its Tuesday is the 12th.
const tuesdayClass = (sectionId: string, startsAt: string, endsAt: string, room = ""): PlanClass => ({
  seriesId: `${sectionId}-series`,
  sectionId,
  week: 1,
  meetsOn: "2027-01-12",
  weekday: 2,
  startsAt,
  endsAt,
  room,
  teacherName: SECTIONS.find((section) => section.id === sectionId)?.teacherName ?? "",
  moved: false,
});

const plan = (classes: PlanClass[]): Plan =>
  ({ weekOne: "2027-01-11", without: [], weeks: 14, sections: SECTIONS, classes, periods: [] }) as unknown as Plan;

const bilal: WishTeacher = {
  teacherId: "bilal",
  name: "Bilal Maaz",
  email: "",
  wishes: {
    status: "submitted",
    cells: Array.from({ length: 16 }, (_, quarter) => ({ day: 2, hour: 14 + quarter / 4, kind: "cant" as const })),
    limits: {},
    away: [],
    needs: "",
    note: "",
    levels: { "cant:14-18:2": "must" },
    comments: { "cant:14-18:2": "School run" },
    lines: [],
    overCapReason: "",
    source: "coordinator",
    submittedAt: "",
    updatedAt: "",
    updatedBy: "",
  },
};

describe("what would go wrong if a class sat at a time", () => {
  it("is a clash with the same teacher's other class, and a Must broken, with why it matters", () => {
    const judged = judgeSlot(plan([tuesdayClass("chem", "15:00", "16:00")]), [bilal], {
      sectionId: "td2",
      weekday: 2,
      startsAt: "15:30",
      endsAt: "17:00",
      room: "",
      weeks: [1],
    });
    expect(judged.worst).toBe("must");
    expect(judged.problems.map((problem) => problem.said)).toEqual([
      "Same teacher as CHEM-101 · CM (15:00–16:00)",
      "Must · Bilal Maaz: Can't teach Tue 14:00–18:00 — “School run”",
    ]);
  });

  it("is nothing for a class moved within its own place, which no longer clashes with itself", () => {
    const own = tuesdayClass("td2", "09:00", "10:30", "5.111");
    const judged = judgeSlot(plan([own]), [bilal], {
      sectionId: "td2",
      weekday: 2,
      startsAt: "09:30",
      endsAt: "11:00",
      room: "5.111",
      weeks: [1],
      replacing: { seriesId: own.seriesId, weeks: [1] },
    });
    expect(judged).toEqual({ problems: [], worst: null });
  });

  it("is a room taken, for somebody else's class in the same room", () => {
    const judged = judgeSlot(plan([tuesdayClass("phys", "09:00", "10:30", "5.111")]), [], {
      sectionId: "td2",
      weekday: 2,
      startsAt: "10:00",
      endsAt: "11:30",
      room: "5.111",
      weeks: [1],
    });
    expect(judged.problems.map((problem) => problem.said)).toEqual(["Same room as PHYS-126 · CM (09:00–10:30)"]);
  });

  it("is a period's rule broken, with why, for a class inside the period", () => {
    const ramadan = { label: "Ramadan", from: "2027-01-11", to: "2027-02-10", days: [1, 2, 3, 4, 5], blockFrom: "", blockTo: "", longest: 90, dailyMax: 180 };
    const judged = judgeSlot({ ...plan([tuesdayClass("chem", "08:00", "09:30")]), periods: [ramadan] }, [], {
      sectionId: "td2",
      weekday: 2,
      startsAt: "10:00",
      endsAt: "12:00",
      room: "",
      weeks: [1],
    });
    expect(judged.worst).toBe("must");
    expect(judged.problems.map((problem) => problem.said)).toEqual([
      "Everybody · Ramadan: longest class 1h30, this one is 2h",
      "Everybody · Ramadan: at most 3h a day per teacher, Bilal Maaz has 3h30 on Tue",
    ]);
  });
});
