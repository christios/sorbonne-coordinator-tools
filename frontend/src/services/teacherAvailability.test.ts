import { describe, expect, it } from "vitest";

import type { TimetableEntry } from "@/components/SectionTimetable";
import type { FacilitySection } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";
import {
  availabilityOf,
  breakWeekOf,
  breakWords,
  classShort,
  classWords,
  describeWindow,
  freedWords,
  termBounds,
  unknownWords,
  windowProblem,
  type FreeWindow,
  type TermBounds,
} from "@/services/teacherAvailability";

const TERM = "262710";
/** 1 Oct 2026 is a Thursday. */
const THURSDAY: FreeWindow = { date: "2026-10-01", start: "14:00", end: "16:00", teachingThatDay: false };
const TEACHING: FreeWindow = { ...THURSDAY, teachingThatDay: true };

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
  it("says what is wrong with it before anything is asked", () => {
    expect(windowProblem(THURSDAY)).toBe("");
    expect(windowProblem({ ...THURSDAY, date: "" })).toBe("Choose the day.");
    expect(windowProblem({ ...THURSDAY, end: "" })).toBe("Choose the hours.");
    expect(windowProblem({ ...THURSDAY, end: "13:00" })).toBe("The window has to end after it starts.");
    expect(windowProblem({ ...THURSDAY, end: "14:00" })).toBe("The window has to end after it starts.");
  });

  it("names itself the way a coordinator would say it, condition and all", () => {
    expect(describeWindow(THURSDAY)).toBe("Thu 1 Oct · 14:00–16:00");
    expect(describeWindow(TEACHING)).toBe("Thu 1 Oct · 14:00–16:00 · teaching that day");
  });

  it("points out a day in a week the semester has no classes in", () => {
    const calendars = [{ weekOne: "2026-08-31", without: ["2026-10-12"] }];

    expect(breakWeekOf({ ...THURSDAY, date: "2026-10-14" }, calendars)).toBe("2026-10-12");
    expect(breakWeekOf(THURSDAY, calendars)).toBe("");
    expect(breakWords("2026-10-12")).toBe("The week of 12 Oct has no classes (Settings → Semesters).");
    expect(breakWords("")).toBe("");
  });
});

describe("free or busy", () => {
  it("is busy when a class of theirs runs into the window, and says which", () => {
    const answer = ask(THURSDAY);

    expect(answer.state).toBe("busy");
    expect(answer.clashes).toHaveLength(1);
    expect(classShort(answer.clashes[0])).toBe("ECON-101 · CRN 22001 · 14:00–16:00");
    expect(classWords(answer.clashes[0])).toBe("ECON-101 · CRN 22001 · Thu 1 Oct 14:00–16:00 · 5.111");
  });

  it("counts a class that only overlaps part of the window, and not one that ends as it starts", () => {
    const overlapping = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "15:30", "17:00")])] });
    const touching = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "12:00", "14:00")])] });

    expect(overlapping.state).toBe("busy");
    // A class that ends at two is not in the way of something that starts at two.
    expect(touching.state).toBe("free");
    expect(touching.sameDay.map(classShort)).toEqual(["ECON-101 · CRN 22001 · 12:00–14:00"]);
  });

  it("is free when every class of theirs is at another time or on another day", () => {
    const answer = ask(THURSDAY, {
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00"), meeting("2026-10-02", "14:00", "16:00")])],
    });

    expect(answer).toMatchObject({ state: "free", clashes: [], unknown: [] });
    // Their Thursday morning class is kept, to say they are in that day; Friday's is another day.
    expect(answer.sameDay).toHaveLength(1);
  });

  it("reads the sweep's seconds the same as the calendar does", () => {
    const answer = ask(THURSDAY, { sections: [section("22001", [meeting("2026-10-01", "14:00:00", "16:00:00")])] });

    expect(answer.clashes[0]).toMatchObject({ start: "14:00", end: "16:00" });
  });
});

