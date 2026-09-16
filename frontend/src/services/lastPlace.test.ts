import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { placeOf, rememberPlace } from "@/services/lastPlace";

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 16, 9, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe("where a coordinator was on each page", () => {
  it("comes back to the screen the page was left on", () => {
    rememberPlace("semesters", "timetable:term-1");

    expect(placeOf("semesters")).toBe("timetable:term-1");
  });

  it("keeps each page's place apart", () => {
    rememberPlace("semesters", "timetable:term-1");
    rememberPlace("groups", "cohort:fys");

    expect(placeOf("semesters")).toBe("timetable:term-1");
    expect(placeOf("groups")).toBe("cohort:fys");
  });

  it("forgets a page that is back at its front door", () => {
    rememberPlace("semesters", "timetable:term-1");
    rememberPlace("semesters", "");

    expect(placeOf("semesters")).toBe("");
  });

  it("does not answer for yesterday", () => {
    // A screen half-finished last night is somewhere you went, not where you are.
    rememberPlace("semesters", "timetable:term-1");
    vi.setSystemTime(new Date(2026, 8, 17, 9, 0, 0));

    expect(placeOf("semesters")).toBe("");
  });

  it("says nothing about a page it has never seen", () => {
    expect(placeOf("students")).toBe("");
  });

  it("survives a browser that refuses to remember", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });

    expect(() => rememberPlace("semesters", "timetable:term-1")).not.toThrow();
    setItem.mockRestore();
  });

  it("says nothing rather than throwing when what is held makes no sense", () => {
    window.localStorage.setItem("sorbonne.lastPlace", "not json at all");

    expect(placeOf("semesters")).toBe("");
  });
});
