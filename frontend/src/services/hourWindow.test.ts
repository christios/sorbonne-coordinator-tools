import { describe, expect, it } from "vitest";

import { WHOLE_SEMESTER, datesOf, isWholeSemester, windowForPeriod, windowForRange } from "@/services/hourWindow";

describe("a pay period as a window", () => {
  it("is named the way the rest of the application names it", () => {
    expect(windowForPeriod("2026-09-15").label).toBe("15 Sep – 14 Oct 2026");
  });

  it("carries a short mark for the headings", () => {
    expect(windowForPeriod("2026-09-15").tag).toBe("SEP-OCT");
    expect(windowForPeriod("2026-12-15").tag).toBe("DEC-JAN");
  });

  it("runs from the day it opens to the day before it comes round again", () => {
    expect(datesOf(windowForPeriod("2026-09-15"))).toEqual({ from: "2026-09-15", to: "2026-10-14" });
  });
});

describe("any two dates", () => {
  it("says both, and says the year once where they share it", () => {
    expect(windowForRange("2026-10-03", "2026-10-19").label).toBe("3 Oct – 19 Oct 2026");
  });

  it("says both years where they differ", () => {
    expect(windowForRange("2026-12-20", "2027-01-08").label).toBe("20 Dec 2026 – 8 Jan 2027");
  });

  it("takes the dates in either order", () => {
    expect(windowForRange("2026-10-19", "2026-10-03").from).toBe("2026-10-03");
  });

  it("falls back to the whole semester rather than inventing a range", () => {
    expect(windowForRange("not a date", "2026-10-19")).toEqual(WHOLE_SEMESTER);
  });
});

describe("the whole semester", () => {
  it("counts everything and marks nothing", () => {
    expect(isWholeSemester(WHOLE_SEMESTER)).toBe(true);
    expect(WHOLE_SEMESTER.tag).toBe("");
    expect(datesOf(WHOLE_SEMESTER)).toEqual({ from: "0000-01-01", to: "9999-12-31" });
  });
});
