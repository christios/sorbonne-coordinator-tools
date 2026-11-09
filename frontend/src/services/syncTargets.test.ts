import { describe, expect, it } from "vitest";

import { listTarget, studentTarget } from "@/services/syncTargets";

const COURSES = {
  id: "f1",
  name: "SCEN Courses",
  filter: {},
  lastSyncedAt: "2026-11-09T04:20:00Z",
  syncedTerms: { "262710": "2026-11-09T04:20:00Z" },
};
const SPRING = { code: "262720", name: "Semester 2 2026-27" };

/*
 * The Portal sync is about the semester chosen in the header: its courses and registrations
 * are what the portal is asked for, each list named after it and dated by its own last pull.
 */
describe("a portal list, for the semester chosen", () => {
  it("asks about the chosen semester's term, and is as old as that term's last pull", () => {
    expect(listTarget("courses", COURSES, SPRING)).toEqual({
      kind: "courses",
      id: "f1",
      name: "SCEN Courses · Semester 2 2026-27",
      filter: {},
      lastSyncedAt: undefined,
      termCode: "262720",
    });
    expect(listTarget("registrations", COURSES, { code: "262710", name: "Semester 1 2026-27" }).lastSyncedAt).toBe(
      "2026-11-09T04:20:00Z",
    );
  });

  it("leaves teachers, who have no term, and a sync with no semester to the extension's own", () => {
    for (const target of [listTarget("teachers", COURSES, SPRING), listTarget("courses", COURSES, null)]) {
      expect(target.termCode).toBeUndefined();
      expect(target.name).toBe("SCEN Courses");
    }
  });
});

describe("a student list, for the semester chosen", () => {
  const VIEW = { id: "v1", name: "SCEN students", filter: {}, lastSyncedAt: "2026-11-09T04:20:00Z" };

  it("asks for the chosen semester's enrolment, not the extension's own term", () => {
    expect(studentTarget(VIEW, SPRING)).toEqual({
      kind: "students",
      id: "v1",
      name: "SCEN students · Semester 2 2026-27",
      filter: {},
      lastSyncedAt: "2026-11-09T04:20:00Z",
      termCode: "262720",
    });
  });

  it("names no term when no semester with a portal term is chosen", () => {
    expect(studentTarget(VIEW, null).termCode).toBeUndefined();
    expect(studentTarget(VIEW, { code: "", name: "A plan with no term" }).termCode).toBeUndefined();
  });
});
