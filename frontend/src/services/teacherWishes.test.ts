import { describe, expect, it } from "vitest";

import type { Plan, PlanClass, PlanSection } from "@/services/semesterPlans";
import {
  answerLines,
  checkWishes,
  describeBlock,
  isoPlus,
  recurringConstraintHours,
  shadingFor,
  teachingWeeks,
  weekOf,
  type WishBlock,
  type WishTeacher,
  type Wishes,
} from "@/services/teacherWishes";

/** A block: every week unless told otherwise. */
const block = (id: string, kind: WishBlock["kind"], days: number[], from: number, to: number, rest: Partial<WishBlock> = {}): WishBlock => ({
  id,
  kind,
  days,
  from,
  to,
  repeat: "all",
  week: "",
  comment: "",
  ...rest,
});

describe("the lines an answer makes", () => {
  it("puts the constraints first, then the preferences, then the limits, each held as hard as its kind", () => {
    const lines = answerLines(
      [block("p", "preference", [1], 8, 12), block("c", "constraint", [2, 4], 14, 18)],
      { maxDays: 3, freeDay: 5 },
      { freeDay: "constraint" },
    );
    expect(lines.map((line) => [line.key, line.level])).toEqual([
      ["c", "must"],
      ["p", "would"],
      ["maxDays", "would"],
      ["freeDay", "must"],
    ]);
  });

  it("says a block in words, a week's own by its dates", () => {
    expect(describeBlock(block("c", "constraint", [2, 4], 14, 18))).toBe("Constraint · Tue, Thu 14:00–18:00 · every week");
    expect(describeBlock(block("c", "preference", [1], 8, 10, { repeat: "from", week: "2027-02-01" }))).toBe("Preference · Mon 08:00–10:00 · every week from 1 Feb");
    expect(describeBlock(block("d", "constraint", [5], 8, 19, { repeat: "once", week: "2027-01-18" }), { firstHour: 8, lastHour: 19 })).toBe(
      "Constraint · Fri 22 Jan, all day",
    );
    // Three days or more in a row read as a stretch; days apart, one by one.
    expect(describeBlock(block("w", "constraint", [1, 2, 3, 4, 5], 8, 19, { repeat: "once", week: "2027-01-18" }), { firstHour: 8, lastHour: 19 })).toBe(
      "Constraint · Mon 18 Jan–Fri 22 Jan, all day",
    );
    expect(describeBlock(block("t", "constraint", [2, 4], 8, 10, { repeat: "once", week: "2027-01-18" }))).toBe("Constraint · Tue 19 Jan, Thu 21 Jan, 08:00–10:00");
  });
});

describe("a week, as its blocks make it", () => {
  const usual = block("usual", "constraint", [2], 14, 18);
  const later = block("later", "preference", [2], 16, 18, { repeat: "from", week: "2027-02-01" });
  const once = block("once", "constraint", [2], 8, 19, { repeat: "once", week: "2027-02-08" });

  it("shows a one-week block over one from a week on, over one every week", () => {
    const blocks = [once, later, usual];
    expect(weekOf(blocks, "2027-01-25").get("2:16")?.id).toBe("usual");
    expect(weekOf(blocks, "2027-02-01").get("2:16")?.id).toBe("later");
    expect(weekOf(blocks, "2027-02-01").get("2:14")?.id).toBe("usual");
    expect(weekOf(blocks, "2027-02-08").get("2:16")?.id).toBe("once");
    expect(weekOf(blocks, "2027-02-15").get("2:16")?.id).toBe("later");
  });

  it("shades a week a day at a time, block by block", () => {
    const shaded = shadingFor({ blocks: [usual, later] }, "2027-02-01");
    expect(shaded[2].map((stretch) => [stretch.from, stretch.to, stretch.kind])).toEqual([
      ["14:00", "16:00", "constraint"],
      ["16:00", "18:00", "preference"],
    ]);
  });

  it("counts the hours of repeating constraints once each, and not a week's own", () => {
    expect(recurringConstraintHours([usual, block("again", "constraint", [2], 16, 19), once])).toBe(5);
  });
});

const SECTIONS: PlanSection[] = [
  { id: "td2", courseCode: "MATH-114", groupLabel: "TD 2", teacherId: "bilal", teacherName: "Bilal Maaz" },
  { id: "td1", courseCode: "MATH-114", groupLabel: "TD 1", teacherId: "bilal", teacherName: "Bilal Maaz" },
  { id: "cm", courseCode: "MATH-114", groupLabel: "CM", teacherId: "bilal", teacherName: "Bilal Maaz" },
  { id: "phys", courseCode: "PHYS-126", groupLabel: "CM", teacherId: "samar", teacherName: "Samar Ghantous" },
] as PlanSection[];

