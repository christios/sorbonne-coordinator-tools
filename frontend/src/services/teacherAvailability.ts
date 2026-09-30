/**
 * Who is free when: the teachers with no class in a window of one day, the ones who have
 * one and with what, and the ones nobody can answer for.
 *
 * "Who could take a replacement class on Thursday at two" is one day and a window of hours
 * on it, and whether any class of theirs runs into it. Asked with "and is teaching that day
 * anyway", it is also whether they have a class of their own that day at all — somebody
 * already on campus, rather than somebody asked to come in for two hours.
 *
 * A teacher's classes are read exactly as their record draws their week — the sections
 * `teacherTimetable` gives them, the registrar's dated meetings for those, and the notes
 * written against the meetings — so this page can never call somebody free at an hour
 * their own calendar shows a class. The notes are read the way the hours are: a cancelled
 * class is no class, and a covered one belongs to whoever stood in (services/hoursInPeriod).
 *
 * Free is a claim, and it is only made where it can be backed. A teacher with no CRN on any
 * section, or with a section the sweep has no classes for in a semester that could be
 * running then, is not free — their calendar has a hole in it, and a hole reads exactly like
 * an empty afternoon. They are "unknown", with the reason, unless a class we do know about
 * already makes them busy.
 */

import type { TimetableEntry } from "@/components/SectionTimetable";
import type { FacilitySection } from "@/services/portalLists";
import { slotKey, type SessionChange } from "@/services/sessionChanges";
import { sameTeacher } from "@/services/teacherLoad";
import { DAY_NAMES, formatDayAndMonth, minutesOf, mondayOf, parseIsoDate, toIsoDate, type TeachingCalendar } from "@/services/weekSchedule";

/** The window being asked about: one day, and the hours on it. */
export type FreeWindow = {
  /** ISO. */
  date: string;
  /** HH:MM. */
  start: string;
  end: string;
  /** Free only counts somebody with a class of their own that day, outside the window. */
  teachingThatDay: boolean;
};

/** What is wrong with a window before it can be asked, in a sentence; "" when nothing is. */
export function windowProblem(window: FreeWindow): string {
  if (!window.date) return "Choose the day.";
  if (!window.start || !window.end) return "Choose the hours.";
  if (minutesOf(window.end) <= minutesOf(window.start)) return "The window has to end after it starts.";
  return "";
}

/** "Thu 1 Oct" — the day being asked about, as the page names it. */
function dayWords(date: string): string {
  return `${DAY_NAMES[parseIsoDate(date).getDay()]} ${formatDayAndMonth(date)}`;
}

/** "Thu 1 Oct · 14:00–16:00", and "· teaching that day" when that is asked too. */
export function describeWindow(window: FreeWindow): string {
  return `${dayWords(window.date)} · ${window.start}–${window.end}${window.teachingThatDay ? " · teaching that day" : ""}`;
}

/**
 * The Monday of the day's week when the semester has no classes that week — set in
 * Settings → Semesters — and "" otherwise. Said beside the answer rather than applied to
 * it: the registrar books no class in those weeks, so the meetings already say so, and a
 * class it did book there is on the teacher's own calendar and so counts here too.
 */
export function breakWeekOf(window: FreeWindow, calendars: TeachingCalendar[]): string {
  if (!window.date) return "";
  const monday = toIsoDate(mondayOf(parseIsoDate(window.date)));
  return calendars.some((calendar) => calendar.without.includes(monday)) ? monday : "";
}

/** "The week of 12 Oct has no classes", said once above the list rather than on every row. */
export function breakWords(monday: string): string {
  return monday ? `The week of ${formatDayAndMonth(monday)} has no classes (Settings → Semesters).` : "";
}

/** The days a portal term can have classes on, both ends counted. */
export type TermBounds = { from: string; to: string };

/**
 * When each portal term runs, as far as anything says.
 *
 * From its first class to its last in the sweep, reaching back to its Week 1 where
 * Settings → Semesters sets one; a term with a Week 1 and no classes swept yet runs from
 * that Monday on. A term with neither is left out — nothing says when it is.
 *
 * This is what lets a section with no timetable be set aside when the question is about
 * another semester: a spring CRN nobody has swept yet says nothing about a Thursday in
 * October, and treating it as a hole in the week would make half the list "unknown".
 */
export function termBounds(terms: { termCode: string; sections: FacilitySection[]; weekOne?: string }[]): Map<string, TermBounds> {
  const bounds = new Map<string, TermBounds>();
  for (const { termCode, sections, weekOne } of terms) {
    const days = sections.flatMap((section) => section.meetings.map((meeting) => meeting.meetsOn)).sort();
    const opens = weekOne ? toIsoDate(mondayOf(parseIsoDate(weekOne))) : "";
    if (days.length) {
      bounds.set(termCode, { from: opens && opens < days[0] ? opens : days[0], to: days[days.length - 1] });
    } else if (opens) {
      bounds.set(termCode, { from: opens, to: "9999-12-31" });
    }
  }
  return bounds;
}

