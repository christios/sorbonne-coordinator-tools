import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildCards, parentsOf } from "@/services/courseCards";
import type { CoursePlan, CoursePlanSemester } from "@/services/coursePlans";
import type { ActiveCrn } from "@/services/portalLists";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import type { WishSemester, Wishes } from "@/services/teacherWishes";
import { briefOf, buildBriefPdf, printable } from "@/services/timetableBrief";
import { requestSheets } from "@/services/timetableExport";

const answer = (over: Partial<Wishes> = {}): Wishes => ({
  status: "submitted",
  blocks: [
    { id: "b1", kind: "constraint", days: [1], from: 8, to: 10, repeat: "all", week: "", comment: "My child's school run" },
    { id: "b2", kind: "preference", days: [5], from: 8, to: 18, repeat: "all", week: "", comment: "" },
    { id: "b3", kind: "constraint", days: [3], from: 14, to: 16, repeat: "from", week: "2027-02-22", comment: "Hospital" },
    { id: "b4", kind: "constraint", days: [2], from: 8, to: 18, repeat: "once", week: "2027-03-01", comment: "" },
  ],
  limits: { maxDays: 3, maxInRow: 4 },
  limitKinds: { maxDays: "constraint" },
  comments: { maxDays: "I live far away" },
  needs: "PC room",
  note: "Happy to teach late.",
  lines: [],
  overCapReason: "",
  source: "invitation",
  submittedAt: "2026-11-20T09:00:00Z",
  updatedAt: "2026-11-20T09:00:00Z",
  updatedBy: "",
  ...over,
});

const WISHES: WishSemester = {
  collection: { termCode: "262720", deadline: "", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 18, mustQuota: 0, cantCap: 12, openedAt: "", openedBy: "" },
  calendar: { weekOne: "2027-01-25", weeks: 14, without: ["2027-04-05"], holidays: [] },
  teachers: [
    { teacherId: "t-omar", name: "Omar El Dakkak", email: "", wishes: answer() },
    { teacherId: "t-new", name: "Nadia New", email: "", wishes: null },
  ],
};

const PLAN = {
  courseCode: "MATH-233",
  leadName: "Omar El Dakkak",
  components: {
    CM: { hours: 45, length: 1.5, split: "all" },
    TD: { hours: 21, length: 1.5 },
    TP: { hours: null, length: null },
  },
  parts: {
    "CM:1": { hours: 30, length: 1.5, teachers: ["Omar El Dakkak"], groups: ["CM A"], crns: ["31001"] },
    "CM:2": { hours: 15, length: 1.5, teachers: ["Nadia New"], groups: ["CM A"], crns: ["31002"] },
  },
  weeks: {
    "CM:1": { "1": 2, "2": 2, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 1, "9": 1, "10": 1 },
    "CM:2": { "11": 2, "12": 2, "13": 2, "14": 2, "10": 1 },
    TD: { "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 2, "9": 1, "10": 1, "11": 1, "12": 1, "13": 1, "14": 1 },
  },
  lengths: { TD: { "8": [1.5, 3] } },
  exams: { TD: { "8": [2] } },
  cmFirst: true,
  tdBeforeTp: false,
} as unknown as CoursePlan;

const mondays = ["2027-01-25", "2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22", "2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22", "2027-03-29", "2027-04-12", "2027-04-19", "2027-04-26", "2027-05-03"];
const PLANS: CoursePlanSemester = {
  termCode: "262720",
  weeks: mondays.map((monday, index) => ({ week: index + 1, monday, holidays: index === 9 ? [{ date: "2027-03-31", label: "Eid al-Fitr" }] : [] })),
  courses: [PLAN],
};

const L2: CohortCatalogue = {
  cohort: { id: "c2", name: "L2-S4", term: "2026-27" },
  scopes: [
    {
      id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-2", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "cm-alg", code: "MATH-233", name: "Algebra 2", component: "CM", request: EMPTY_REQUEST }],
      groups: [
        { id: "cm-a", label: "A", capacity: 60, note: "", parentGroupId: "", assigned: 55, crns: { "cm-alg": { ...EMPTY_SECTION, crn: "31001", teacherId: "t-omar", hours: "30", duration: "1.5", comments: "Mutualized with Physics" } } },
      ],
    },
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-2", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "td-alg", code: "MATH-233", name: "Algebra 2", component: "TD", request: EMPTY_REQUEST }],
      groups: [
        { id: "td-1", label: "1", capacity: 30, note: "", parentGroupId: "", assigned: 28, crns: { "td-alg": { ...EMPTY_SECTION, crn: "31010", teacherId: "t-omar", hours: "21", duration: "1.5", roomPref: "B4", constraints: "In parallel with TD 2" } } },
        { id: "td-2", label: "2", capacity: 30, note: "", parentGroupId: "", assigned: 27, crns: { "td-alg": { ...EMPTY_SECTION, crn: "31011", teacherId: "t-new", hours: "21", duration: "Classroom" } } },
        { id: "td-3", label: "3", capacity: 30, note: "", parentGroupId: "", assigned: 0, crns: { "td-alg": { ...EMPTY_SECTION, crn: "31012", teacher: "TBD", retired: true } } },
      ],
    },
    {
      id: "s-ph", code: "TD", name: "Physics tutorials", note: "", termId: "term-2", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "ph", code: "PHYS-222", name: "Waves and Optics", component: "TD", request: EMPTY_REQUEST }],
      groups: [
        { id: "ph-1", label: "1", capacity: 30, note: "", parentGroupId: "", assigned: 22, crns: { ph: { ...EMPTY_SECTION, crn: "", teacher: "", hours: "18", duration: "2", sessionsPerWeek: "1 session - weeks 2 to 10" } } },
      ],
    },
  ],
};

