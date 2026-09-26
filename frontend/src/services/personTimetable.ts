/**
 * Whose week is whose: the classes a teacher's calendar and a student's calendar draw.
 *
 * Each record built its own, in the component, out of the queries it had open. The
 * timetable export needs the same weeks for a dozen people at once without opening a
 * dozen records, so the building lives here and both the records and the export call it —
 * one week per person, whichever way it is asked for.
 */

import type { TimetableEntry } from "@/components/SectionTimetable";
import { subRowLabel, type Card } from "@/services/courseCards";
import type { ActiveCrn, Registration } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";
import { partsOf, sectionFor, type CatalogueGroup, type CatalogueMajor, type CatalogueScope } from "@/services/studentDatabase";
import { sameTeacher, sectionsTaughtBy } from "@/services/teacherLoad";

/** A group a student holds in one set, and the CRNs it comes to for them. */
export type Placement = {
  scope: CatalogueScope;
  group: CatalogueGroup | undefined;
  major: CatalogueMajor | null;
  crns: { courseId: string; courseCode: string; courseName: string; crn: string }[];
};

/**
 * Their groups, set by set, with the CRNs each comes to.
 *
 * One line per PART, not per course. A course handed from one professor to another at
 * mid-semester is taught under a CRN per half, and both are this student's. And what THEIR
 * sub-row comes to: a course the sub-row is not taught is no line at all.
 */
export function placementsOf(
  scopes: CatalogueScope[],
  held: Record<string, string>,
  onSubRow: Record<string, string>,
): Placement[] {
  return scopes
    .filter((scope) => held[scope.id])
    .map((scope) => {
      const group = scope.groups.find((candidate) => candidate.id === held[scope.id]);
      const majorId = onSubRow[scope.id] ?? "";
      const major = group?.majors?.find((candidate) => candidate.id === majorId) ?? null;
      return {
        scope,
        group,
        major,
        crns: scope.courses.flatMap((course) => {
          if (group && majorId && group.byMajor?.[majorId]?.[course.id]?.notTaught) return [];
          const parts = partsOf(group ? sectionFor(group, majorId, course.id) : null).filter((part) => part.crn);
          return parts.length
            ? parts.map((part) => ({ courseId: course.id, courseCode: course.code, courseName: course.name, crn: part.crn }))
            : [{ courseId: course.id, courseCode: course.code, courseName: course.name, crn: "" }];
        }),
      };
    });
}

/**
 * A student's week: every section their groups stand for, and every one the registrar has
 * registered them in. Where the two agree the box is solid; a group's section they are not
 * registered for is dashed, and so is one of a course they are exempt from that the
 * registrar still has them in; a registration outside any group of theirs — a language,
 * an option — is drawn like any other, because it is where they will be that afternoon.
 */
export function studentTimetable({
  placements,
  excused,
  links,
  registrations,
}: {
  placements: Placement[];
  /** Courses they do not take: credit held elsewhere, or passed already. */
  excused: ReadonlySet<string>;
  /** Student Hub semester id → portal term code. */
  links: Record<string, string>;
  registrations: Registration[];
}): TimetableEntry[] {
  const registered = new Set(registrations.filter((entry) => entry.status === "in_portal").map((entry) => entry.crn));
  const placedCrns = new Set(placements.flatMap(({ crns }) => crns.map((cell) => cell.crn)).filter(Boolean));
  return [
    ...placements.flatMap(({ scope, group, major, crns }) =>
      crns
        // A course they are exempt from is off their week — unless the registrar still has
        // them in it, when it is drawn empty and dashed and says so: the portal expects them.
        .filter((cell) => cell.crn && (!excused.has(cell.courseId) || registered.has(cell.crn)))
        .map((cell) => {
          const exempt = excused.has(cell.courseId);
          const label = `${scope.code} ${group ? subRowLabel(group.label, major?.program ?? "", (group.majors ?? []).length) : ""}`.trim();
          return {
            termCode: links[scope.termId ?? ""] ?? "",
            crn: cell.crn,
            code: cell.courseCode,
            title: cell.courseName,
            group: exempt ? `${label} · exempt` : label,
            tone: exempt || !registered.has(cell.crn) ? ("outline" as const) : ("solid" as const),
          };
        }),
    ),
    ...registrations
      .filter((registration) => registration.status === "in_portal" && !placedCrns.has(registration.crn))
      .map((registration) => ({
        termCode: registration.termCode,
        crn: registration.crn,
        code: registration.courseCode,
        title: registration.title,
        staff: registration.teacherName,
      })),
  ];
}

/**
 * A teacher's week, three ways a class is theirs.
 *
 * Our planning names them on it; or the portal's own list staffs it with them, which
 * catches what nobody has put on a card yet; or they stood in for somebody — drawn on the
 * dates they did and no others, since a cover is one afternoon and not a standing
 * commitment, in a colour of its own so it is never read as another hour of their course.
 */
export function teacherTimetable({
  cards,
  links,
  registered,
  notes,
  teacher,
}: {
  cards: Card[];
  links: Record<string, string>;
  registered: ActiveCrn[];
  notes: SessionChange[];
  /** Their id on the department's list, where they are on it, and their name. */
  teacher: { id: string; fullName: string };
}): TimetableEntry[] {
  const ours: TimetableEntry[] = sectionsTaughtBy(cards, teacher.id, teacher.fullName)
    .filter((section) => !section.retired && section.crn)
    .map((section) => ({
      termCode: links[section.termId] ?? "",
      crn: section.crn,
      code: section.courseCode,
      title: section.courseName,
      label: section.courseCode,
      group: `${section.scopeCode} ${section.groupLabel}`,
    }));
  const named = new Set(ours.map((entry) => entry.crn));
  const theirs: TimetableEntry[] = registered
    .filter((row) => !named.has(row.crn) && row.portalStatus === "in_portal" && sameTeacher(row.teacherName, teacher.fullName))
    .map((row) => ({ termCode: row.termCode, crn: row.crn, code: row.courseCode, title: row.courseTitle || row.portalTitle }));
  const own = new Set([...ours, ...theirs].map((entry) => entry.crn));

  const byCrn = new Map<string, { termCode: string; dates: string[] }>();
  for (const note of notes) {
    if (note.kind !== "covered" || own.has(note.crn)) continue;
    const mine = (teacher.id && note.coverTeacherId === teacher.id) || sameTeacher(note.coverTeacherName, teacher.fullName);
    if (!mine) continue;
    const seen = byCrn.get(note.crn) ?? { termCode: note.termCode, dates: [] };
    seen.dates.push(note.meetsOn);
    byCrn.set(note.crn, seen);
  }
  const covering: TimetableEntry[] = [...byCrn.entries()].map(([crn, seen]) => ({
    termCode: seen.termCode,
    crn,
    // Somebody else's section: the sweep names the course and whose class it is.
    code: "",
    title: "",
    onlyOn: seen.dates,
    standingIn: true,
    colorKey: `cover:${crn}`,
  }));
  return [...ours, ...theirs, ...covering];
}