/**
 * Whether a term can have classes on this day.
 *
 * A term nothing dates — not swept, no Week 1, or a section in a semester linked to no
 * portal term at all — could be any day the dated terms do not account for, and only those.
 */
function concerns(termCode: string, day: string, bounds: Map<string, TermBounds>): boolean {
  const known = termCode ? bounds.get(termCode) : undefined;
  if (known) return day >= known.from && day <= known.to;
  return ![...bounds.values()].some((term) => day >= term.from && day <= term.to);
}

/** One class of theirs on the day asked about. */
export type DayClass = {
  termCode: string;
  crn: string;
  code: string;
  date: string;
  start: string;
  end: string;
  room: string;
  /** Somebody else's class they stood in for. */
  standingIn: boolean;
};

/** A class of theirs that day that a note took off them. */
export type Freed = {
  crn: string;
  code: string;
  start: string;
  end: string;
  kind: "cancelled" | "covered";
  /** Who stood in, for a covered class. */
  coverName: string;
  /** Whether it would have been in the way, or was only somewhere else in their day. */
  inWindow: boolean;
};

/**
 * Why their week cannot be vouched for. The first is the teacher having no CRN at all; the
 * rest are one section each, in the words the calendar uses under its grid.
 */
export type Unknown = {
  why: "nothing" | "no-crn" | "unlinked" | "unread" | "unasked" | "gone" | "unbooked";
  crn: string;
  code: string;
};

/**
 * Free, busy, unknown — and, when the question asks for somebody teaching that day,
 * `notTeaching`: nothing in the way, and no class of theirs that day either.
 */
export type AvailabilityState = "free" | "notTeaching" | "busy" | "unknown";

export type Availability = {
  state: AvailabilityState;
  /** Their classes that run into the window. */
  clashes: DayClass[];
  /** Their other classes that day, before or after it. */
  sameDay: DayClass[];
  freed: Freed[];
  unknown: Unknown[];
};

const byTime = (a: { start: string; crn: string }, b: { start: string; crn: string }) =>
  minutesOf(a.start) - minutesOf(b.start) || a.crn.localeCompare(b.crn);

/**
 * One teacher, against one window.
 *
 * Busy wins over everything: a class we can see in the window settles it, whatever else is
 * missing. Otherwise any hole in the week that could fall on the day makes them unknown —
 * whether they teach that day is exactly what a hole cannot say either. Only a week with no
 * such hole, and at least one CRN to stand on, makes them free; and when the question asks
 * for somebody teaching that day, a class of their own that day as well.
 */
