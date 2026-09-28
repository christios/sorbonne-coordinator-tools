/**
 * Several people's timetables as one PDF, drawn like a CRN's schedule: the teachers ticked
 * on a list together on one grid, the students ticked each on pages of their own.
 *
 * Their weeks are built exactly as their records build them (services/personTimetable),
 * from what the lists share — the course cards, the register, the notes on the classes —
 * read once for everybody rather than once a person, and from the cache wherever a page
 * has read it already.
 */

import type { QueryClient } from "@tanstack/react-query";

import { downloadSchedulePdf, type ScheduleInput } from "@/services/crnSchedulePdf";
import { scheduleInputFor, type ScheduleReads } from "@/services/crnScheduleInput";
import { buildCards, groupNamesByCrn } from "@/services/courseCards";
import { scheduleFromEntries, timetablesFilename } from "@/services/entrySchedule";
import { mergedTeacherTimetable, placementsOf, studentTimetable, teacherTimetable } from "@/services/personTimetable";
import {
  fetchActiveCourses,
  fetchActiveCrns,
  fetchFacilitySections,
  fetchRegistrations,
  fetchTermLinks,
  type ActiveCrn,
  type Registration,
} from "@/services/portalLists";
import { fetchSessionChanges } from "@/services/sessionChanges";
import {
  fetchAssignmentMajors,
  fetchAssignments,
  fetchCatalogue,
  fetchCourseCards,
  fetchExemptions,
} from "@/services/studentDatabase";
import { fetchTermWeeks } from "@/services/termWeeks";
import { fetchTimetableTerms } from "@/services/timetables";

/** What a schedule is read from, through the cache the pages share. */
export function scheduleReads(client: QueryClient): ScheduleReads {
  return {
    sections: (termCode, crns) => fetchFacilitySections(termCode, crns),
    notes: (termCode) => client.fetchQuery({ queryKey: ["session-changes", termCode], queryFn: () => fetchSessionChanges(termCode) }),
    links: () => client.fetchQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks }),
    weeks: () => client.fetchQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks }),
    semesterNames: async () =>
      Object.fromEntries(
        (await client.fetchQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms })).map((term) => [term.id, term.name]),
      ),
    groups: async () => groupNamesByCrn(await client.fetchQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards })),
  };
}

/** Who had nothing to draw, so the page can say so rather than hand over blank pages silently. */
export type ExportOutcome = { people: number; withoutClasses: string[] };

async function download(inputs: ScheduleInput[], names: string[], noun: string): Promise<ExportOutcome> {
  const withoutClasses = inputs
    .filter((input) => input.sections.every((section) => section.meetings.length === 0))
    .map((input) => input.title ?? "");
  if (withoutClasses.length === inputs.length) {
    throw new Error(
      inputs.length === 1
        ? "The portal has booked no classes for them — run a portal sync if that is new."
        : "The portal has booked no classes for any of them — run a portal sync if that is new.",
    );
  }
  await downloadSchedulePdf(inputs, timetablesFilename(names, noun));
  return { people: inputs.length, withoutClasses };
}

/**
 * CRNs on one grid — one CRN's schedule, a course's, or a ticked handful on Active CRNs.
 * `heading` names it where the CRNs alone would not: "MATH-351 · Algebra" for a course.
 */
export async function exportCrnTimetable(
  client: QueryClient,
  rows: ActiveCrn[],
  heading?: { title: string; subtitle?: string; filename?: string },
): Promise<ExportOutcome> {
  const input = await scheduleInputFor(rows, scheduleReads(client));
  const withoutClasses = input.sections.filter((section) => section.meetings.length === 0).map((section) => section.crn);
  if (withoutClasses.length === input.sections.length) {
    throw new Error("The portal has booked no classes for these CRNs — run a portal sync if that is new.");
  }
  await downloadSchedulePdf(
    heading
      ? { ...input, title: heading.title, subtitle: [heading.subtitle, input.semester].filter(Boolean).join("   ·   ") }
      : input,
    heading?.filename,
  );
  return { people: 1, withoutClasses };
}

/** Somebody whose teaching is wanted: their id on the department's list where they have one. */
export type TeacherWanted = { id: string; fullName: string };

/**
 * The teachers' weeks on one grid — their sections, what the portal staffs them on, what
 * they covered — each box naming whose class it is. One teacher is their own week, as
 * their record draws it.
 */
