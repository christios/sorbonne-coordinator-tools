import { describe, expect, it } from "vitest";

import { buildCards, parentsOf } from "@/services/courseCards";
import type { CoursePlan } from "@/services/coursePlans";
import type { ActiveCrn } from "@/services/portalLists";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import type { WishTeacher, Wishes } from "@/services/teacherWishes";
import { courseOrderWords, courseWeeksWords, courseWordsOf, rowKeyOf, teacherWords, weekRows } from "@/services/timetableConstraints";
import { buildTimetableWorkbook, constraintTeachers, requestSheets } from "@/services/timetableExport";

const COLLECTION = { firstHour: 8, lastHour: 18, days: [1, 2, 3, 4, 5] };
// Semester 2: Week 1 on 25 Jan 2027, a week off on 5 Apr.
const CALENDAR = { weekOne: "2027-01-25", weeks: 14, without: ["2027-04-05"], holidays: [] };

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
const teacher = (wishes: Wishes | null): WishTeacher => ({ teacherId: "t-omar", name: "Omar El Dakkak", email: "", wishes });

describe("a teacher's answer in the workbook", () => {
  it("is every block and limit, hard before soft, in the words of the form, and never a reason", () => {
    const words = teacherWords(teacher(answer()), COLLECTION, CALENDAR)!;

    expect(words.lines).toEqual([
      { kind: "Hard constraint", when: "Mon 08:00–10:00", weeks: "Whole semester" },
      { kind: "Hard constraint", when: "Wed 14:00–16:00", weeks: "From week 5 (22 Feb)" },
      { kind: "Hard constraint", when: "Tue 2 Mar, whole day", weeks: "Week 6 only" },
      { kind: "Soft constraint", when: "Fri whole day", weeks: "Whole semester" },
      { kind: "Hard constraint", when: "At most 3 days on campus", weeks: "Whole semester" },
      { kind: "Soft constraint", when: "At most 4 hours in a row", weeks: "Whole semester" },
      { kind: "Needs", when: "PC room", weeks: "" },
      { kind: "Note", when: "Happy to teach late.", weeks: "" },
    ]);
    expect(words.time).toBe(
      "Hard: Mon 08:00–10:00 (whole semester)\nHard: Wed 14:00–16:00 (from week 5 (22 Feb))\nHard: Tue 2 Mar, whole day (week 6 only)\nSoft: Fri whole day (whole semester)",
    );
    expect(words.day).toBe("Hard: At most 3 days on campus\nSoft: At most 4 hours in a row");
    expect(words.answer).toBe("Sent 20 Nov");
    // The reasons stay in Coordinator Tools (user, 27 Nov 2026).
    expect(JSON.stringify(words)).not.toMatch(/school run|Hospital|far away/);
  });

  it("marks a draft as not sent, and says who entered an answer for a teacher", () => {
    const draft = teacherWords(teacher(answer({ status: "draft" })), COLLECTION, CALENDAR)!;
    expect(draft.answer).toBe("Draft, not sent (saved 20 Nov)");
    expect(draft.time.split("\n")[0]).toBe("(draft) Hard: Mon 08:00–10:00 (whole semester)");

    expect(teacherWords(teacher(answer({ source: "coordinator" })), COLLECTION, CALENDAR)!.answer).toBe("Entered by a coordinator, 20 Nov");
  });

  it("is nothing for no answer, and an empty answer says nothing was asked", () => {
    expect(teacherWords(teacher(null), COLLECTION, CALENDAR)).toBeNull();
    const empty = teacherWords(teacher(answer({ blocks: [], limits: {}, needs: "", note: "" })), COLLECTION, CALENDAR)!;
    expect(empty.lines).toEqual([{ kind: "Nothing asked", when: "", weeks: "" }]);
    expect(empty.time).toBe("");
  });
});

