import { describe, expect, it } from "vitest";

import {
  buildSchedulePdf,
  hourRange,
  scheduleFilename,
  scheduleWeeks,
  type ScheduleInput,
  type ScheduleSection,
} from "@/services/crnSchedulePdf";

const TD: ScheduleSection = {
  crn: "24059",
  courseCode: "MATH-100",
  title: "Mathematics 1",
  teacher: "Amina Menaa",
  // Out of order on purpose: the pages read in date order whatever the sweep's order was.
  meetings: [
    { meetsOn: "2026-09-17", startsAt: "08:15", endsAt: "10:15", room: "5.105/.107" },
    { meetsOn: "2026-09-16", startsAt: "10:30", endsAt: "12:30", room: "5.105/.107" },
    { meetsOn: "2026-09-10", startsAt: "08:15", endsAt: "10:15", room: "5.010/.012" },
    { meetsOn: "2026-09-26", startsAt: "09:00", endsAt: "11:00", room: "5.111" },
  ],
  notes: [
    { meetsOn: "2026-09-16", startsAt: "10:30", kind: "covered", coverTeacherName: "Omar ElDakkak", note: "" },
    { meetsOn: "2026-09-17", startsAt: "08:15", kind: "cancelled", coverTeacherName: "", note: "Public holiday" },
  ],
};

const ONE: ScheduleInput = { semester: "Semester 1 2026-27", sections: [TD], weekOne: "2026-08-31" };

/** A lecture that shares Thursday 17 September's first hour with the tutorial. */
const CM: ScheduleSection = {
  crn: "23436",
  courseCode: "MATH-351",
  title: "Algebra & Cryptography",
  teacher: "Grace Younes",
  meetings: [
    { meetsOn: "2026-09-17", startsAt: "09:00", endsAt: "11:00", room: "5.111" },
    { meetsOn: "2026-09-18", startsAt: "13:30", endsAt: "15:30", room: "5.111" },
  ],
  notes: [],
};

describe("a CRN's schedule, a page per week", () => {
  it("gives every week with a class a page, in order, numbered from Week 1", () => {
    const weeks = scheduleWeeks(ONE);

    expect(weeks.map((week) => [week.monday, week.week])).toEqual([
      ["2026-09-07", 2],
      ["2026-09-14", 3],
      ["2026-09-21", 4],
    ]);
    // Week 3's two classes, in order, each with what happened to it.
    expect(weeks[1].classes.map((entry) => [entry.day, entry.state, entry.cover, entry.note])).toEqual([
      ["2026-09-16", "covered", "Omar ElDakkak", ""],
      ["2026-09-17", "cancelled", "", "Public holiday"],
    ]);
  });

  it("runs Monday to Friday, and to Saturday only in a week that uses it", () => {
    const [second, , fourth] = scheduleWeeks(ONE);

    expect(second.days).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(fourth.days[fourth.days.length - 1]).toBe("2026-09-26");
  });

  it("leaves weeks unnumbered where the semester has no Week 1", () => {
    expect(scheduleWeeks({ ...ONE, weekOne: undefined }).every((week) => week.week === null)).toBe(true);
  });

  it("shows the same hours on every page, from the earliest class to the latest", () => {
    expect(hourRange(ONE)).toEqual([8, 13]);
  });

  it("is named for its course and CRN", () => {
    expect(scheduleFilename(ONE)).toBe("MATH-100-24059-schedule.pdf");
  });

  it("comes out as a PDF", async () => {
    const pdf = await buildSchedulePdf(ONE, new Date(2026, 8, 25));

    expect(new TextDecoder().decode(new Uint8Array(pdf).slice(0, 5))).toBe("%PDF-");
  });
});

describe("several CRNs on one grid", () => {
  const BOTH: ScheduleInput = { semester: "Semester 1 2026-27", sections: [TD, CM], weekOne: "2026-08-31" };

  it("puts every CRN's classes on the same week's page", () => {
    const week = scheduleWeeks(BOTH).find((entry) => entry.monday === "2026-09-14")!;

    expect(week.classes.map((entry) => `${entry.day} ${entry.startsAt} ${entry.crn}`)).toEqual([
      "2026-09-16 10:30 24059",
      "2026-09-17 08:15 24059",
      "2026-09-17 09:00 23436",
      "2026-09-18 13:30 23436",
    ]);
  });

  it("sets two classes of the same hour side by side, and a class alone across its whole day", () => {
    const week = scheduleWeeks(BOTH).find((entry) => entry.monday === "2026-09-14")!;
    const place = (crn: string, day: string) => {
      const entry = week.classes.find((held) => held.crn === crn && held.day === day)!;
      return [entry.lane, entry.lanes];
    };

    expect(place("24059", "2026-09-17")).toEqual([0, 2]);
    expect(place("23436", "2026-09-17")).toEqual([1, 2]);
    expect(place("23436", "2026-09-18")).toEqual([0, 1]);
  });

  it("is named for how many CRNs it holds, and still comes out as a PDF", async () => {
    expect(scheduleFilename(BOTH)).toBe("schedule-2-CRNs.pdf");
    const pdf = await buildSchedulePdf(BOTH, new Date(2026, 8, 25));
    expect(new TextDecoder().decode(new Uint8Array(pdf).slice(0, 5))).toBe("%PDF-");
  });
});
