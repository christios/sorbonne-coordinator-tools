/**
 * What a section's classes used to be and what they are now, laid out as months.
 *
 * The registrar deleted most of a course's classes and the number on the page went down
 * by twenty hours without saying so. A number cannot show this: the shape is the evidence.
 * Three classes left standing in September, October and November is not a course being
 * taught, and anybody looking at a month with one square in it can see that, where "6 h"
 * beside "26 h" reads as a disagreement about hours.
 *
 * So: a grid per month the section touches, Monday first, with the classes still standing,
 * the ones that have gone and the ones that have arrived in the same squares. All three,
 * deliberately. A diff that showed only what was lost would leave the reader counting
 * backwards to work out what is left, and would read a class moved to Thursday as an
 * hour and a half of teaching that simply stopped.
 *
 * Pure. The dates come from the registrar and the grid is the part that has to be right.
 */

export type Meeting = { meetsOn: string; startsAt: string; endsAt: string; room: string; weCancelled?: boolean };

/**
 * The changes nobody has approved yet, which is what the banner counts.
 *
 * Keyed on the changed classes rather than on the section, so an approval lasts exactly
 * as long as the fact it was about: one more class going or arriving changes the key,
 * stops the old approval matching, and asks again.
 */
export function stillToLookAt<T extends { key: string }>(sections: T[], approved: Map<string, unknown>): T[] {
  return sections.filter((section) => !approved.has(section.key));
}

export type DiffDay = {
  /** ISO, as the registrar wrote it. */
  day: string;
  dayOfMonth: number;
  kept: Meeting[];
  removed: Meeting[];
  added: Meeting[];
};

export type DiffMonth = {
  /** "September 2026". */
  label: string;
  /** Seven per week, Monday first; null where the month has not started or has ended. */
  days: (DiffDay | null)[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parse(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const made = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(made.getTime()) ? null : made;
}

/** Monday is 0, because a teaching week starts on Monday and Sunday is the far edge. */
function mondayFirst(value: Date): number {
  return (value.getDay() + 6) % 7;
}

function asDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${date}`;
}

/** How long a class runs, in minutes. Zero where either end is unreadable. */
export function minutesOf(meeting: Meeting): number {
  const from = /^(\d{1,2}):(\d{2})$/.exec(meeting.startsAt.trim());
  const to = /^(\d{1,2}):(\d{2})$/.exec(meeting.endsAt.trim());
  if (!from || !to) return 0;
  const start = Number(from[1]) * 60 + Number(from[2]);
  const end = Number(to[1]) * 60 + Number(to[2]);
  return Math.max(0, end - start);
}

/** The ones that are news: what the department had not already cancelled itself. */
export function unexpected(meetings: Meeting[]): Meeting[] {
  return meetings.filter((meeting) => !meeting.weCancelled);
}

/** Hours in a set of classes, to the quarter — the unit a time sheet is read in. */
export function hoursIn(meetings: Meeting[]): number {
  const minutes = meetings.reduce((sum, meeting) => sum + minutesOf(meeting), 0);
  return Math.round((minutes / 60) * 4) / 4;
}

/**
 * Every month of the semester, with the section's classes in place.
 *
 * Empty months are drawn too, from `span` — the semester, from its first week to its last
 * class. A TD that only starts in October read, drawn from October, as a section with
 * nothing wrong before it; drawn from September, the empty month says it. And every
 * section in the list is laid against the same months, so they read side by side. Without
 * a span, the months the section touches.
 *
 * Three lists, because three things can be true of a class: gone, still there, or newly
 * arrived. They are kept apart all the way to the square, so a day that both kept a class
 * and gained one can say so instead of picking a side.
 */
export function monthsOfDiff(
  kept: Meeting[],
  removed: Meeting[],
  added: Meeting[] = [],
  span?: { from: string; to: string },
): DiffMonth[] {
  const days = new Map<string, DiffDay>();
  const note = (meeting: Meeting, into: "kept" | "removed" | "added") => {
    const when = parse(meeting.meetsOn);
    if (!when) return;
    const day = days.get(meeting.meetsOn) ?? {
      day: meeting.meetsOn,
      dayOfMonth: when.getDate(),
      kept: [],
      removed: [],
      added: [],
    };
    day[into].push(meeting);
    days.set(meeting.meetsOn, day);
  };
  for (const meeting of kept) note(meeting, "kept");
  for (const meeting of removed) note(meeting, "removed");
  for (const meeting of added) note(meeting, "added");
  if (days.size === 0 && !span) return [];

  // The first of every month to draw: the span's, and any the section reaches outside it.
  const firsts = new Set<string>();
  const firstOf = (value: Date) => asDay(new Date(value.getFullYear(), value.getMonth(), 1));
  const [from, to] = [span && parse(span.from), span && parse(span.to)];
  if (from && to && from <= to) {
    for (let at = new Date(from.getFullYear(), from.getMonth(), 1); at <= to; at = new Date(at.getFullYear(), at.getMonth() + 1, 1)) {
      firsts.add(firstOf(at));
    }
  }
  for (const day of days.keys()) {
    const when = parse(day);
    if (when) firsts.add(firstOf(when));
  }

  return [...firsts].sort().map((first) => {
    const when = parse(first)!;
    const last = new Date(when.getFullYear(), when.getMonth() + 1, 0);
    const cells: (DiffDay | null)[] = Array.from({ length: mondayFirst(when) }, () => null);
    for (let date = 1; date <= last.getDate(); date += 1) {
      const on = asDay(new Date(when.getFullYear(), when.getMonth(), date));
      cells.push(days.get(on) ?? { day: on, dayOfMonth: date, kept: [], removed: [], added: [] });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return { label: `${MONTHS[when.getMonth()]} ${when.getFullYear()}`, days: cells };
  });
}
