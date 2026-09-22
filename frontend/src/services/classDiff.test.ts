import { describe, expect, it } from "vitest";

import { hoursIn, monthsOfDiff, type Meeting } from "@/services/classDiff";

const meeting = (meetsOn: string, startsAt = "08:30", endsAt = "10:00"): Meeting => ({
  meetsOn,
  startsAt,
  endsAt,
  room: "5.101",
});

describe("monthsOfDiff", () => {
  it("draws only the months the section touches", () => {
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

  it("says nothing about a section with no classes either way", () => {
    expect(monthsOfDiff([], [])).toEqual([]);
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
