/**
 * What a schedule PDF is drawn from, gathered for any set of CRNs.
 *
 * The CRN record has one CRN's meetings in hand already; Active CRNs has only the rows the
 * coordinator ticked, so it asks for the rest here — the portal's meetings for those CRNs,
 * the department's notes on them, and the semester each belongs to — and hands the PDF one
 * grid's worth of sections.
 */

import type { ScheduleInput } from "@/services/crnSchedulePdf";
import type { ActiveCrn, ChangedClasses, ClassLink, FacilityTimetable } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";
import { semesterOf, type TermCalendars } from "@/services/termWeeks";

export type ScheduleReads = {
  sections: (termCode: string, crns: string[]) => Promise<FacilityTimetable>;
  notes: (termCode: string) => Promise<SessionChange[]>;
  /** Student Hub semester id → portal term code. */
  links: () => Promise<Record<string, string>>;
  /** Student Hub semester id → any day of its Week 1. */
  weeks: () => Promise<TermCalendars>;
  /** Student Hub semester id → its name. */
  semesterNames: () => Promise<Record<string, string>>;
  /** CRN → the group of ours it teaches, off the course cards: "CM Mathematics". */
  groups: () => Promise<Map<string, string>>;
  /**
   * What the registrar changed in a term's sections since each was first seen — given only
   * where the export was asked to show Portal changes.
   */
  changes?: (termCode: string) => Promise<ChangedClasses[]>;
  /** The removed classes coordinators linked to the classes they were rescheduled into. */
  moves?: (termCode: string) => Promise<ClassLink[]>;
};

/** A section's links, as the PDF says them: only those that still match the timetable. */
export function movesOf(links: ClassLink[], crn: string) {
  const mine = links.filter((link) => link.crn === crn && link.matches);
  return mine.length ? { moves: mine.map(({ from, to }) => ({ from, to })) } : {};
}

/** A section's removed and added classes, for the PDF, out of what the registrar changed. */
export function changesOf(changed: ChangedClasses[], crn: string, onlyOn?: string[]) {
  const section = changed.find((entry) => entry.crn === crn);
  if (!section) return {};
  const kept = (meeting: { meetsOn: string }) => !onlyOn || onlyOn.includes(meeting.meetsOn);
  return {
    removed: section.removed.filter(kept).map(({ meetsOn, startsAt, endsAt, room }) => ({ meetsOn, startsAt, endsAt, room })),
    added: section.added.filter(kept),
  };
}

/**
 * One grid's worth of sections for these CRNs, in course order.
 *
 * The semester is named, and the weeks numbered, only when every CRN is of one semester:
 * two semesters on one grid have no one Week 1 to count from. A name that cannot be read
 * falls back to the portal's term code rather than stopping the export, and groups that
 * cannot be read leave the boxes without them.
 */
export async function scheduleInputFor(rows: ActiveCrn[], read: ScheduleReads): Promise<ScheduleInput> {
  const ordered = [...rows].sort(
    (left, right) => left.courseCode.localeCompare(right.courseCode) || left.crn.localeCompare(right.crn),
  );
  const termCodes = [...new Set(ordered.map((row) => row.termCode).filter(Boolean))];
  const [links, weeks, names, groups] = await Promise.all([
    read.links().catch(() => ({}) as Record<string, string>),
    read.weeks().catch(() => ({}) as TermCalendars),
    read.semesterNames().catch(() => ({}) as Record<string, string>),
    read.groups().catch(() => new Map<string, string>()),
  ]);
  const byTerm = new Map(
    await Promise.all(
      termCodes.map(async (termCode) => {
        const crns = ordered.filter((row) => row.termCode === termCode).map((row) => row.crn);
        const [sweep, notes, changed, moves] = await Promise.all([
          read.sections(termCode, crns),
          read.notes(termCode).catch(() => []),
          read.changes ? read.changes(termCode).catch(() => []) : Promise.resolve([]),
          read.moves ? read.moves(termCode).catch(() => []) : Promise.resolve([]),
        ]);
        return [termCode, { sweep, notes, changed, moves }] as const;
      }),
    ),
  );
  const only = termCodes.length === 1 ? termCodes[0] : "";
  // Several semesters may be linked to one term; the one that says where its Week 1 is.
  const semesterId = only ? semesterOf(only, links, weeks) : "";
  const swept = [...byTerm.values()].map((entry) => entry.sweep.pulledAt ?? "").filter(Boolean).sort();
  return {
    semester: only ? (semesterId && names[semesterId]) || `Term ${only}` : "",
    weekOne: semesterId ? weeks[semesterId] : undefined,
    sweptAt: swept[swept.length - 1],
    sections: ordered.map((row) => {
      const held = byTerm.get(row.termCode);
      const section = held?.sweep.sections.find((entry) => entry.crn === row.crn);
      return {
        crn: row.crn,
        courseCode: row.courseCode,
        // The portal's current title for the section first; the register's copy can lag.
        title: section?.title || row.portalTitle || row.courseTitle,
        teacher: section?.teacherName || row.teacherName,
        group: groups.get(row.crn) ?? "",
        meetings: section?.meetings ?? [],
        notes: (held?.notes ?? []).filter((note) => note.crn === row.crn),
        ...changesOf(held?.changed ?? [], row.crn),
        ...movesOf(held?.moves ?? [], row.crn),
      };
    }),
  };
}
