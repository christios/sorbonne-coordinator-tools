import { describe, expect, it } from "vitest";

import {
  type DiffCourse,
  type DiffSession,
  allKeys,
  courseKey,
  courseRowMatches,
  describeSession,
  hasDecisions,
  keysOf,
  operationsFrom,
  rowKey,
  studentsAffected,
  visibleCourses,
} from "@/services/timetableDiff";

const AFTER = { date: "2026-08-31", start: "08:30", end: "10:00", room: "9.001", isExam: false };
const BEFORE = { ...AFTER, room: "7.113" };

const COURSE_VALUES = {
  code: "MATH-001-CM-GR.A",
  title: "Pre-Calculus",
  shortTitle: "Pre-Calculus",
  kind: "Lecture",
  groupLabel: "Gr. A",
  staff: "Dr. Bilal Maaz",
};

function session(overrides: Partial<DiffSession> = {}): DiffSession {
  return {
    status: "changed",
    sessionId: "s1",
    before: BEFORE,
    after: AFTER,
    changes: ["room 7.113 → 9.001"],
    matchRule: "same_day_and_start",
    matchedOn: "same day, same start time",
    isCertain: true,
    ...overrides,
  };
}

function course(overrides: Partial<DiffCourse> = {}): DiffCourse {
  return {
    crn: "22151",
    code: "MATH-001-CM-GR.A",
    title: "Pre-Calculus",
    groupLabel: "Gr. A",
    kind: "Lecture",
    status: "present",
    courseChanges: [],
    before: COURSE_VALUES,
    after: COURSE_VALUES,
    enrolledStudents: 0,
    sessions: [session()],
    ...overrides,
  };
}

describe("what the screen offers", () => {
  it("leaves an untouched course out of the decisions", () => {
    const untouched = course({ sessions: [session({ status: "unchanged", changes: [] })] });
    expect(hasDecisions(untouched)).toBe(false);
    expect(keysOf(untouched)).toEqual([]);
  });

  it("hides unchanged rows from every view except their own", () => {
    const mixed = course({ sessions: [session(), session({ status: "unchanged", sessionId: "s2", changes: [] })] });
    expect(visibleCourses([mixed], "all")[0].sessions).toHaveLength(1);
    expect(visibleCourses([mixed], "changed")[0].sessions).toHaveLength(1);
    expect(visibleCourses([mixed], "unchanged")[0].sessions).toHaveLength(1);
    expect(visibleCourses([mixed], "unchanged")[0].sessions[0].sessionId).toBe("s2");
  });

  it("drops a course entirely when nothing in it matches the filter", () => {
    expect(visibleCourses([course()], "removed")).toEqual([]);
  });

  it("shows a course-details change as the course's own row", () => {
    const renamed = course({
      courseChanges: ["lecturer Dr. Bilal Maaz → Dr. Amina Rahal"],
      sessions: [session({ status: "unchanged", changes: [] })],
    });
    expect(courseRowMatches(renamed, "course")).toBe(true);
    expect(courseRowMatches(renamed, "all")).toBe(true);
    expect(courseRowMatches(renamed, "added")).toBe(false);
    expect(visibleCourses([renamed], "course")).toHaveLength(1);
  });
});

describe("nothing is approved until it is ticked", () => {
  it("sends nothing at all when nothing is selected", () => {
    expect(operationsFrom([course()], new Set())).toEqual([]);
  });

  it("sends only the ticked row when two have moved", () => {
    const two = course({
      sessions: [session(), session({ sessionId: "s2", after: { ...AFTER, room: "9.002" } })],
    });
    const operations = operationsFrom([two], new Set(["s:s1"]));
    expect(operations).toEqual([{ op: "updateSession", sessionId: "s1", ...AFTER }]);
  });

  it("keys an added row by its values, since it has no id yet", () => {
    const added = session({ status: "added", sessionId: null, before: null, changes: [] });
    expect(rowKey("22151", added)).toBe("n:22151:2026-08-31:08:30:10:00:9.001");
  });
});

describe("building the changes to apply", () => {
  it("turns a removal into removeSession", () => {
    const removed = course({ sessions: [session({ status: "removed", after: null, changes: [] })] });
    expect(operationsFrom([removed], new Set(["s:s1"]))).toEqual([{ op: "removeSession", sessionId: "s1" }]);
  });

  it("turns a course-details change into updateCourse", () => {
    const renamed = course({
      courseChanges: ["lecturer Dr. Bilal Maaz → Dr. Amina Rahal"],
      sessions: [session({ status: "unchanged", changes: [] })],
    });
    expect(operationsFrom([renamed], new Set([courseKey("22151")]))).toEqual([
      { op: "updateCourse", crn: "22151", ...COURSE_VALUES },
    ]);
  });

  it("adds the course before the sessions that hang off it", () => {
    const fresh = course({
      status: "added",
      sessions: [session({ status: "added", sessionId: null, before: null, changes: [] })],
    });
    const operations = operationsFrom([fresh], new Set(allKeys([fresh])));
    expect(operations.map((operation) => operation.op)).toEqual(["addCourse", "addSession"]);
  });

  it("never sends a session for a new course the coordinator has not accepted", () => {
    const fresh = course({
      status: "added",
      sessions: [session({ status: "added", sessionId: null, before: null, changes: [] })],
    });
    const sessionOnly = new Set([rowKey("22151", fresh.sessions[0])]);
    expect(operationsFrom([fresh], sessionOnly)).toEqual([]);
  });
});

describe("removing a course", () => {
  const dropped = course({
    status: "removed",
    enrolledStudents: 34,
    sessions: [
      session({ status: "removed", after: null, changes: [] }),
      session({ status: "removed", sessionId: "s2", after: null, changes: [] }),
    ],
  });

  it("is a single decision, not one per session", () => {
    expect(keysOf(dropped)).toEqual([courseKey("22151")]);
  });

  it("sends removeCourse and nothing else, because the cascade does the rest", () => {
    expect(operationsFrom([dropped], new Set([courseKey("22151")]))).toEqual([
      { op: "removeCourse", crn: "22151" },
    ]);
  });

  it("counts the students who would lose it, but only once it is ticked", () => {
    expect(studentsAffected([dropped], new Set())).toBe(0);
    expect(studentsAffected([dropped], new Set([courseKey("22151")]))).toBe(34);
  });

  it("cannot be approved by ticking one of its sessions", () => {
    expect(operationsFrom([dropped], new Set(["s:s1"]))).toEqual([]);
  });
});

describe("how a row reads", () => {
  it("writes the day out so a date is not read as a number", () => {
    expect(describeSession(AFTER)).toBe("Mon, 31 Aug 2026 · 08:30–10:00 · 9.001");
  });

  it("says when a session is an exam", () => {
    expect(describeSession({ ...AFTER, isExam: true })).toContain("exam");
  });
});
