import { describe, expect, it } from "vitest";

import { semesterShown, withoutYear, yearInName, yearOfTermCode } from "@/services/semesterYears";

describe("a semester's academic year", () => {
  it("is read from the registrar's term code, or from the name when there is no code", () => {
    expect(yearOfTermCode("262720")).toBe("2026-27");
    expect(yearOfTermCode("not a code")).toBe("");
    expect(yearInName("Semester 2 2026-27")).toBe("2026-27");
    expect(yearInName("Semester 2")).toBe("");
  });

  it("is said once, as the pill, and not again in the name", () => {
    expect(semesterShown("Semester 2 2026-27", "2026-27")).toEqual({ label: "Semester 2", year: "2026-27" });
    expect(semesterShown("Semester 1", "2026-27")).toEqual({ label: "Semester 1", year: "2026-27" });
    expect(semesterShown("Semester 1", "")).toEqual({ label: "Semester 1" });
    // A name that is nothing but the year keeps it.
    expect(withoutYear("2026-27", "2026-27")).toBe("2026-27");
  });
});
