/**
 * A record's calendar as a timetable PDF: the same entries the record draws, read into the
 * shape the CRN schedule is printed from.
 *
 * A teacher's week and a student's are not a list of CRNs someone ticked. They are built —
 * the sections our planning gives them, what the portal staffs or registers them in, the
 * afternoons a teacher stood in for somebody — and the record already knows how. Handing
 * the PDF those same entries means the file can never show a different week from the one
 * on screen.
 */

import type { TimetableEntry } from "@/components/SectionTimetable";
import type { ScheduleInput, ScheduleNote, ScheduleSection } from "@/services/crnSchedulePdf";
import type { ScheduleReads } from "@/services/crnScheduleInput";

/** What a heading says: whose timetable, and what they are. */
export type ScheduleHeading = { title: string; subtitle?: string };

/**
 * One person's — or one course's — entries as one timetable.
 *
 * A cover is drawn on the dates it happened and no others, marked as covered by whoever
 * stood in. A section the registrar has no meetings for is in the legend and nowhere on
 * the grid, as on the CRN schedule. The semester is named, and its weeks numbered, only
 * when every entry is of one term.
 */
export async function scheduleFromEntries(
  entries: TimetableEntry[],
  heading: ScheduleHeading,
  read: Pick<ScheduleReads, "sections" | "notes" | "links" | "weeks" | "semesterNames">,
  standIn = "",
): Promise<ScheduleInput> {
  const wanted = entries.filter((entry) => entry.crn && entry.termCode);
  const termCodes = [...new Set(wanted.map((entry) => entry.termCode))].sort();
  const [links, weeks, names] = await Promise.all([
    read.links().catch(() => ({}) as Record<string, string>),
    read.weeks().catch(() => ({}) as Record<string, string>),
    read.semesterNames().catch(() => ({}) as Record<string, string>),
  ]);
  const byTerm = new Map(
    await Promise.all(
      termCodes.map(async (termCode) => {
        const crns = [...new Set(wanted.filter((entry) => entry.termCode === termCode).map((entry) => entry.crn))].sort();
        const [sweep, notes] = await Promise.all([read.sections(termCode, crns), read.notes(termCode).catch(() => [])]);
        return [termCode, { sweep, notes }] as const;
      }),
    ),
  );
  const only = termCodes.length === 1 ? termCodes[0] : "";
  const semesterId = only ? (Object.entries(links).find(([, code]) => code === only)?.[0] ?? "") : "";
  const swept = [...byTerm.values()].map((entry) => entry.sweep.pulledAt ?? "").filter(Boolean).sort();
  const semester = only ? (semesterId && names[semesterId]) || `Term ${only}` : "";

  const seen = new Set<string>();
  const sections: ScheduleSection[] = [];
  for (const entry of [...wanted].sort((a, b) => (a.code || "").localeCompare(b.code || "") || a.crn.localeCompare(b.crn))) {
    const key = `${entry.termCode}|${entry.crn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const held = byTerm.get(entry.termCode);
    const section = held?.sweep.sections.find((candidate) => candidate.crn === entry.crn);
    const meetings = (section?.meetings ?? []).filter((meeting) => !entry.onlyOn || entry.onlyOn.includes(meeting.meetsOn));
    const said: ScheduleNote[] = (held?.notes ?? [])
      .filter((note) => note.crn === entry.crn)
      .map((note) => ({ meetsOn: note.meetsOn, startsAt: note.startsAt, kind: note.kind, coverTeacherName: note.coverTeacherName, note: note.note }));
    // Somebody else's class they stood in for: every date drawn is one they covered.
    const notes: ScheduleNote[] = entry.standingIn
      ? meetings.map((meeting) => ({
          meetsOn: meeting.meetsOn,
          startsAt: meeting.startsAt,
          kind: "covered" as const,
          coverTeacherName: standIn || heading.title,
          note: said.find((note) => note.meetsOn === meeting.meetsOn)?.note ?? "",
        }))
      : said;
    sections.push({
      crn: entry.crn,
      courseCode: entry.code || section?.courseCode || "",
      title: entry.title || section?.title || "",
      teacher: entry.staff || section?.teacherName || "",
      group: entry.group ?? "",
      meetings,
      notes,
    });
  }
  return {
    title: heading.title,
    subtitle: [heading.subtitle, semester].filter(Boolean).join("   ·   "),
    semester,
    weekOne: semesterId ? weeks[semesterId] : undefined,
    sweptAt: swept[swept.length - 1],
    sections,
  };
}

/** "Grace-Younes-timetable.pdf" for one; "timetables-4-teachers.pdf" for several. */
export function timetablesFilename(names: string[], noun: string): string {
  if (names.length === 1) return `${names[0].replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "timetable"}-timetable.pdf`;
  return `timetables-${names.length}-${noun}.pdf`;
}
