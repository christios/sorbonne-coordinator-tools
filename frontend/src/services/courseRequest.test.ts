import { describe, expect, it } from "vitest";

import { filled, isSilent, preferences, spread } from "@/services/courseRequest";
import { EMPTY_REQUEST, EMPTY_SECTION } from "@/services/studentDatabase";

describe("what a course asks of the timetable", () => {
  it("is silent until somebody says something", () => {
    expect(isSilent(EMPTY_REQUEST)).toBe(true);
    expect(isSilent({ ...EMPTY_REQUEST, hours: "36" })).toBe(false);
    // A count of nobody is nothing said, not an answer of zero.
    expect(isSilent({ ...EMPTY_REQUEST, anticipated: 0 })).toBe(true);
  });

  it("says how the hours are spread, and what is asked of the room and the week", () => {
    const request = { ...EMPTY_REQUEST, weeks: "2–14", sessionsPerWeek: "2 sessions", duration: "1.5", roomPref: "Amphitheatre", dayPref: "avoid Fridays" };
    expect(spread(request)).toBe("weeks 2–14 · 2 sessions · 1.5 h each");
    expect(preferences(request)).toBe("Amphitheatre · avoid Fridays");
  });

  it("answers a section's silence with the course, field by field", () => {
    const course = { ...EMPTY_REQUEST, hours: "36", weeks: "2–14", anticipated: 30, roomPref: "Amphitheatre" };
    const section = { ...EMPTY_SECTION, crn: "23223", hours: "12", anticipated: 8 };

    const row = filled(section, course);

    // Its own answers stand.
    expect(row.hours).toBe("12");
    expect(row.anticipated).toBe(8);
    // And the course fills only where it said nothing — naming an hour does not silence
    // the rest of what its course asked for.
    expect(row.weeks).toBe("2–14");
    expect(row.roomPref).toBe("Amphitheatre");
    expect(row.crn).toBe("23223");
  });

  it("names the course's teacher only where the row names nobody at all", () => {
    const course = { ...EMPTY_REQUEST, teacherId: "act-1" };

    expect(filled({ ...EMPTY_SECTION }, course).teacherId).toBe("act-1");
    // A name the registrar wrote is not silence, even before anybody confirms it.
    expect(filled({ ...EMPTY_SECTION, teacher: "TBD" }, course).teacherId).toBe("");
    // And a teacher actually chosen for this section stands.
    expect(filled({ ...EMPTY_SECTION, teacherId: "act-2" }, course).teacherId).toBe("act-2");
  });

  it("leaves a section alone when its course asks for nothing", () => {
    const section = { ...EMPTY_SECTION, crn: "23223", hours: "12" };
    expect(filled(section, EMPTY_REQUEST)).toEqual(section);
  });
});