export function availabilityOf(input: {
  teacher: { id: string; fullName: string };
  /** Their week, as `teacherTimetable` builds it for their record. */
  entries: TimetableEntry[];
  /** Their live sections that no CRN has been given yet, by the portal term each falls in. */
  withoutCrn: { termCode: string; code: string }[];
  /** The sweep's answer for a section; undefined when it has not been read. */
  sectionOf: (termCode: string, crn: string) => FacilitySection | undefined;
  notes: SessionChange[];
  bounds: Map<string, TermBounds>;
  /**
   * A course-level row that parents others and is taught on no card: not a class, so the
   * sweep never asks about it, and its empty timetable is no hole in anybody's week. The
   * same rule the semester's week sets them aside by.
   */
  notAClass?: (crn: string) => boolean;
  window: FreeWindow;
}): Availability {
  const { teacher, entries, withoutCrn, sectionOf, notes, bounds, notAClass = () => false, window } = input;
  const from = minutesOf(window.start);
  const to = minutesOf(window.end);
  const said = new Map(notes.map((note) => [slotKey(note), note]));
  const isThem = (id: string, name: string) => Boolean((teacher.id && id === teacher.id) || sameTeacher(name, teacher.fullName));

  const clashes: DayClass[] = [];
  const sameDay: DayClass[] = [];
  const freed: Freed[] = [];
  const unknown: Unknown[] = [];
  const seen = new Set<string>();
  let own = 0;

  for (const entry of entries) {
    if (!entry.crn) continue;
    const key = `${entry.termCode}|${entry.crn}|${entry.standingIn ? "cover" : "own"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!entry.standingIn) own += 1;
    const section = entry.termCode ? sectionOf(entry.termCode, entry.crn) : undefined;
    const code = entry.code || section?.courseCode || "";

    // A cover is one afternoon, placed by the sweep; one it cannot place is not a hole in the week.
    if (!entry.standingIn && concerns(entry.termCode, window.date, bounds) && !notAClass(entry.crn)) {
      const why: Unknown["why"] | "" = !entry.termCode
        ? "unlinked"
        : !section
          ? "unread"
          : section.state === "unchecked"
            ? "unasked"
            : section.state === "gone"
              ? "gone"
              : section.meetings.length === 0
                ? "unbooked"
                : "";
      if (why) unknown.push({ why, crn: entry.crn, code });
    }

    for (const meeting of section?.meetings ?? []) {
      if (meeting.meetsOn !== window.date) continue;
      if (entry.onlyOn && !entry.onlyOn.includes(meeting.meetsOn)) continue;
      const start = meeting.startsAt.slice(0, 5);
      const end = meeting.endsAt.slice(0, 5);
      const inWindow = minutesOf(start) < to && from < minutesOf(end);
      const note = entry.standingIn
        ? undefined
        : said.get(slotKey({ termCode: entry.termCode, crn: entry.crn, meetsOn: meeting.meetsOn, startsAt: meeting.startsAt }));
      // Nobody was in the room, or somebody else was: the hour is not theirs.
      if (note && (note.kind === "cancelled" || !isThem(note.coverTeacherId, note.coverTeacherName))) {
        freed.push({ crn: entry.crn, code, start, end, kind: note.kind, coverName: note.coverTeacherName, inWindow });
        continue;
      }
      const held: DayClass = {
        termCode: entry.termCode,
        crn: entry.crn,
        code,
        date: meeting.meetsOn,
        start,
        end,
        room: meeting.room,
        standingIn: Boolean(entry.standingIn),
      };
      (inWindow ? clashes : sameDay).push(held);
    }
  }

  const unnumbered = new Set<string>();
  for (const section of withoutCrn) {
    const key = `${section.termCode}|${section.code}`;
    if (unnumbered.has(key) || !concerns(section.termCode, window.date, bounds)) continue;
    unnumbered.add(key);
    unknown.push({ why: "no-crn", crn: "", code: section.code });
  }
  if (own === 0) unknown.unshift({ why: "nothing", crn: "", code: "" });

  const state: AvailabilityState = clashes.length
    ? "busy"
    : unknown.length
      ? "unknown"
      : window.teachingThatDay && sameDay.length === 0
        ? "notTeaching"
        : "free";
  return {
    state,
    clashes: clashes.sort(byTime),
    sameDay: sameDay.sort(byTime),
    freed: freed.sort(byTime),
    unknown,
  };
}

/** What a state is called on the page. */
export const STATE_WORDS: Record<AvailabilityState, string> = {
  free: "Free",
  notTeaching: "Not teaching that day",
  busy: "Busy",
  unknown: "Unknown",
};

/** "ECON-101 · CRN 22001 · 14:00–16:00", short enough for a table cell. */
export function classShort(day: DayClass): string {
  const course = [day.code, `CRN ${day.crn}`].filter(Boolean).join(" · ");
  return `${day.standingIn ? "Covering " : ""}${course} · ${day.start}–${day.end}`;
}

/** The whole of it, for the hover: the day and the room too. */
export function classWords(day: DayClass): string {
  const course = [day.code, `CRN ${day.crn}`].filter(Boolean).join(" · ");
  const room = day.room ? ` · ${day.room}` : "";
  return `${day.standingIn ? "Covering " : ""}${course} · ${dayWords(day.date)} ${day.start}–${day.end}${room}`;
}

/** "ECON-101 · CRN 22001 · 14:00–16:00: cancelled". */
export function freedWords(freed: Freed): string {
  const what = freed.kind === "cancelled" ? "cancelled" : `covered by ${freed.coverName || "somebody else"}`;
  return `${[freed.code, `CRN ${freed.crn}`].filter(Boolean).join(" · ")} · ${freed.start}–${freed.end}: ${what}`;
}

/** Why one hole in the week is there, as the calendar under a teacher's record says it. */
export function unknownWords(unknown: Unknown): string {
  const which = unknown.code ? `CRN ${unknown.crn} (${unknown.code})` : `CRN ${unknown.crn}`;
  switch (unknown.why) {
    case "nothing":
      return "No section of theirs carries a CRN, so none of their classes is known.";
    case "no-crn":
      return `A section of theirs in ${unknown.code || "a course"} has no CRN yet.`;
    case "unlinked":
      return `${which} is in a semester linked to no portal term.`;
    case "unread":
      return `The portal's timetable could not be read for ${which}.`;
    case "unasked":
      return `Nobody has asked the portal about ${which} — run a portal sync.`;
    case "gone":
      return `The portal has stopped answering for ${which}.`;
    case "unbooked":
      return `The portal's timetable has no classes booked for ${which}.`;
  }
}

/** The same, in the few words a table cell has room for. */
export function unknownShort(unknown: Unknown): string {
  const which = `CRN ${unknown.crn}`;
  switch (unknown.why) {
    case "nothing":
      return "no CRN matched to them";
    case "no-crn":
      return `${unknown.code || "a section"} has no CRN yet`;
    case "unlinked":
      return `${which}: semester not linked`;
    case "unread":
      return `${which}: timetable not read`;
    case "unasked":
      return `${which}: not swept yet`;
    case "gone":
      return `${which}: portal stopped answering`;
    case "unbooked":
      return `${which}: no classes booked`;
  }
}
