/**
 * Who is free when: the teachers with no class in a stretch of time, the ones who have one
 * and with what, and the ones nobody can answer for.
 *
 * "Who could take a replacement class on Thursday at two" and "who has Tuesday mornings
 * free for the rest of the semester" are the same question at two sizes: some days, a
 * window of hours on each, and whether any class of theirs runs into it. So a one-off is
 * a range whose first and last day are the same, and nothing here treats it differently.
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

/** The stretch of time being asked about. */
export type FreeWindow = {
  /** ISO, both ends counted. The same day twice for a one-off question. */
  from: string;
  to: string;
  /** HH:MM. */
  start: string;
  end: string;
  /**
   * The weekdays that count, as `Date.getDay()` numbers; empty for every day. Only read
   * over more than one day — a single date is its own weekday.
   */
  weekdays: number[];
};

/** A year of days is the longest question worth asking; a typo in a year is not a question. */
export const MAX_DAYS = 366;

const PLURAL_DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** Monday first, Sunday last, as the week is read here. */
const weekOrder = (day: number) => (day + 6) % 7;

function nextDay(iso: string): string {
  const day = parseIsoDate(iso);
  day.setDate(day.getDate() + 1);
  return toIsoDate(day);
}

/** Every day the window covers, weekdays applied. */
export function windowDates(window: FreeWindow): string[] {
  if (!window.from || !window.to || window.to < window.from) return [];
  const only = window.from !== window.to && window.weekdays.length ? new Set(window.weekdays) : null;
  const days: string[] = [];
  for (let day = window.from, count = 0; day <= window.to && count <= MAX_DAYS; day = nextDay(day), count += 1) {
    if (!only || only.has(parseIsoDate(day).getDay())) days.push(day);
  }
  return days;
}

/** What is wrong with a window before it can be asked, in a sentence; "" when nothing is. */
export function windowProblem(window: FreeWindow): string {
  if (!window.from || !window.to) return "Choose the days.";
  if (!window.start || !window.end) return "Choose the hours.";
  if (window.to < window.from) return "The last day is before the first.";
  if (minutesOf(window.end) <= minutesOf(window.start)) return "The window has to end after it starts.";
  const span = Math.round((parseIsoDate(window.to).getTime() - parseIsoDate(window.from).getTime()) / 86_400_000);
  if (span >= MAX_DAYS) return "Ask about a year at most.";
  if (windowDates(window).length === 0) return "None of those weekdays falls between those dates.";
  return "";
}

/** "Thu 1 Oct · 14:00–16:00", "Tuesdays · 10:00–12:00 · 6 Oct – 18 Dec". */
export function describeWindow(window: FreeWindow): string {
  const hours = `${window.start}–${window.end}`;
  if (window.from === window.to) {
    return `${DAY_NAMES[parseIsoDate(window.from).getDay()]} ${formatDayAndMonth(window.from)} · ${hours}`;
  }
  const range = `${formatDayAndMonth(window.from)} – ${formatDayAndMonth(window.to)}`;
  if (!window.weekdays.length) return `${range} · ${hours}`;
  const days = [...window.weekdays].sort((a, b) => weekOrder(a) - weekOrder(b));
  const named = days.length === 1 ? PLURAL_DAYS[days[0]] : days.map((day) => DAY_NAMES[day]).join(", ");
  return `${named} · ${hours} · ${range}`;
}

/**
 * The weeks without classes the window touches, by their Monday — set in Settings →
 * Semesters. Said beside the answer rather than applied to it: the registrar books no class
 * in those weeks, so the meetings already say so, and a class it did book there is on the
 * teacher's own calendar and so counts here too.
 */
export function breakWeeks(window: FreeWindow, calendars: TeachingCalendar[]): string[] {
  const without = new Set(calendars.flatMap((calendar) => calendar.without));
  const mondays = windowDates(window).map((day) => toIsoDate(mondayOf(parseIsoDate(day))));
  return [...new Set(mondays.filter((monday) => without.has(monday)))];
}

