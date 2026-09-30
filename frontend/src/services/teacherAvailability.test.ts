import { describe, expect, it } from "vitest";

import type { TimetableEntry } from "@/components/SectionTimetable";
import type { FacilitySection } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";
import {
  availabilityOf,
  breakWeeks,
  breakWords,
  clashShort,
  clashWords,
  describeWindow,
  freedWords,
  termBounds,
  unknownWords,
  windowDates,
  windowProblem,
  type FreeWindow,
  type TermBounds,
} from "@/services/teacherAvailability";

const TERM = "262710";
/** 1 Oct 2026 is a Thursday; the 6th, 13th and 20th are Tuesdays. */
const THURSDAY: FreeWindow = { from: "2026-10-01", to: "2026-10-01", start: "14:00", end: "16:00", weekdays: [] };
const TUESDAYS: FreeWindow = { from: "2026-10-05", to: "2026-10-23", start: "10:00", end: "12:00", weekdays: [2] };

const meeting = (meetsOn: string, startsAt: string, endsAt: string, room = "5.111") => ({ meetsOn, startsAt, endsAt, room });

const section = (crn: string, meetings: ReturnType<typeof meeting>[], over: Partial<FacilitySection> = {}): FacilitySection => ({
  crn,
  courseCode: "ECON-101",
  title: "Economics",
  teacherName: "whatever the registrar says",
  state: "published",
  meetings,
  ...over,
});

const entry = (crn: string, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  termCode: TERM,
  crn,
  code: "ECON-101",
  title: "Economics",
  ...over,
});

const note = (over: Partial<SessionChange> = {}): SessionChange => ({
  id: "n1", termCode: TERM, crn: "22001", meetsOn: "2026-10-01", startsAt: "14:00", endsAt: "16:00",
  kind: "cancelled", coverTeacherId: "", coverTeacherName: "", note: "", authorEmail: "", authorName: "",
  createdAt: "", updatedAt: "", ...over,
});

/** The semester the sweep has dated: the first class to the last. */
const AUTUMN: Map<string, TermBounds> = new Map([[TERM, { from: "2026-08-31", to: "2026-12-18" }]]);

const AHLEM = { id: "act-1", fullName: "Ahlem Trabelsi" };

function ask(
  window: FreeWindow,
  {
    entries = [entry("22001")],
    sections = [section("22001", [meeting("2026-10-01", "14:00", "16:00")])],
    notes = [],
    withoutCrn = [],
    bounds = AUTUMN,
    notAClass,
  }: {
    entries?: TimetableEntry[];
    sections?: (FacilitySection & { termCode?: string })[];
    notes?: SessionChange[];
    withoutCrn?: { termCode: string; code: string }[];
    bounds?: Map<string, TermBounds>;
    notAClass?: (crn: string) => boolean;
  } = {},
) {
  const byKey = new Map(sections.map((held) => [`${held.termCode ?? TERM}|${held.crn}`, held]));
  return availabilityOf({
    teacher: AHLEM,
    entries,
    withoutCrn,
    sectionOf: (termCode, crn) => byKey.get(`${termCode}|${crn}`),
    notes,
    bounds,
    notAClass,
    window,
  });
}

describe("the window being asked about", () => {
  it("is one day for a one-off question, whatever weekdays are ticked", () => {
    expect(windowDates({ ...THURSDAY, weekdays: [2] })).toEqual(["2026-10-01"]);
  });

  it("is only the ticked weekdays over a range, and every day when none is", () => {
    expect(windowDates(TUESDAYS)).toEqual(["2026-10-06", "2026-10-13", "2026-10-20"]);
    expect(windowDates({ ...TUESDAYS, weekdays: [] })).toHaveLength(19);
  });

  it("says what is wrong with it before anything is asked", () => {
    expect(windowProblem(THURSDAY)).toBe("");
    expect(windowProblem({ ...THURSDAY, end: "13:00" })).toBe("The window has to end after it starts.");
    expect(windowProblem({ ...THURSDAY, to: "2026-09-30" })).toBe("The last day is before the first.");
    expect(windowProblem({ ...TUESDAYS, from: "2026-10-07", to: "2026-10-09" })).toBe(
      "None of those weekdays falls between those dates.",
    );
    expect(windowProblem({ ...THURSDAY, to: "2027-12-01" })).toBe("Ask about a year at most.");
  });

  it("names itself the way a coordinator would say it", () => {
    expect(describeWindow(THURSDAY)).toBe("Thu 1 Oct · 14:00–16:00");
    expect(describeWindow(TUESDAYS)).toBe("Tuesdays · 10:00–12:00 · 5 Oct – 23 Oct");
    expect(describeWindow({ ...TUESDAYS, weekdays: [4, 2] })).toBe("Tue, Thu · 10:00–12:00 · 5 Oct – 23 Oct");
    expect(describeWindow({ ...TUESDAYS, weekdays: [] })).toBe("5 Oct – 23 Oct · 10:00–12:00");
  });

  it("points out a week the semester has no classes in", () => {
    expect(breakWeeks(TUESDAYS, [{ weekOne: "2026-08-31", without: ["2026-10-12"] }])).toEqual(["2026-10-12"]);
    expect(breakWeeks(THURSDAY, [{ weekOne: "2026-08-31", without: ["2026-10-12"] }])).toEqual([]);
    expect(breakWords(["2026-10-12"])).toBe("The week of 12 Oct has no classes (Settings → Semesters).");
    expect(breakWords(["2026-10-12", "2026-12-21", "2026-12-28"])).toBe(
      "The weeks of 12 Oct, 21 Dec and 28 Dec have no classes (Settings → Semesters).",
    );
  });
});

