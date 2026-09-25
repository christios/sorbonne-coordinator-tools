import { describe, expect, it } from "vitest";

import { buildSchedulePdf, hourRange, scheduleFilename, scheduleWeeks, type ScheduleInput } from "@/services/crnSchedulePdf";

const TD: ScheduleInput = {
  crn: "24059",
  courseCode: "MATH-100",
  title: "Mathematics 1",
  semester: "Semester 1 2026-27",
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
  weekOne: "2026-08-31",
};

describe("a CRN's schedule, a page per week", () => {
  it("gives every week with a class a page, in order, numbered from Week 1", () => {
    const weeks = scheduleWeeks(TD);

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
    const [second, , fourth] = scheduleWeeks(TD);

    expect(second.days).toEqual(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
    expect(fourth.days[fourth.days.length - 1]).toBe("2026-09-26");
  });

  it("leaves weeks unnumbered where the semester has no Week 1", () => {
    expect(scheduleWeeks({ ...TD, weekOne: undefined }).every((week) => week.week === null)).toBe(true);
  });

  it("shows the same hours on every page, from the earliest class to the latest", () => {
    expect(hourRange(TD)).toEqual([8, 13]);
  });

  it("is named for its course and CRN", () => {
    expect(scheduleFilename(TD)).toBe("MATH-100-24059-schedule.pdf");
  });

  it("comes out as a PDF", async () => {
    const pdf = await buildSchedulePdf(TD, new Date(2026, 8, 25));

    expect(new TextDecoder().decode(new Uint8Array(pdf).slice(0, 5))).toBe("%PDF-");
  });
});