const PLAN = {
  courseCode: "MATH-233",
  components: {
    CM: { hours: 45, length: 1.5, split: "all" },
    TD: { hours: 21, length: 1.5 },
    TP: { hours: 12, length: 3 },
  },
  parts: {
    "CM:1": { hours: 30, length: 1.5, teachers: ["A"], groups: ["CM A"], crns: ["31001"] },
    "CM:2": { hours: 15, length: 1.5, teachers: ["B"], groups: ["CM A"], crns: ["31002"] },
  },
  weeks: {
    "CM:1": { "1": 2, "2": 2, "3": 1, "4": 1 },
    "CM:2": { "9": 1, "10": 1 },
    TD: { "2": 1, "3": 1, "4": 2, "8": 2 },
    TP: { "6": 1 },
  },
  lengths: { TP: { "6": [4] } },
  exams: { TD: { "8": [2] }, TP: { "6": [1] } },
  cmFirst: true,
  tdBeforeTp: false,
} as unknown as CoursePlan;

describe("a course lead's weeks in the workbook", () => {
  it("say each row's sessions the way the hand-kept file did, then other lengths and exams", () => {
    expect(courseWeeksWords(PLAN, "CM:1")).toBe("2 sessions – weeks 1–2; 1 session – weeks 3–4");
    expect(courseWeeksWords(PLAN, "TD")).toBe("1 session – weeks 2–3; 2 sessions – weeks 4, 8\nExam in week 8 (2nd session)");
    expect(courseWeeksWords(PLAN, "TP")).toBe("1 session – week 6\nSessions lasting otherwise: 4 h in week 6\nExam in week 6");
    expect(courseWeeksWords(PLAN, "CM")).toBe("");
  });

  it("follow a part's own weeks, found by its CRN", () => {
    expect(rowKeyOf(PLAN, "CM", "31002")).toBe("CM:2");
    expect(rowKeyOf(PLAN, "TD", "31002")).toBe("TD");
    expect(courseWordsOf(PLAN, "CM", "31002")?.weeks).toBe("1 session – weeks 9–10");
  });

  it("put the order a lead ticked on the rows of the kinds it concerns", () => {
    expect(courseOrderWords(PLAN, "CM")).toBe("In a week with both: CM before TD/TP");
    expect(courseOrderWords(PLAN, "TP")).toBe("In a week with both: CM before TD/TP");
    expect(courseOrderWords({ ...PLAN, cmFirst: false, tdBeforeTp: true }, "CM")).toBe("");
    expect(courseOrderWords({ ...PLAN, cmFirst: false, tdBeforeTp: true }, "TD")).toBe("In a week with both: TD before TP");
    // A language class is no CM, TD or TP: nothing to say.
    expect(courseWordsOf(PLAN, "Language", "")).toBeNull();
  });

  it("date the week numbers, a week off between them", () => {
    const weeks = [
      { week: 9, monday: "2027-03-29", holidays: [{ date: "2027-03-31", label: "Eid al-Fitr" }] },
      { week: 10, monday: "2027-04-12", holidays: [] },
    ];
    expect(weekRows(weeks)).toEqual([
      { week: "Week 9", monday: "29 Mar", note: "31 Mar Eid al-Fitr" },
      { week: "Off", monday: "5 Apr", note: "No teaching" },
      { week: "Week 10", monday: "12 Apr", note: "" },
    ]);
    // Not dated while Week 1 isn't set.
    expect(weekRows([{ week: 1, monday: "", holidays: [] }])).toEqual([]);
  });
});

const L2: CohortCatalogue = {
  cohort: { id: "c2", name: "L2-S4", term: "2026-27" },
  scopes: [
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-2", kind: "shared", parentScopeId: "", openToAll: false,
      courses: [{ id: "td-alg", code: "MATH-233", name: "Algebra 2", component: "TD", request: EMPTY_REQUEST }],
      groups: [
        { id: "td-1", label: "1", capacity: 30, note: "", parentGroupId: "", assigned: 30, crns: { "td-alg": { ...EMPTY_SECTION, crn: "31010", teacherId: "t-omar", hours: "21", sessionsPerWeek: "typed weeks", timePref: "Mornings", roomPref: "B4", comments: "Mutualized" } } },
        { id: "td-2", label: "2", capacity: 30, note: "", parentGroupId: "", assigned: 30, crns: { "td-alg": { ...EMPTY_SECTION, crn: "31011", teacherId: "t-new", hours: "21", sessionsPerWeek: "typed weeks" } } },
      ],
    },
  ],
};
const termName = () => "Semester 2 2026-27";
const nameOf = (id: string) => ({ "t-omar": "Omar El Dakkak", "t-new": "Nadia New" })[id] ?? "";
const PARENTS = parentsOf([] as ActiveCrn[], {});