describe("free or busy", () => {
  it("is busy when a class of theirs runs into the window, and says which", () => {
    const answer = ask(THURSDAY);

    expect(answer.state).toBe("busy");
    expect(answer.clashes).toHaveLength(1);
    expect(clashShort(answer.clashes[0])).toBe("ECON-101 · CRN 22001 · Thu 1 Oct 14:00–16:00");
    expect(clashWords(answer.clashes[0])).toBe("ECON-101 · CRN 22001 · Thu 1 Oct 14:00–16:00 · 5.111");
  });

  it("counts a class that only overlaps part of the window, and not one that ends as it starts", () => {
    const overlapping = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "15:30", "17:00")])] });
    const touching = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "12:00", "14:00")])] });

    expect(overlapping.state).toBe("busy");
    // A class that ends at two is not in the way of something that starts at two.
    expect(touching.state).toBe("free");
  });

  it("is free when every class of theirs is at another time", () => {
    const answer = ask(THURSDAY, {
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00"), meeting("2026-10-02", "14:00", "16:00")])],
    });

    expect(answer).toMatchObject({ state: "free", clashes: [], unknown: [] });
  });

  it("reads the sweep's seconds the same as the calendar does", () => {
    const answer = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "14:00:00", "16:00:00")])] });

    expect(answer.clashes[0]).toMatchObject({ start: "14:00", end: "16:00" });
  });
});

describe("the notes on their classes", () => {
  it("frees them from a cancelled class, and says so", () => {
    // Nobody was in the room: the hour is not a smaller class, it is no class.
    const answer = ask(THURSDAY, { notes: [note({ kind: "cancelled" })] });

    expect(answer.state).toBe("free");
    expect(freedWords(answer.freed[0])).toBe("ECON-101 · CRN 22001 · Thu 1 Oct 14:00–16:00: cancelled");
  });

  it("frees them from a class somebody else covered", () => {
    const answer = ask(THURSDAY, {
      notes: [note({ kind: "covered", coverTeacherId: "act-2", coverTeacherName: "Grace Younes" })],
    });

    expect(answer.state).toBe("free");
    expect(freedWords(answer.freed[0])).toContain("covered by Grace Younes");
  });

  it("keeps them busy on a class of their own the note says they covered themselves", () => {
    const answer = ask(THURSDAY, { notes: [note({ kind: "covered", coverTeacherName: "Trabelsi Ahlem" })] });

    expect(answer.state).toBe("busy");
  });

  it("makes them busy where they stood in for somebody, on that day and no other", () => {
    const cover = entry("23999", { code: "", title: "", standingIn: true, onlyOn: ["2026-10-06"] });
    const theirs = section("23999", [meeting("2026-10-06", "10:00", "12:00"), meeting("2026-10-13", "10:00", "12:00")], {
      courseCode: "MATH-201",
    });
    const answer = ask(TUESDAYS, {
      entries: [entry("22001"), cover],
      sections: [section("22001", [meeting("2026-10-01", "14:00", "16:00")]), theirs],
    });

    expect(answer.state).toBe("busy");
    expect(answer.clashes).toHaveLength(1);
    expect(answer.clashes[0].dates).toEqual(["2026-10-06"]);
    expect(clashShort(answer.clashes[0])).toBe("Covering MATH-201 · CRN 23999 · Tue 6 Oct 10:00–12:00");
  });
});

describe("over several weeks", () => {
  it("draws a weekly class as one clash, with how many of the days it takes", () => {
    const answer = ask(TUESDAYS, {
      sections: [
        section("22001", [
          meeting("2026-10-06", "10:00", "12:00"),
          meeting("2026-10-20", "10:00", "12:00", "4.124"),
          meeting("2026-10-08", "10:00", "12:00"),
        ]),
      ],
    });

    expect(answer.state).toBe("busy");
    expect(answer.clashes).toHaveLength(1);
    // Thursday is not a day being asked about; the break week has no class to count.
    expect(answer).toMatchObject({ busyDays: 2, days: 3 });
    expect(clashWords(answer.clashes[0])).toBe("ECON-101 · CRN 22001 · Tue 10:00–12:00 · 2 days, 6 Oct – 20 Oct · 5.111, 4.124");
  });
});