const at = (sectionId: string, weekday: number, startsAt: string, endsAt: string, week = 1): PlanClass =>
  ({
    sectionId,
    weekday,
    startsAt,
    endsAt,
    week,
    meetsOn: isoPlus("2027-01-25", weekday - 1 + (week - 1) * 7),
    seriesId: `${sectionId}-${weekday}`,
    room: "",
    teacherName: "",
    moved: false,
  }) as PlanClass;

const answered = (teacherId: string, name: string, wishes: Partial<Wishes>): WishTeacher => ({
  teacherId,
  name,
  email: "",
  wishes: {
    status: "submitted",
    blocks: [],
    limits: {},
    limitKinds: {},
    comments: {},
    needs: "",
    note: "",
    lines: [],
    overCapReason: "",
    source: "coordinator",
    submittedAt: "",
    updatedAt: "",
    updatedBy: "",
    ...wishes,
  },
});

describe("a plan read against the teachers' wishes", () => {
  it("says why a broken constraint matters, in the teacher's words, on the class's flag", () => {
    const tuesday = at("td2", 2, "15:00", "17:00");
    const plan = { sections: SECTIONS, classes: [tuesday], periods: [] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { blocks: [block("run", "constraint", [2], 14, 18, { comment: "School run" })] })]);
    expect(check.breaches[0].comment).toBe("School run");
    expect(check.flags.get(tuesday)?.said).toEqual(["Constraint · Bilal Maaz: Tue 14:00–18:00 · every week — “School run”"]);
  });

  it("flags a class in a teacher's constraint red", () => {
    const tuesday = at("td2", 2, "15:00", "17:00");
    const plan = { sections: SECTIONS, classes: [tuesday], periods: [] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { blocks: [block("run", "constraint", [2], 14, 18)] })]);

    expect(check.breaches.map((breach) => [breach.teacherName, breach.level, breach.wish, breach.how])).toEqual([
      ["Bilal Maaz", "must", "Constraint · Tue 14:00–18:00 · every week", "MATH-114 TD 2, Tue 15:00"],
    ]);
    expect(check.flags.get(tuesday)?.level).toBe("must");
    expect(check.tallies[0]).toMatchObject({ teacherName: "Bilal Maaz", musts: 1, mustsKept: 0 });
  });

  it("flags every class on the extra days of a week over a teacher's days on campus", () => {
    const monday = at("cm", 1, "08:00", "10:00");
    const tuesday = at("td2", 2, "08:00", "09:30");
    const wednesday = at("td1", 3, "10:00", "12:00");
    const plan = { sections: SECTIONS, classes: [monday, tuesday, wednesday] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { limits: { maxDays: 2 } })]);

    const [breach] = check.breaches;
    // A limit is a preference unless made a constraint.
    expect([breach.level, breach.wish, breach.how]).toEqual(["would", "At most 2 days on campus", "3 days: Mon, Tue, Wed"]);
    // Tuesday has least teaching, so it is the day to clear.
    expect(breach.classes).toEqual([tuesday]);
    expect(check.flags.get(tuesday)?.level).toBe("would");
    expect(check.flags.has(monday)).toBe(false);
    const firm = checkWishes(plan, [answered("bilal", "Bilal Maaz", { limits: { maxDays: 2 }, limitKinds: { maxDays: "constraint" } })]);
    expect(firm.breaches[0].level).toBe("must");
  });

  it("flags a stretch of teaching longer than a teacher's most hours in a row, and not one with a break", () => {
    const first = at("cm", 1, "08:00", "10:00");
    const second = at("td1", 1, "10:00", "12:00");
    const later = at("td2", 1, "14:00", "16:00");
    const plan = { sections: SECTIONS, classes: [first, second, later] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { limits: { maxInRow: 3 } })]);

    expect(check.breaches.map((breach) => breach.how)).toEqual(["4 h in a row on Mon"]);
    expect(check.breaches[0].classes).toEqual([first, second]);
  });

  it("counts a class outside a teacher's preferences against them, amber, as one line", () => {
    const morning = at("cm", 1, "08:00", "10:00");
    const afternoon = at("td1", 3, "14:00", "16:00");
    const plan = { sections: SECTIONS, classes: [morning, afternoon] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { blocks: [block("mornings", "preference", [1, 3], 8, 12)] })]);

    expect(check.breaches.map((breach) => [breach.level, breach.wish, breach.classes])).toEqual([["would", "Outside their preferences", [afternoon]]]);
    expect(check.tallies[0]).toMatchObject({ musts: 0, woulds: 1, wouldsKept: 0 });
  });

  it("holds a one-week constraint only in its week, and one from a week on from then", () => {
    const first = at("cm", 2, "08:00", "10:00", 1);
    const second = at("cm", 2, "08:00", "10:00", 2);
    const third = at("cm", 2, "08:00", "10:00", 3);
    const plan = { sections: SECTIONS, classes: [first, second, third] } as unknown as Plan;
    const away = block("conf", "constraint", [2], 8, 19, { repeat: "once", week: "2027-02-01", comment: "Conference" });
    const later = block("later", "constraint", [2], 8, 9, { repeat: "from", week: "2027-02-08" });
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { blocks: [away, later] })]);

    expect(check.flags.has(first)).toBe(false);
    expect(check.flags.get(second)?.said).toEqual(["Constraint · Bilal Maaz: Tue 2 Feb, 08:00–19:00 — “Conference”"]);
    expect(check.flags.get(third)?.level).toBe("must");
  });

  it("names the teachers with classes who have not answered", () => {
    const plan = { sections: SECTIONS, classes: [at("phys", 4, "10:00", "12:00")] } as unknown as Plan;
    expect(checkWishes(plan, [{ teacherId: "samar", name: "Samar Ghantous", email: "", wishes: null }]).unanswered).toEqual([
      "Samar Ghantous",
    ]);
  });

  it("flags a class inside a period binding everybody, whoever teaches it and whether they answered", () => {
    const late = at("phys", 2, "16:00", "17:30");
    const early = at("cm", 2, "09:00", "10:30");
    const plan = {
      sections: SECTIONS,
      classes: [late, early],
      periods: [{ label: "Ramadan", from: "2027-01-25", to: "2027-02-20", days: [1, 2, 3, 4, 5], blockFrom: "15:00", blockTo: "19:00" }],
    } as unknown as Plan;
    const check = checkWishes(plan, []);

    expect(check.breaches.map((breach) => [breach.about, breach.teacherName, breach.level, breach.classes])).toEqual([
      ["period", "Ramadan", "must", [late]],
    ]);
    expect(check.flags.get(late)?.said).toEqual(["Everybody · Ramadan: no classes 15:00–19:00, this one is 16:00–17:30"]);
  });

  it("checks each of a period's rules only for the classes inside it, and says why each class breaks one", () => {
    const ramadan = {
      label: "Ramadan", from: "2027-01-25", to: "2027-02-20", days: [1, 2, 3, 4, 5],
      endsBy: "15:00", longest: 90, blockFrom: "12:15", blockTo: "12:45", dailyMax: 240,
    };
    const late = at("phys", 2, "14:00", "15:30");
    const long = at("phys", 3, "08:00", "11:00");
    const prayer = at("phys", 4, "11:30", "13:00");
    // Bilal on Monday: three classes of 1h30, none too long, but 4h30 over the four a day.
    const monday = [at("cm", 1, "08:00", "09:30"), at("td1", 1, "10:15", "11:45"), at("td2", 1, "13:00", "14:30")];
    // After the period: none of it applies.
    const after = { ...at("phys", 2, "16:00", "19:00"), meetsOn: "2027-02-23", week: 5 };
    const check = checkWishes({ sections: SECTIONS, classes: [late, long, prayer, ...monday, after], periods: [ramadan] } as unknown as Plan, []);

    expect(check.flags.get(late)?.said).toEqual(["Everybody · Ramadan: classes end by 15:00, this one ends 15:30"]);
    expect(check.flags.get(long)?.said).toEqual(["Everybody · Ramadan: longest class 1h30, this one is 3h"]);
    expect(check.flags.get(prayer)?.said).toEqual(["Everybody · Ramadan: no classes 12:15–12:45, this one is 11:30–13:00"]);
    for (const entry of monday) {
      expect(check.flags.get(entry)?.said).toEqual(["Everybody · Ramadan: at most 4h a day per teacher, Bilal Maaz has 4h30 on Mon"]);
    }
    expect(check.flags.get(after)).toBeUndefined();
    expect(new Set(check.breaches.map((breach) => breach.wish))).toEqual(
      new Set([
        "Ramadan: classes end by 15:00",
        "Ramadan: longest class 1h30",
        "Ramadan: no classes 12:15–12:45",
        "Ramadan: at most 4h a day per teacher",
      ]),
    );
  });
});

describe("the semester's weeks", () => {
  it("numbers the teaching weeks, a break taking no number", () => {
    expect(teachingWeeks({ weekOne: "2027-01-13", weeks: 3, without: ["2027-01-18"], holidays: [] })).toEqual([
      { number: 1, monday: "2027-01-11" },
      { number: 2, monday: "2027-01-25" },
      { number: 3, monday: "2027-02-01" },
    ]);
    expect(teachingWeeks(null)).toEqual([]);
  });
});