describe("the timetable workbook with what teachers and leads said", () => {
  const heard = {
    teacher: (id: string) => (id === "t-omar" ? teacherWords(teacher(answer()), COLLECTION, CALENDAR) : null),
    course: (code: string, type: string, crn: string) => (code === "MATH-233" ? courseWordsOf(PLAN, type, crn) : null),
  };

  it("adds a teacher's answer after what was typed, and the lead's weeks in place of the typed ones", () => {
    const cards = buildCards([L2], termName, [], PARENTS);
    const [sheet] = requestSheets(cards, "term-2", termName(), () => "L2", nameOf, () => ({ name: "L2-S4" }), heard);

    const [omar, nadia] = sheet.rows;
    expect(omar.timePref.split("\n")).toEqual(["Mornings", "Hard: Mon 08:00–10:00 (whole semester)", "Hard: Wed 14:00–16:00 (from week 5 (22 Feb))", "Hard: Tue 2 Mar, whole day (week 6 only)", "Soft: Fri whole day (whole semester)"]);
    expect(omar.dayPref).toBe("Hard: At most 3 days on campus\nSoft: At most 4 hours in a row");
    expect(omar.roomPref).toBe("B4\nTeacher's needs: PC room");
    expect(omar.comments).toBe("Mutualized; Teacher's note: Happy to teach late.");
    expect(omar.weeks).toBe("1 session – weeks 2–3; 2 sessions – weeks 4, 8\nExam in week 8 (2nd session)");
    expect(omar.constraints).toBe("In a week with both: CM before TD/TP");
    // A teacher with no answer: their row keeps only what was typed.
    expect(nadia).toMatchObject({ timePref: "", dayPref: "", roomPref: "" });
    expect(nadia.weeks).toBe(omar.weeks);

    // Without anything heard the rows are what they always were.
    const [plain] = requestSheets(cards, "term-2", termName(), () => "L2", nameOf);
    expect(plain.rows[0]).toMatchObject({ timePref: "Mornings", roomPref: "B4", weeks: "typed weeks", constraints: "" });
  });

  it("ends with a Teacher constraints sheet, every teacher of the file on it, and the Teaching weeks", async () => {
    const cards = buildCards([L2], termName, [], PARENTS);
    const sheets = requestSheets(cards, "term-2", termName(), () => "L2", nameOf, () => ({ name: "L2-S4" }), heard);
    const teachers = constraintTeachers(sheets, heard);
    expect(teachers.map((entry) => [entry.teacher, entry.answer, entry.lines.length])).toEqual([
      ["Nadia New", "No answer yet", 0],
      ["Omar El Dakkak", "Sent 20 Nov", 8],
    ]);

    const buffer = await buildTimetableWorkbook(sheets, "2026-27", {
      teachers,
      weeks: [{ week: "Week 1", monday: "25 Jan", note: "" }],
      semester: "Semester 2 2026-27",
    });
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["L2-S4", "CRN-Table", "Teacher Hours", "Professor List", "Teacher constraints", "Teaching weeks"]);
    const constraints = book.getWorksheet("Teacher constraints")!;
    expect(constraints.getCell(1, 1).value).toBe("Teacher constraints — Semester 2 2026-27");
    expect(constraints.getRow(3).values).toEqual([undefined, "Teacher", "Kind", "When", "Weeks", "Answer"]);
    expect(constraints.getRow(4).values).toEqual([undefined, "Nadia New", undefined, undefined, undefined, "No answer yet"]);
    expect(constraints.getRow(5).values).toEqual([undefined, "Omar El Dakkak", "Hard constraint", "Mon 08:00–10:00", "Whole semester", "Sent 20 Nov"]);
    expect(book.getWorksheet("Teaching weeks")!.getRow(4).values).toEqual([undefined, "Week 1", "25 Jan"]);
    // The class row carries the answer too.
    expect(String(book.getWorksheet("L2-S4")!.getCell(5, 12).value)).toContain("Hard: Mon 08:00–10:00");
  });
});
