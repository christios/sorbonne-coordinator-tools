import { describe, expect, it } from "vitest";

import { asHours, hoursTaught, minutesByTeacher, type Period } from "@/services/hoursInPeriod";
import type { FacilitySection } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";

const PERIOD: Period = { from: "2026-09-15", to: "2026-10-14" };

const meeting = (meetsOn: string, startsAt = "08:30", endsAt = "10:00") => ({ meetsOn, startsAt, endsAt, room: "5.101" });

const section = (crn: string, meetings: ReturnType<typeof meeting>[]): FacilitySection => ({
  crn,
  courseCode: "MATH-100",
  title: "Analysis",
  teacherName: "whatever the registrar says",
  state: "published",
  meetings,
});

const note = (over: Partial<SessionChange> = {}): SessionChange => ({
  id: "n1", termCode: "262710", crn: "23644", meetsOn: "2026-09-16", startsAt: "08:30", endsAt: "10:00",
  kind: "cancelled", coverTeacherId: "", coverTeacherName: "", note: "", authorEmail: "", authorName: "",
  createdAt: "", updatedAt: "", ...over,
});

/** Ours, not the registrar's: the teacher somebody chose for the section. */
const staffing = () => ({ id: "t-maaz", name: "Bilal Maaz" });

describe("what was actually taught between two dates", () => {
  it("counts the meetings inside the period and no others", () => {
    const { hours } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-14"), meeting("2026-09-15"), meeting("2026-10-14"), meeting("2026-10-15")])],
      changes: [],
      period: PERIOD,
      staffing,
    });

    // Both ends count: a period is a run of days and the last one is in it.
    expect(hours.map((hour) => hour.meetsOn)).toEqual(["2026-09-15", "2026-10-14"]);
  });

  it("measures an hour by the clock, not by the figure typed on the section", () => {
    const { hours } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16", "08:30", "10:00"), meeting("2026-09-23", "14:00", "15:30")])],
      changes: [],
      period: PERIOD,
      staffing,
    });

    expect(hours.map((hour) => hour.minutes)).toEqual([90, 90]);
    expect(asHours(minutesByTeacher(hours)["t-maaz"])).toBe(3);
  });

  it("drops a cancelled class rather than shortening it", () => {
    // Nobody was in the room. It is not a smaller hour, it is no hour.
    const { hours } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16"), meeting("2026-09-23")])],
      changes: [note({ meetsOn: "2026-09-16", kind: "cancelled" })],
      period: PERIOD,
      staffing,
    });

    expect(hours.map((hour) => hour.meetsOn)).toEqual(["2026-09-23"]);
  });

  it("gives a covered class to whoever stood in, and takes it off the usual teacher", () => {
    // The one rule that moves hours between two people.
    const { hours } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16"), meeting("2026-09-23")])],
      changes: [note({ meetsOn: "2026-09-16", kind: "covered", coverTeacherId: "t-younes", coverTeacherName: "Grace Younes" })],
      period: PERIOD,
      staffing,
    });

    expect(minutesByTeacher(hours)).toEqual({ "t-younes": 90, "t-maaz": 90 });
    expect(hours.find((hour) => hour.covered)?.teacherName).toBe("Grace Younes");
  });

  it("still counts an hour nobody has been chosen for, under nobody", () => {
    const { hours } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16")])],
      changes: [],
      period: PERIOD,
      staffing: () => ({ id: "", name: "" }),
    });

    expect(minutesByTeacher(hours)).toEqual({ "": 90 });
  });

  it("hands back a note whose class the registrar has since moved", () => {
    // A decision somebody took about an hour that no longer exists. Dropping it quietly
    // would take an hour off a claim with nothing said.
    const { hours, stranded } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16", "10:15", "11:45")])],
      changes: [note({ meetsOn: "2026-09-16", startsAt: "08:30", kind: "cancelled" })],
      period: PERIOD,
      staffing,
    });

    expect(hours).toHaveLength(1);
    expect(stranded.map((change) => change.startsAt)).toEqual(["08:30"]);
  });

  it("says nothing about a note outside the period", () => {
    const { stranded } = hoursTaught({
      sections: [section("23644", [meeting("2026-09-16")])],
      changes: [note({ meetsOn: "2026-08-01", startsAt: "08:30" })],
      period: PERIOD,
      staffing,
    });

    expect(stranded).toEqual([]);
  });

  it("adds up several sections for the same person", () => {
    const { hours } = hoursTaught({
      sections: [
        section("23644", [meeting("2026-09-16"), meeting("2026-09-23")]),
        section("23645", [meeting("2026-09-17", "11:00", "12:00")]),
      ],
      changes: [],
      period: PERIOD,
      staffing,
    });

    expect(minutesByTeacher(hours)["t-maaz"]).toBe(240);
    expect(asHours(240)).toBe(4);
  });
});

describe("the figure a claim is written in", () => {
  it("rounds to the quarter, which is how a time sheet reads", () => {
    expect([90, 120, 89, 100].map(asHours)).toEqual([1.5, 2, 1.5, 1.75]);
  });

  it("says nothing rather than something silly for no minutes at all", () => {
    expect(asHours(0)).toBe(0);
    expect(minutesByTeacher([])).toEqual({});
  });
});
