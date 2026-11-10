import { describe, expect, it } from "vitest";

import type { Plan, PlanClass, PlanSection } from "@/services/semesterPlans";
import { carryOver, checkWishes, lineOfCell, shadingOf, wishLines, type WishCell, type WishTeacher, type Wishes } from "@/services/teacherWishes";

const cant = (day: number, from: number, to: number): WishCell[] =>
  Array.from({ length: to - from }, (_, index) => ({ day, hour: from + index, kind: "cant" as const }));

describe("the wishes an answer makes", () => {
  it("joins can't hours into blocks, and the same block on several days is one wish, as the server does", () => {
    const cells = [...cant(2, 14, 18), ...cant(4, 14, 18), ...cant(5, 8, 10), { day: 1, hour: 8, kind: "prefer" as const }];
    expect(wishLines(cells, { maxDays: 2, freeDay: 5 }).map((line) => line.key)).toEqual([
      "cant:14-18:2,4",
      "cant:8-10:5",
      "prefer",
      "maxDays",
      "freeDay",
    ]);
  });

  it("shades a teacher's week as stretches a day at a time", () => {
    expect(shadingOf({ cells: [...cant(2, 14, 16), { day: 2, hour: 9, kind: "prefer" }] })).toEqual({
      2: [
        { from: "09:00", to: "10:00", kind: "prefer" },
        { from: "14:00", to: "16:00", kind: "cant" },
      ],
    });
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
    meetsOn: `2027-01-${String(24 + weekday + (week - 1) * 7).padStart(2, "0")}`,
    seriesId: `${sectionId}-${weekday}`,
    room: "",
    teacherName: "",
    moved: false,
  }) as PlanClass;

const answered = (teacherId: string, name: string, wishes: Partial<Wishes>): WishTeacher => ({
  teacherId,
  name,
  email: "",
  wishes: { status: "submitted", cells: [], limits: {}, away: [], needs: "", note: "", levels: {}, comments: {}, lines: [], overCapReason: "", source: "coordinator", submittedAt: "", updatedAt: "", updatedBy: "", ...wishes },
});

describe("a painted hour and the wish it is part of", () => {
  const lines = wishLines([...cant(2, 14, 18), ...cant(4, 14, 18), { day: 1, hour: 9, kind: "prefer" }], {});

  it("finds the block an hour belongs to, on any of its days, or the preferred hours", () => {
    expect(lineOfCell(lines, 4, 16, "cant")?.key).toBe("cant:14-18:2,4");
    expect(lineOfCell(lines, 1, 9, "prefer")?.key).toBe("prefer");
    expect(lineOfCell(lines, 3, 16, undefined)).toBeNull();
  });

  it("keeps a block's Must and comment when it is painted longer, and gives a split Must to one half only", () => {
    const before = wishLines(cant(2, 14, 18), {});
    const longer = wishLines(cant(2, 14, 19), {});
    expect(carryOver(before, longer, { "cant:14-18:2": "must" }, { "cant:14-18:2": "School run" })).toEqual({
      levels: { "cant:14-19:2": "must" },
      comments: { "cant:14-19:2": "School run" },
    });
    const split = wishLines([...cant(2, 14, 15), ...cant(2, 16, 18)], {});
    expect(carryOver(before, split, { "cant:14-18:2": "must" }, {}).levels).toEqual({ "cant:14-15:2": "must", "cant:16-18:2": "would" });
  });
});

describe("a plan read against the teachers' wishes", () => {
  it("says why a broken wish matters, in the teacher's words, on the class's flag", () => {
    const tuesday = at("td2", 2, "15:00", "17:00");
    const plan = { sections: SECTIONS, classes: [tuesday], periods: [] } as unknown as Plan;
    const check = checkWishes(plan, [
      answered("bilal", "Bilal Maaz", { cells: cant(2, 14, 18), levels: { "cant:14-18:2": "must" }, comments: { "cant:14-18:2": "School run" } }),
    ]);
    expect(check.breaches[0].comment).toBe("School run");
    expect(check.flags.get(tuesday)?.said).toEqual(["Must · Bilal Maaz: Can't teach Tue 14:00–18:00 — “School run”"]);
  });

  it("flags a class in a teacher's can't-teach hours red when it is a Must", () => {
    const tuesday = at("td2", 2, "15:00", "17:00");
    const plan = { sections: SECTIONS, classes: [tuesday], periods: [] } as unknown as Plan;
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { cells: cant(2, 14, 18), levels: { "cant:14-18:2": "must" } })]);

    expect(check.breaches.map((breach) => [breach.teacherName, breach.level, breach.wish, breach.how])).toEqual([
      ["Bilal Maaz", "must", "Can't teach Tue 14:00–18:00", "MATH-114 TD 2, Tue 15:00"],
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
    expect([breach.level, breach.wish, breach.how]).toEqual(["would", "At most 2 days on campus", "3 days: Mon, Tue, Wed"]);
    // Tuesday has least teaching, so it is the day to clear.
    expect(breach.classes).toEqual([tuesday]);
    expect(check.flags.get(tuesday)?.level).toBe("would");
    expect(check.flags.has(monday)).toBe(false);
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

  it("counts a class outside a teacher's preferred hours against their preference", () => {
    const morning = at("cm", 1, "08:00", "10:00");
    const afternoon = at("td1", 3, "14:00", "16:00");
    const plan = { sections: SECTIONS, classes: [morning, afternoon] } as unknown as Plan;
    const prefer: WishCell[] = [1, 3].flatMap((day) => [8, 9, 10, 11].map((hour) => ({ day, hour, kind: "prefer" as const })));
    const check = checkWishes(plan, [answered("bilal", "Bilal Maaz", { cells: prefer })]);

    expect(check.breaches.map((breach) => [breach.wish, breach.classes])).toEqual([["Their preferred hours", [afternoon]]]);
  });

  it("flags a class in a teacher's dates away as a Must, dates away being facts", () => {
    const away = at("cm", 2, "08:00", "10:00");
    const plan = { sections: SECTIONS, classes: [away] } as unknown as Plan;
    const check = checkWishes(plan, [
      answered("bilal", "Bilal Maaz", { away: [{ from: "2027-01-25", to: "2027-01-29", reason: "Conference" }] }),
    ]);

    expect(check.breaches[0].level).toBe("must");
    expect(check.breaches[0].wish).toMatch(/^Away .*\(Conference\)$/);
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
