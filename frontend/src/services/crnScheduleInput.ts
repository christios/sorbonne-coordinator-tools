/**
 * What a schedule PDF is drawn from, gathered for any set of CRNs.
 *
 * The CRN record has one CRN's meetings in hand already; Active CRNs has only the rows the
 * coordinator ticked, so it asks for the rest here — the portal's meetings for those CRNs,
 * the department's notes on them, and the semester each belongs to — and hands the PDF one
 * grid's worth of sections.
 */

import type { ScheduleInput } from "@/services/crnSchedulePdf";
import type { ActiveCrn, FacilityTimetable } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";

export type ScheduleReads = {
  sections: (termCode: string, crns: string[]) => Promise<FacilityTimetable>;
  notes: (termCode: string) => Promise<SessionChange[]>;
  /** Student Hub semester id → portal term code. */
  links: () => Promise<Record<string, string>>;
  /** Student Hub semester id → any day of its Week 1. */
  weeks: () => Promise<Record<string, string>>;
  /** Student Hub semester id → its name. */
  semesterNames: () => Promise<Record<string, string>>;
  /** CRN → the group of ours it teaches, off the course cards: "CM Mathematics". */
  groups: () => Promise<Map<string, string>>;
};

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
    read.weeks().catch(() => ({}) as Record<string, string>),
    read.semesterNames().catch(() => ({}) as Record<string, string>),
    read.groups().catch(() => new Map<string, string>()),
  ]);
  const byTerm = new Map(
    await Promise.all(
      termCodes.map(async (termCode) => {
        const crns = ordered.filter((row) => row.termCode === termCode).map((row) => row.crn);
        const [sweep, notes] = await Promise.all([read.sections(termCode, crns), read.notes(termCode).catch(() => [])]);
        return [termCode, { sweep, notes }] as const;
      }),
    ),
  );
  const only = termCodes.length === 1 ? termCodes[0] : "";
  const semesterId = only ? (Object.entries(links).find(([, code]) => code === only)?.[0] ?? "") : "";
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
        title: row.courseTitle || row.portalTitle,
        teacher: section?.teacherName || row.teacherName,
        group: groups.get(row.crn) ?? "",
        meetings: section?.meetings ?? [],
        notes: (held?.notes ?? []).filter((note) => note.crn === row.crn),
      };
    }),
  };
}