const termName = () => "Semester 2 2026-27";
const nameOf = (id: string) => ({ "t-omar": "Omar El Dakkak", "t-new": "Nadia New" })[id] ?? "";
const sheets = () =>
  requestSheets(buildCards([L2], termName, [], parentsOf([] as ActiveCrn[], {})), "term-2", termName(), () => "L2", nameOf, () => ({ name: "L2-S4" }));
const brief = () => briefOf({ sheets: sheets(), semester: "Semester 2 2026-27", scope: "L2-S4", wishes: WISHES, plans: PLANS, made: new Date("2026-11-27T08:00:00Z") });

describe("the timetabling brief", () => {
  it("groups each cohort's classes by course, without the retired ones, with what was typed beside each", () => {
    const [cohort] = brief().cohorts;
    expect(cohort.name).toBe("L2-S4");
    expect(cohort.courses.map((course) => [course.code, course.title, course.lead])).toEqual([
      ["MATH-233", "Algebra 2", "Omar El Dakkak"],
      ["PHYS-222", "Waves and Optics", ""],
    ]);
    const [algebra] = cohort.courses;
    expect(algebra.classes.map((entry) => [entry.label, entry.crn, entry.teacher])).toEqual([
      ["CM A", "31001", "Omar El Dakkak"],
      ["TD 1", "31010", "Omar El Dakkak"],
      ["TD 2", "31011", "Nadia New"],
    ]);
    expect(algebra.classes[1].notes).toBe("Room: B4 · In parallel with TD 2");
    // A row with no length of its own takes its course's, for its component.
    expect(brief().cohorts[0].courses[0].classes.map((entry) => entry.length)).toEqual(["1.5", "1.5", "1.5"]);
  });

  it("draws the lead's weeks row by row, with the exams, the order and the sessions lasting otherwise", () => {
    const [algebra, waves] = brief().cohorts[0].courses;
    expect(algebra.strip.map((row) => [row.label, row.hours])).toEqual([
      ["CM part 1", "30 h"],
      ["CM part 2", "15 h"],
      ["TD", "21 h a group"],
    ]);
    expect(algebra.strip[2].cells["8"]).toEqual({ count: 2, exams: 1, own: true });
    expect(algebra.lines).toEqual(["TD exam in week 8", "In a week with both: CM before TD", "Sessions lasting otherwise — TD: 1.5 h + 3 h in week 8"]);
    // Not laid out: what Groups & CRNs says, as typed.
    expect(waves.strip).toEqual([]);
    expect(waves.lines).toEqual(["Weeks as typed on Groups & CRNs: 1 session - weeks 2 to 10"]);
  });

  it("lists every teacher of the classes, their answer without its reasons, and the blocks to draw", () => {
    const { teachers, weeks } = brief();
    expect(teachers.map((teacher) => [teacher.name, teacher.answer, teacher.classes])).toEqual([
      ["Nadia New", "No answer yet", ["MATH-233 TD 2 (31011)"]],
      ["Omar El Dakkak", "Sent 20 Nov", ["MATH-233 CM A (31001)", "MATH-233 TD 1 (31010)"]],
    ]);
    const omar = teachers[1];
    // The week's own block is listed, not drawn; the later one is drawn last, from week 5.
    expect(omar.blocks.map((block) => [block.hard, block.days, block.fromWeek])).toEqual([
      [true, [1], null],
      [false, [5], null],
      [true, [3], 5],
    ]);
    expect(JSON.stringify(omar)).not.toMatch(/school run|Hospital|far away/);
    // The weeks: week 10, then a week off, then week 11.
    expect(weeks.slice(9, 12)).toEqual([
      { number: 10, monday: "2027-03-29", holidays: ["31 Mar Eid al-Fitr"] },
      { off: "2027-04-05" },
      { number: 11, monday: "2027-04-12", holidays: [] },
    ]);
  });

  it("says what it could not read", () => {
    const without = briefOf({ sheets: sheets(), semester: "S2", scope: "L2-S4", wishes: null, plans: null });
    expect(without.missing).toEqual(["teachers' answers", "course leads' weeks"]);
    expect(without.teachers.every((teacher) => teacher.answer === "No answer yet")).toBe(true);
  });

  it("is a PDF of the courses then the teachers, in words the font can set", async () => {
    const pdf = await buildBriefPdf(brief());
    const printed = new TextDecoder("latin1").decode(new Uint8Array(pdf));
    expect(printed.startsWith("%PDF")).toBe(true);
    for (const said of ["Timetabling brief", "1 · Courses", "2 · Teachers", "MATH-233 · Algebra 2", "Omar El Dakkak", "No answer yet"]) {
      expect(printed).toContain(printable(said).replace("·", "·"));
    }
    expect(printed).not.toMatch(/school run|Hospital|far away/);
    if (process.env.BRIEF_OUT) writeFileSync(process.env.BRIEF_OUT, new Uint8Array(pdf));
  });

  it("writes characters outside the font as a question mark", () => {
    expect(printable("Café — 08:00–10:00 · ok")).toBe("Café — 08:00–10:00 · ok");
    expect(printable("محمد 😀 → x")).toBe("???? ? -> x");
  });
});
