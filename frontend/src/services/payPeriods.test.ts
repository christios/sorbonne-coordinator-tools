import { describe, expect, it } from "vitest";

import {
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