describe("what cannot be vouched for", () => {
  it("never calls somebody with no CRN free", () => {
    const answer = ask(THURSDAY, { entries: [], sections: [] });

    expect(answer.state).toBe("unknown");
    expect(unknownWords(answer.unknown[0])).toBe("No section of theirs carries a CRN, so none of their classes is known.");
  });

  it("is unknown when a section of theirs this semester has no timetable yet", () => {
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), entry("22002")],
      sections: [
        section("22001", [meeting("2026-10-01", "08:30", "10:00")]),
        section("22002", [], { state: "unchecked" }),
      ],
    });

    expect(answer.state).toBe("unknown");
    expect(unknownWords(answer.unknown[0])).toBe("Nobody has asked the portal about CRN 22002 (ECON-101) — run a portal sync.");
  });

  it("names every kind of hole the calendar names", () => {
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), entry("22002"), entry("22003"), entry("22004")],
      sections: [
        section("22001", [meeting("2026-10-01", "08:30", "10:00")]),
        section("22002", [], { state: "gone" }),
        section("22003", [], { state: "never" }),
      ],
    });

    expect(answer.unknown.map((hole) => hole.why)).toEqual(["gone", "unbooked", "unread"]);
  });

  it("is still busy when a class we do know about is in the window", () => {
    // A hole elsewhere in the week does not unsay a class that is there.
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), entry("22002")],
      sections: [section("22001", [meeting("2026-10-01", "14:00", "16:00")]), section("22002", [], { state: "unchecked" })],
    });

    expect(answer.state).toBe("busy");
    expect(answer.unknown).toHaveLength(1);
  });

  it("is unknown when a section of theirs this semester has no CRN yet", () => {
    const answer = ask(THURSDAY, {
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")])],
      withoutCrn: [{ termCode: TERM, code: "MATH-101" }],
    });

    expect(answer.state).toBe("unknown");
    expect(unknownWords(answer.unknown[0])).toBe("A section of theirs in MATH-101 has no CRN yet.");
  });

  it("sets aside a course-level row that is not a class", () => {
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), entry("22000")],
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")]), section("22000", [], { state: "unchecked" })],
      notAClass: (crn) => crn === "22000",
    });

    expect(answer.state).toBe("free");
  });
});

describe("another semester's sections", () => {
  const SPRING = "262720";
  const spring = (crn: string) => entry(crn, { termCode: SPRING });

  it("say nothing about a day in this one, swept or not", () => {
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), spring("32001")],
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")]), { ...section("32001", [], { state: "unchecked" }), termCode: SPRING }],
      withoutCrn: [{ termCode: SPRING, code: "MATH-102" }],
    });

    expect(answer.state).toBe("free");
  });

  it("count on a day no dated semester accounts for", () => {
    // After the last autumn class: nothing says the spring term has not started.
    const answer = ask(
      { ...THURSDAY, from: "2026-12-22", to: "2026-12-22" },
      {
        entries: [entry("22001"), spring("32001")],
        sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")]), { ...section("32001", [], { state: "unchecked" }), termCode: SPRING }],
      },
    );

    expect(answer.state).toBe("unknown");
    expect(answer.unknown.map((hole) => hole.crn)).toEqual(["32001"]);
  });

  it("count from the Week 1 Settings gives them, and not before", () => {
    const bounds = new Map([...AUTUMN, [SPRING, { from: "2027-01-11", to: "9999-12-31" }]]);
    const options = {
      entries: [entry("22001"), spring("32001")],
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")]), { ...section("32001", [], { state: "unchecked" }), termCode: SPRING }],
      bounds,
    };

    expect(ask({ ...THURSDAY, from: "2026-12-22", to: "2026-12-22" }, options).state).toBe("free");
    expect(ask({ ...THURSDAY, from: "2027-01-14", to: "2027-01-14" }, options).state).toBe("unknown");
  });

  it("in a semester linked to no portal term count only where no dated one does", () => {
    const options = { entries: [entry("22001"), entry("22009", { termCode: "" })] };

    expect(ask(THURSDAY, { ...options, sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")])] }).state).toBe("free");
    expect(ask({ ...THURSDAY, from: "2027-03-04", to: "2027-03-04" }, options).unknown[0]).toMatchObject({ why: "unlinked", crn: "22009" });
  });
});

describe("when each term runs", () => {
  it("is its first class to its last, reaching back to its Week 1", () => {
    const bounds = termBounds([
      { termCode: TERM, sections: [section("22001", [meeting("2026-09-01", "08:30", "10:00"), meeting("2026-12-18", "08:30", "10:00")])], weekOne: "2026-09-02" },
      { termCode: "262720", sections: [], weekOne: "2027-01-13" },
      { termCode: "262730", sections: [] },
    ]);

    // Week 1 is counted from its Monday.
    expect(bounds.get(TERM)).toEqual({ from: "2026-08-31", to: "2026-12-18" });
    expect(bounds.get("262720")).toEqual({ from: "2027-01-11", to: "9999-12-31" });
    expect(bounds.has("262730")).toBe(false);
  });
});