/** "The week of 12 Oct has no classes", said once above the list rather than on every row. */
export function breakWords(mondays: string[]): string {
  if (!mondays.length) return "";
  const named = mondays.map(formatDayAndMonth);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return mondays.length === 1
    ? `The week of ${list} has no classes (Settings → Semesters).`
    : `The weeks of ${list} have no classes (Settings → Semesters).`;
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
 * Whether a term can have classes on any of these days.
 *
 * A term nothing dates — not swept, no Week 1, or a section in a semester linked to no
 * portal term at all — could be any day the dated terms do not account for, and only those.
 */
function concerns(termCode: string, days: string[], bounds: Map<string, TermBounds>): boolean {
  const known = termCode ? bounds.get(termCode) : undefined;
  if (known) return days.some((day) => day >= known.from && day <= known.to);
  const dated = [...bounds.values()];
  return days.some((day) => !dated.some((term) => day >= term.from && day <= term.to));
}

/** One class of theirs in the window: the same slot on every day it falls. */
export type Clash = {
  termCode: string;
  crn: string;
  code: string;
  start: string;
  end: string;
  /** Every day in the window it meets at that time, in order. */
  dates: string[];
  rooms: string[];
  /** Somebody else's class they stood in for, on the days they did. */
  standingIn: boolean;
};

/** A class of theirs in the window that a note took off them. */
export type Freed = {
  crn: string;
  code: string;
  date: string;
  start: string;
  end: string;
  kind: "cancelled" | "covered";
  /** Who stood in, for a covered class. */
  coverName: string;
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

export type AvailabilityState = "free" | "busy" | "unknown";

export type Availability = {
  state: AvailabilityState;
  clashes: Clash[];
  /** How many of the window's days a clash falls on, and how many days the window has. */
  busyDays: number;
  days: number;
  freed: Freed[];
  unknown: Unknown[];
};

/**
 * One teacher, against one window.
 *
 * Busy wins over unknown: a class we can see in the window settles it, whatever else is
 * missing. Otherwise any hole in the week that could fall in the window makes them unknown,
 * and only a week with no such hole — and at least one CRN to stand on — makes them free.
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
  const days = windowDates(window);
  const inWindow = new Set(days);
  const from = minutesOf(window.start);
  const to = minutesOf(window.end);
  const said = new Map(notes.map((note) => [slotKey(note), note]));
  const isThem = (id: string, name: string) => Boolean((teacher.id && id === teacher.id) || sameTeacher(name, teacher.fullName));

  const clashes = new Map<string, Clash>();
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
    if (!entry.standingIn && concerns(entry.termCode, days, bounds) && !notAClass(entry.crn)) {
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
      if (!inWindow.has(meeting.meetsOn)) continue;
      if (entry.onlyOn && !entry.onlyOn.includes(meeting.meetsOn)) continue;
      const start = meeting.startsAt.slice(0, 5);
      const end = meeting.endsAt.slice(0, 5);
      if (!(minutesOf(start) < to && from < minutesOf(end))) continue;
      const note = entry.standingIn
        ? undefined
        : said.get(slotKey({ termCode: entry.termCode, crn: entry.crn, meetsOn: meeting.meetsOn, startsAt: meeting.startsAt }));
      // Nobody was in the room, or somebody else was: the hour is not theirs.
      if (note && (note.kind === "cancelled" || !isThem(note.coverTeacherId, note.coverTeacherName))) {
        freed.push({ crn: entry.crn, code, date: meeting.meetsOn, start, end, kind: note.kind, coverName: note.coverTeacherName });
        continue;
      }
      const slot = `${entry.termCode}|${entry.crn}|${parseIsoDate(meeting.meetsOn).getDay()}|${start}|${end}|${entry.standingIn ? 1 : 0}`;
      const held = clashes.get(slot) ?? {
        termCode: entry.termCode,
        crn: entry.crn,
        code,
        start,
        end,
        dates: [],
        rooms: [],
        standingIn: Boolean(entry.standingIn),
      };
      if (!held.dates.includes(meeting.meetsOn)) held.dates.push(meeting.meetsOn);
      if (meeting.room && !held.rooms.includes(meeting.room)) held.rooms.push(meeting.room);
      clashes.set(slot, held);
    }
  }

  const unnumbered = new Set<string>();
  for (const section of withoutCrn) {
    const key = `${section.termCode}|${section.code}`;
    if (unnumbered.has(key) || !concerns(section.termCode, days, bounds)) continue;
    unnumbered.add(key);
    unknown.push({ why: "no-crn", crn: "", code: section.code });
  }
  if (own === 0) unknown.unshift({ why: "nothing", crn: "", code: "" });

  const ordered = [...clashes.values()]
    .map((clash) => ({ ...clash, dates: [...clash.dates].sort() }))
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || minutesOf(a.start) - minutesOf(b.start) || a.crn.localeCompare(b.crn));
  const busyDays = new Set(ordered.flatMap((clash) => clash.dates)).size;
  return {
    state: ordered.length ? "busy" : unknown.length ? "unknown" : "free",
    clashes: ordered,
    busyDays,
    days: days.length,
    freed: freed.sort((a, b) => a.date.localeCompare(b.date) || minutesOf(a.start) - minutesOf(b.start)),
    unknown,
  };
}

/** What a state is called on the page. */
export const STATE_WORDS: Record<AvailabilityState, string> = { free: "Free", busy: "Busy", unknown: "Unknown" };

/** "Thu 1 Oct" for one day; "Tue" for a class that meets on several of them. */
function whenWords(clash: Clash): string {
  const day = parseIsoDate(clash.dates[0]);
  return clash.dates.length === 1 ? `${DAY_NAMES[day.getDay()]} ${formatDayAndMonth(clash.dates[0])}` : DAY_NAMES[day.getDay()];
}

/** "ECON-101 · CRN 22001 · Tue 10:00–12:00", short enough for a table cell. */
export function clashShort(clash: Clash): string {
  const course = [clash.code, `CRN ${clash.crn}`].filter(Boolean).join(" · ");
  return `${clash.standingIn ? "Covering " : ""}${course} · ${whenWords(clash)} ${clash.start}–${clash.end}`;
}

/** The whole of it, for the hover: the rooms, and the days when there are several. */
export function clashWords(clash: Clash): string {
  const rooms = clash.rooms.length ? ` · ${clash.rooms.join(", ")}` : "";
  if (clash.dates.length === 1) return `${clashShort(clash)}${rooms}`;
  const first = formatDayAndMonth(clash.dates[0]);
  const last = formatDayAndMonth(clash.dates[clash.dates.length - 1]);
  return `${clashShort(clash)} · ${clash.dates.length} days, ${first} – ${last}${rooms}`;
}

/** "ECON-101 · CRN 22001 · Tue 6 Oct 10:00–12:00: cancelled". */
export function freedWords(freed: Freed): string {
  const day = parseIsoDate(freed.date);
  const when = `${DAY_NAMES[day.getDay()]} ${formatDayAndMonth(freed.date)} ${freed.start}–${freed.end}`;
  const what = freed.kind === "cancelled" ? "cancelled" : `covered by ${freed.coverName || "somebody else"}`;
  return `${[freed.code, `CRN ${freed.crn}`].filter(Boolean).join(" · ")} · ${when}: ${what}`;
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
