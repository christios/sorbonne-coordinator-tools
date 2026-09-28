import { describe, expect, it } from "vitest";

import { hoursIn, monthsOfDiff, type Meeting } from "@/services/classDiff";

const meeting = (meetsOn: string, startsAt = "08:30", endsAt = "10:00"): Meeting => ({
  meetsOn,
  startsAt,
  endsAt,
  room: "5.101",
});

describe("monthsOfDiff", () => {
  it("draws only the months the section touches, when not given the semester", () => {
    const months = monthsOfDiff([meeting("2026-09-07")], [meeting("2026-11-17")]);

    expect(months.map((month) => month.label)).toEqual(["September 2026", "November 2026"]);
  });

  it("starts each month on a Monday and pads to whole weeks", () => {
    // 1 September 2026 is a Tuesday, so Monday's square belongs to August and is empty.
    const [september] = monthsOfDiff([meeting("2026-09-07")], []);

    expect(september.days[0]).toBeNull();
    expect(september.days[1]?.dayOfMonth).toBe(1);
    expect(september.days.length % 7).toBe(0);
  });

  it("puts what is gone in the same square as what is left", () => {
    const [september] = monthsOfDiff([meeting("2026-09-07", "08:30", "10:00")], [meeting("2026-09-07", "13:30", "15:00")]);
    const seventh = september.days.find((day) => day?.dayOfMonth === 7);

    expect(seventh?.kept).toHaveLength(1);
    expect(seventh?.removed).toHaveLength(1);
  });

  it("keeps an arrival apart from the classes that were always there", () => {
    const [september] = monthsOfDiff(
      [meeting("2026-09-07")],
      [meeting("2026-09-14")],
      [meeting("2026-09-21", "13:30", "15:00")],
    );
    const twentyFirst = september.days.find((day) => day?.dayOfMonth === 21);

    expect(twentyFirst?.added).toHaveLength(1);
    expect(twentyFirst?.kept).toHaveLength(0);
    expect(september.days.find((day) => day?.dayOfMonth === 14)?.removed).toHaveLength(1);
  });

  it("lets one day both lose a class and gain one, without calling it a move", () => {
    const [september] = monthsOfDiff([], [meeting("2026-09-07", "08:30", "10:00")], [meeting("2026-09-07", "13:30", "15:00")]);
    const seventh = september.days.find((day) => day?.dayOfMonth === 7);

    expect(seventh?.removed).toHaveLength(1);
    expect(seventh?.added).toHaveLength(1);
  });

  it("says nothing about a section with no classes either way", () => {
    expect(monthsOfDiff([], [])).toEqual([]);
  });

  it("draws every month of the semester it is given, the empty ones too", () => {
    // A TD that only starts in October, read against a semester whose Week 1 starts on Monday 31 August.
    const months = monthsOfDiff([], [], [meeting("2026-10-09"), meeting("2026-11-26")], { from: "2026-08-31", to: "2026-12-10" });
    // Week 1 is mostly September's, so the semester is September to December.
    expect(months.map((month) => month.label)).toEqual(["September 2026", "October 2026", "November 2026", "December 2026"]);
    expect(months[0].days.every((day) => !day || (!day.kept.length && !day.added.length && !day.removed.length))).toBe(true);
    // The 31st sits in September's first Monday, marked as August's; nothing after the semester is drawn.
    expect(months[0].days[0]).toMatchObject({ day: "2026-08-31", outside: true });
    expect(months[3].days.filter((day) => day?.outside)).toEqual([]);
  });

  it("draws a class on the first week's Monday in the next month's first row", () => {
    const [september, ...rest] = monthsOfDiff([meeting("2026-08-31")], [meeting("2026-09-14")], [], { from: "2026-08-31", to: "2026-12-17" });
    expect(september.label).toBe("September 2026");
    expect(september.days[0]).toMatchObject({ day: "2026-08-31", outside: true, kept: [expect.objectContaining({ meetsOn: "2026-08-31" })] });
    expect(rest.map((month) => month.label)).toEqual(["October 2026", "November 2026", "December 2026"]);
  });

  it("ignores a date the registrar wrote in a way nobody can read", () => {
    expect(monthsOfDiff([], [meeting("not a date")])).toEqual([]);
  });
});

describe("hoursIn", () => {
  it("adds the classes up to the quarter hour", () => {
    expect(hoursIn([meeting("2026-09-07", "08:30", "10:00"), meeting("2026-09-08", "13:30", "15:00")])).toBe(3);
  });

  it("counts an unreadable time as nothing rather than as a guess", () => {
    expect(hoursIn([meeting("2026-09-07", "", "10:00")])).toBe(0);
  });
});