export async function exportTeacherTimetables(client: QueryClient, teachers: TeacherWanted[]): Promise<ExportOutcome> {
  const read = scheduleReads(client);
  const [catalogues, terms, courses, registered, links] = await Promise.all([
    client.fetchQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards }),
    client.fetchQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms }).catch(() => []),
    client.fetchQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses }),
    client.fetchQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() }),
    read.links().catch(() => ({}) as Record<string, string>),
  ]);
  const termName = (id: string) => terms.find((term) => term.id === id)?.name ?? "";
  const parentOf = new Map(registered.filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn]));
  const cards = buildCards(catalogues, termName, courses, parentOf);
  // Every linked term's notes: a cover can be in a semester they teach nothing else in.
  const notes = (
    await Promise.all([...new Set(Object.values(links).filter(Boolean))].map((termCode) => read.notes(termCode).catch(() => [])))
  ).flat();
  const ordered = [...teachers].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const weeks = ordered.map((teacher) => ({ teacher, entries: teacherTimetable({ cards, links, registered, notes, teacher }) }));
  const names = ordered.map((teacher) => teacher.fullName);
  const one = ordered.length === 1;
  const input = await scheduleFromEntries(
    one ? weeks[0].entries : mergedTeacherTimetable(weeks),
    one ? { title: names[0], subtitle: "Teacher" } : { title: names.join(", "), subtitle: `${names.length} teachers` },
    read,
    one ? names[0] : "",
  );
  // Who has nothing on the grid: none of their CRNs has a class the portal booked.
  const booked = new Set(input.sections.filter((section) => section.meetings.length).map((section) => section.crn));
  const withoutClasses = weeks.filter(({ entries }) => !entries.some((entry) => booked.has(entry.crn))).map(({ teacher }) => teacher.fullName);
  if (withoutClasses.length === ordered.length) {
    throw new Error(
      one
        ? "The portal has booked no classes for them — run a portal sync if that is new."
        : "The portal has booked no classes for any of them — run a portal sync if that is new.",
    );
  }
  await downloadSchedulePdf(input, timetablesFilename(names, "teachers"));
  return { people: ordered.length, withoutClasses };
}

/** Somebody whose week is wanted: their id, the name this browser holds, and their cohort. */
export type StudentWanted = { studentId: string; name: string; cohortId: string | null; cohortName?: string };

/** Each student's week — their groups' sections, and whatever else the registrar has them in. */
export async function exportStudentTimetables(client: QueryClient, students: StudentWanted[]): Promise<ExportOutcome> {
  const read = scheduleReads(client);
  const links = await read.links().catch(() => ({}) as Record<string, string>);
  const cohortIds = [...new Set(students.map((student) => student.cohortId).filter((id): id is string => Boolean(id)))];
  const cohorts = new Map(
    await Promise.all(
      cohortIds.map(async (cohortId) => {
        const [catalogue, assignments, majors, exemptions] = await Promise.all([
          client.fetchQuery({ queryKey: ["catalogue", cohortId, ""], queryFn: () => fetchCatalogue(cohortId, undefined) }),
          client.fetchQuery({ queryKey: ["assignments", cohortId], queryFn: () => fetchAssignments(cohortId) }),
          client.fetchQuery({ queryKey: ["assignment-majors", cohortId], queryFn: () => fetchAssignmentMajors(cohortId) }),
          client.fetchQuery({ queryKey: ["exemptions", cohortId], queryFn: () => fetchExemptions(cohortId) }),
        ]);
        return [cohortId, { catalogue, assignments, majors, exemptions }] as const;
      }),
    ),
  );
  // A handful at a time: a year group is a hundred students, and a hundred requests at once
  // is the portal's own sweep all over again.
  const registrations = new Map<string, Registration[]>();
  for (let from = 0; from < students.length; from += 8) {
    const batch = students.slice(from, from + 8);
    const answers = await Promise.all(
      batch.map((student) =>
        client
          .fetchQuery({ queryKey: ["registrations", student.studentId], queryFn: () => fetchRegistrations(student.studentId) })
          .catch(() => [] as Registration[]),
      ),
    );
    batch.forEach((student, index) => registrations.set(student.studentId, answers[index]));
  }
  const ordered = [...students].sort((a, b) => (a.name || a.studentId).localeCompare(b.name || b.studentId));
  const inputs = await Promise.all(
    ordered.map((student) => {
      const theirs = student.cohortId ? cohorts.get(student.cohortId) : undefined;
      const placements = theirs
        ? placementsOf(theirs.catalogue.scopes, theirs.assignments[student.studentId] ?? {}, theirs.majors[student.studentId] ?? {})
        : [];
      const excused = new Set(
        (theirs?.exemptions ?? []).filter((entry) => entry.studentId === student.studentId).map((entry) => entry.courseId),
      );
      const entries = studentTimetable({ placements, excused, links, registrations: registrations.get(student.studentId) ?? [] });
      return scheduleFromEntries(
        entries,
        { title: student.name || student.studentId, subtitle: [student.studentId, student.cohortName].filter(Boolean).join(" · ") },
        read,
      );
    }),
  );
  return download(inputs, ordered.map((student) => student.name || student.studentId), "students");
}
