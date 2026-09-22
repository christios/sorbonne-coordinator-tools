import { describe, expect, it } from "vitest";

import {
  cycleLabel,
  opensOnFor,
  periodChoices,
  periodContaining,
  periodEnd,
  periodLabel,
  periodsBehind,
  shortPeriodLabel,
} from "./payPeriods";

const on = (year: number, month: number, day: number) => new Date(year, month - 1, day);

describe("periodContaining", () => {
  it("opens a new period on the 15th and not before", () => {
    expect(periodContaining(on(2026, 9, 15))).toBe("2026-09-15");
    expect(periodContaining(on(2026, 9, 14))).toBe("2026-08-15");
    expect(periodContaining(on(2026, 9, 30))).toBe("2026-09-15");
  });

  it("steps back across the new year", () => {
    expect(periodContaining(on(2027, 1, 3))).toBe("2026-12-15");
  });
});

describe("periodEnd", () => {
  it("closes on the 14th of the month after", () => {
    expect(periodEnd("2026-08-15")).toBe("2026-09-14");
    expect(periodEnd("2026-12-15")).toBe("2027-01-14");
    // February is short and the 14th is still the 14th.
    expect(periodEnd("2027-01-15")).toBe("2027-02-14");
  });

  it("says nothing about a day it cannot read", () => {
    expect(periodEnd("not a date")).toBe("");
  });
});

describe("periodLabel", () => {
  it("says the year once when both ends share it", () => {
    expect(periodLabel("2026-08-15")).toBe("15 Aug – 14 Sep 2026");
  });

  it("says both years across the new year, so nobody has to guess which January", () => {
    expect(periodLabel("2026-12-15")).toBe("15 Dec 2026 – 14 Jan 2027");
  });

  it("shortens to months for a crowded row", () => {
    expect(shortPeriodLabel("2026-08-15")).toBe("Aug–Sep 2026");
  });
});

describe("periodChoices", () => {
  it("offers the period running now, one ahead, and the recent ones behind it", () => {
    const offered = periodChoices(on(2026, 9, 20), 2, 1);
    expect(offered).toEqual(["2026-10-15", "2026-09-15", "2026-08-15", "2026-07-15"]);
  });

  it("counts the period running now from the day, not the month", () => {
    // The 14th is still August's period, so August leads rather than September.
    expect(periodChoices(on(2026, 9, 14), 1, 0)).toEqual(["2026-08-15", "2026-07-15"]);
  });
});

describe("periodsBehind", () => {
  it("counts whole periods, so nought is the one running now", () => {
    expect(periodsBehind("2026-08-15", on(2026, 9, 14))).toBe(0);
    expect(periodsBehind("2026-08-15", on(2026, 9, 15))).toBe(1);
    expect(periodsBehind("2026-06-15", on(2026, 9, 20))).toBe(3);
  });

  it("is nothing at all for a sheet with no period, which is not the same as being old", () => {
    expect(periodsBehind("", on(2026, 9, 20))).toBeNull();
  });
});

describe("a semester paid on its own cycle", () => {
  it("puts a date in the period that semester's cycle opens", () => {
    // Paid from the 1st, the 14th of September is in September's period, not August's.
    expect(periodContaining(on(2026, 9, 14), 1)).toBe("2026-09-01");
    // Paid from the 20th, the same day is still in August's.
    expect(periodContaining(on(2026, 9, 14), 20)).toBe("2026-08-20");
  });

  it("offers periods that open on the semester's day", () => {
    expect(periodChoices(on(2026, 9, 20), 1, 0, 20)).toEqual(["2026-09-20", "2026-08-20"]);
  });

  it("goes on being paid from the 15th where nobody has said otherwise", () => {
    expect(periodContaining(on(2026, 9, 14))).toBe(periodContaining(on(2026, 9, 14), 15));
  });

  it("reads a semester's day off what the server holds, and the usual day for the rest", () => {
    const cycles = { "term-1": 20 };

    expect(opensOnFor(cycles, "term-1")).toBe(20);
    expect(opensOnFor(cycles, "term-2")).toBe(15);
    expect(opensOnFor({}, "term-1")).toBe(15);
  });

  it("says a cycle the way a coordinator would", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 15, 21, 22].map(cycleLabel)).toEqual([
      "the 1st", "the 2nd", "the 3rd", "the 4th", "the 11th", "the 12th", "the 13th",
      "the 15th", "the 21st", "the 22nd",
    ]);
  });
});
