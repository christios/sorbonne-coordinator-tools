import { describe, expect, it } from "vitest";

import {
  assignColors,
  defaultWeekStart,
  hourBounds,
  laneOut,
  placeSessions,
  toIsoDate,
  weekDays,
  type Session,
} from "@/services/weekSchedule";

const at = (crn: string, date: string, start: string, end: string): Session => ({ crn, date, start, end, room: "" });

describe("the hours a calendar draws", () => {
  it("is never narrower than a teaching day, so two weeks line up", () => {
    expect(hourBounds([at("1", "2026-09-07", "10:00", "11:30")])).toEqual({ startMinute: 8 * 60, endMinute: 18 * 60 });
  });

  it("opens out to whole hours around an early or late class", () => {
    const bounds = hourBounds([at("1", "2026-09-07", "07:30", "09:00"), at("2", "2026-09-07", "17:45", "19:15")]);
    expect(bounds).toEqual({ startMinute: 7 * 60, endMinute: 20 * 60 });
  });
});

describe("laying sessions side by side", () => {
  it("gives overlapping classes lanes of their own, and the same count across a cluster", () => {
    // Four tutorials in one Monday slot — a course's calendar, not a student's.
    const laid = laneOut([at("a", "d", "08:30", "10:00"), at("b", "d", "08:30", "10:00"), at("c", "d", "09:00", "10:30"), at("z", "d", "14:00", "15:30")]);
    const byCrn = Object.fromEntries(laid.map((entry) => [entry.session.crn, [entry.lane, entry.lanes]]));
    expect(byCrn.a).toEqual([0, 3]);
    expect(byCrn.b).toEqual([1, 3]);
    expect(byCrn.c).toEqual([2, 3]);
    // The afternoon class touches none of them and has the column to itself.
    expect(byCrn.z).toEqual([0, 1]);
  });

  it("reuses a lane once the class in it has ended", () => {
    const laid = laneOut([at("a", "d", "08:30", "10:00"), at("b", "d", "08:30", "09:00"), at("c", "d", "09:00", "10:00")]);
    const byCrn = Object.fromEntries(laid.map((entry) => [entry.session.crn, entry.lane]));
    expect(byCrn.b).toBe(1);
    expect(byCrn.c).toBe(1);
  });
});

describe("the week to open on", () => {
  it("is the one holding the next class, or the last one when the term is over", () => {
    const sessions = [at("1", "2026-09-08", "08:30", "10:00"), at("1", "2026-09-22", "08:30", "10:00")];
    expect(toIsoDate(defaultWeekStart(sessions, "2026-09-10"))).toBe("2026-09-21");
    expect(toIsoDate(defaultWeekStart(sessions, "2026-12-01"))).toBe("2026-09-21");
    expect(toIsoDate(defaultWeekStart([], "2026-09-10"))).toBe("2026-09-07");
  });

  it("shows Saturday only in a week that uses it", () => {
    const monday = new Date(2026, 8, 7);
    expect(weekDays(monday, [])).toHaveLength(5);
    expect(weekDays(monday, [at("1", "2026-09-12", "09:00", "10:00")])).toHaveLength(6);
  });
});

describe("marking clashes and colours", () => {
  it("marks a session that runs into another on the same day", () => {
    const placed = placeSessions([at("a", "d", "08:30", "10:00"), at("b", "d", "09:30", "11:00"), at("c", "e", "09:30", "11:00")]);
    expect(placed.map((session) => [session.crn, session.clashes])).toEqual([["a", true], ["b", true], ["c", false]]);
  });

  it("gives the same keys the same colours, whatever else is around them", () => {
    expect(assignColors(["MATH-001", "PHYS-101", "MATH-001"]).get("PHYS-101")).toBe(assignColors(["MATH-001", "PHYS-101"]).get("PHYS-101"));
    expect(assignColors(["MATH-001", "PHYS-101"]).size).toBe(2);
  });
});
