/**
 * What a teacher actually stood in front of a class for, between two dates.
 *
 * Teacher hours answers a different question: how much somebody is carrying this
 * semester, counted from the hours typed on each section. That number is a plan, it has
 * no dates inside it, and it is the right answer for "is anybody teaching too much".
 *
 * A claim is not a plan. A part-time teacher is paid for the periods they taught in, and
 * what they taught is three things the semester figure cannot see: which dates the class
 * actually met on, which of those were cancelled, and which somebody else stood in for.
 * So this counts meetings rather than dividing a total — the registrar's own dated
 * meetings, the notes written against them, and nothing else.
 *
 * An hour belongs to whoever was in the room. A class somebody covered is theirs for that
 * date and not the usual teacher's, which is the one rule that moves hours between two
 * people and the reason a claim cannot be worked out from the timetable alone.
 *
 * A note whose class the registrar has since moved is handed back rather than dropped: it
 * is a decision somebody took about an hour that no longer exists, and silently ignoring
 * it would take an hour off a claim with nothing said.
 */

import type { FacilitySection } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";
import { minutesOf } from "@/services/weekSchedule";

/** Inclusive, both ends: a period is a run of days, and the last one counts. */
export type Period = { from: string; to: string };

/** One meeting that happened, and whose hour it was. */
export type TaughtHour = {
  crn: string;
  courseCode: string;
  meetsOn: string;
  startsAt: string;
  endsAt: string;
  minutes: number;
  /** Empty where nobody has been chosen for the section and nobody stood in. */
  teacherId: string;
  teacherName: string;
  /** Somebody stood in: the hour is theirs, and not the section's own teacher's. */
  covered: boolean;
};

export type HoursRead = {
  hours: TaughtHour[];
  /** Notes about a class the registrar no longer has at that hour. */
  stranded: SessionChange[];
};

/** `23644|2026-10-02|08:30` — a slot, which is what a note is written against. */
function slotOf(crn: string, meetsOn: string, startsAt: string): string {
  return `${crn}|${meetsOn}|${startsAt.slice(0, 5)}`;
}

function within(day: string, period: Period): boolean {
  return day >= period.from && day <= period.to;
}

/**
 * The hours taught in a period, meeting by meeting.
 *
 * `staffing` says who a section's teacher is — ours, the one somebody chose, rather than
 * the name the registrar's row happens to carry. A section nobody has staffed still
 * yields its meetings, with no teacher on them, because an hour nobody is claiming is
 * still an hour that was taught and is worth seeing.
 */
export function hoursTaught(input: {
  sections: FacilitySection[];
  changes: SessionChange[];
  period: Period;
  staffing: (crn: string) => { id: string; name: string };
}): HoursRead {
  const { sections, changes, period, staffing } = input;
  const noteBySlot = new Map<string, SessionChange>();
  for (const change of changes) noteBySlot.set(slotOf(change.crn, change.meetsOn, change.startsAt), change);

  const hours: TaughtHour[] = [];
  const used = new Set<string>();
  for (const section of sections) {
    for (const meeting of section.meetings) {
      const slot = slotOf(section.crn, meeting.meetsOn, meeting.startsAt);
      const note = noteBySlot.get(slot);
      if (note) used.add(slot);
      if (!within(meeting.meetsOn, period)) continue;
      // Cancelled is not a shorter class, it is no class: nobody was in the room.
      if (note?.kind === "cancelled") continue;
      const usual = staffing(section.crn);
      const covered = note?.kind === "covered";
      hours.push({
        crn: section.crn,
        courseCode: section.courseCode,
        meetsOn: meeting.meetsOn,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        minutes: Math.max(0, minutesOf(meeting.endsAt) - minutesOf(meeting.startsAt)),
        teacherId: covered ? note.coverTeacherId : usual.id,
        teacherName: covered ? note.coverTeacherName : usual.name,
        covered,
      });
    }
  }

  const stranded = changes.filter(
    (change) =>
      within(change.meetsOn, period) && !used.has(slotOf(change.crn, change.meetsOn, change.startsAt)),
  );
  return { hours: hours.sort((left, right) => left.meetsOn.localeCompare(right.meetsOn)), stranded };
}

/** Minutes each person taught, by the id they are chosen under. Unstaffed hours key on "". */
export function minutesByTeacher(hours: TaughtHour[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const hour of hours) total[hour.teacherId] = (total[hour.teacherId] ?? 0) + hour.minutes;
  return total;
}

/**
 * Minutes as the hours a claim is written in, to a quarter.
 *
 * A class is an hour and a half or two hours; nothing here is paid in minutes, and a
 * figure like 22.5 is what goes on a time sheet. Rounded to the quarter so a sweep that
 * records 89 minutes does not turn into 1.4833 hours on a claim.
 */
export function asHours(minutes: number): number {
  return Math.round((minutes / 60) * 4) / 4;
}