describe("only somebody teaching that day", () => {
  const friday = [section("22001", [meeting("2026-10-02", "08:30", "10:00")])];

  it("counts a teacher with another class that day as free", () => {
    const answer = ask(TEACHING, { sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")])] });

    expect(answer.state).toBe("free");
  });

  it("sets apart a teacher with nothing in the way and no class that day either", () => {
    expect(ask(TEACHING, { sections: friday }).state).toBe("notTeaching");
    // Asked without the condition, the same teacher is simply free.
    expect(ask(THURSDAY, { sections: friday }).state).toBe("free");
  });

  it("does not count a class of theirs that day that was cancelled or covered", () => {
    const morning = [section("22001", [meeting("2026-10-01", "08:30", "10:00")])];
    const cancelled = note({ startsAt: "08:30", endsAt: "10:00" });
    const covered = note({ startsAt: "08:30", endsAt: "10:00", kind: "covered", coverTeacherName: "Grace Younes" });

    expect(ask(TEACHING, { sections: morning, notes: [cancelled] }).state).toBe("notTeaching");
    expect(ask(TEACHING, { sections: morning, notes: [covered] }).state).toBe("notTeaching");
    // Out of the way of the window, but still said.
    expect(ask(TEACHING, { sections: morning, notes: [cancelled] }).freed[0].inWindow).toBe(false);
  });

  it("counts a class they stood in for that day", () => {
    const cover = entry("23999", { code: "", title: "", standingIn: true, onlyOn: ["2026-10-01"] });
    const answer = ask(TEACHING, {
      entries: [entry("22001"), cover],
      sections: [...friday, section("23999", [meeting("2026-10-01", "08:30", "10:00")], { courseCode: "MATH-201" })],
    });

    expect(answer.state).toBe("free");
    expect(classShort(answer.sameDay[0])).toBe("Covering MATH-201 · CRN 23999 · 08:30–10:00");
  });

  it("leaves busy busy and unknown unknown", () => {
    expect(ask(TEACHING).state).toBe("busy");
    // A hole in the week cannot say whether they teach that day either.
    expect(ask(TEACHING, { entries: [], sections: [] }).state).toBe("unknown");
  });
});

describe("the notes on their classes", () => {
  it("frees them from a cancelled class, and says so", () => {
    // Nobody was in the room: the hour is not a smaller class, it is no class.
    const answer = ask(THURSDAY, { notes: [note({ kind: "cancelled" })] });

    expect(answer.state).toBe("free");
    expect(answer.freed[0].inWindow).toBe(true);
    expect(freedWords(answer.freed[0])).toBe("ECON-101 · CRN 22001 · 14:00–16:00: cancelled");
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
    const cover = entry("23999", { code: "", title: "", standingIn: true, onlyOn: ["2026-10-08"] });
    const theirs = section("23999", [meeting("2026-10-01", "14:00", "16:00"), meeting("2026-10-08", "14:00", "16:00")], {
      courseCode: "MATH-201",
    });
    const options = { entries: [entry("22001"), cover], sections: [section("22001", [meeting("2026-10-02", "08:30", "10:00")]), theirs] };

    expect(ask(THURSDAY, options).state).toBe("free");
    const answer = ask({ ...THURSDAY, date: "2026-10-08" }, options);
    expect(answer.state).toBe("busy");
    expect(classShort(answer.clashes[0])).toBe("Covering MATH-201 · CRN 23999 · 14:00–16:00");
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
      sections: [section("22001", [meeting("2026-10-01", "08:30", "10:00")]), section("22002", [], { state: "unchecked" })],
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
  const unswept = { ...section("32001", [], { state: "unchecked" }), termCode: SPRING };
  const autumn = section("22001", [meeting("2026-10-01", "08:30", "10:00")]);

  it("say nothing about a day in this one, swept or not", () => {
    const answer = ask(THURSDAY, {
      entries: [entry("22001"), spring("32001")],
      sections: [autumn, unswept],
      withoutCrn: [{ termCode: SPRING, code: "MATH-102" }],
    });

    expect(answer.state).toBe("free");
  });

  it("count on a day no dated semester accounts for", () => {
    // After the last autumn class: nothing says the spring term has not started.
    const answer = ask({ ...THURSDAY, date: "2026-12-22" }, { entries: [entry("22001"), spring("32001")], sections: [autumn, unswept] });

    expect(answer.state).toBe("unknown");
    expect(answer.unknown.map((hole) => hole.crn)).toEqual(["32001"]);
  });

  it("count from the Week 1 Settings gives them, and not before", () => {
    const bounds = new Map([...AUTUMN, [SPRING, { from: "2027-01-11", to: "9999-12-31" }]]);
    const options = { entries: [entry("22001"), spring("32001")], sections: [autumn, unswept], bounds };

    expect(ask({ ...THURSDAY, date: "2026-12-22" }, options).state).toBe("free");
    expect(ask({ ...THURSDAY, date: "2027-01-14" }, options).state).toBe("unknown");
  });

  it("in a semester linked to no portal term count only where no dated one does", () => {
    const options = { entries: [entry("22001"), entry("22009", { termCode: "" })], sections: [autumn] };

    expect(ask(THURSDAY, options).state).toBe("free");
    expect(ask({ ...THURSDAY, date: "2027-03-04" }, options).unknown[0]).toMatchObject({ why: "unlinked", crn: "22009" });
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
