/**
 * How much every teacher is carrying, and what they are carrying it in.
 *
 * The department's own answer to "is anybody teaching too much" lived in a sheet of the
 * timetable workbook, which meant it could only be read by building the workbook and
 * opening it. It is the same count, read from the same rows the workbook is written from,
 * so the sheet and the screen cannot come apart — and the page is where it can be looked
 * at while there is still time to move something.
 *
 * Hours nobody is teaching are counted too. The workbook leaves them out, which is fair
 * enough for a file the timetabler receives; on a page they are the thing worth finding,
 * because a section with hours and no teacher is a class with nobody in front of it.
 */

import { filled } from "@/services/courseRequest";
import type { Card } from "@/services/courseCards";
import type { RequestSheet } from "@/services/timetableExport";

/** The name the workbook prints for a row nobody has been chosen for. */
const UNNAMED = "TBD";

export type TeacherLoad = {
  /** The Active teacher, when one was chosen. Empty for a row with only a typed name. */
  teacherId: string;
  /** What to print. Empty means nobody at all has been named. */
  teacher: string;
  /** Hours on each sheet, in the order the sheets were given. */
  bySheet: number[];
  /** Hours by teaching type — CM, TD, TP — as the rows classify themselves. */
  byType: Record<string, number>;
  total: number;
  /** How many sections these hours come from, which the workbook does not say. */
  sections: number;
};

/**
 * One row per teacher, ordered by name — this is read looking for a person, not for a
 * maximum.
 *
 * Keyed on the name printed, which is the name the timetabler will read: a section with an
 * Active teacher chosen prints that teacher, and one carrying only what the registrar typed
 * prints that. Keying on our own id instead would split a person into two rows the moment
 * one of their sections was confirmed and another was not, and the workbook would go out
 * with the same name twice. The id is kept where any of the rows had one, so the page can
 * open the record; everything with no name at all becomes one row at the end.
 */
export function teacherLoads(sheets: RequestSheet[]): TeacherLoad[] {
  const held = new Map<string, TeacherLoad>();
  sheets.forEach((sheet, index) => {
    for (const row of sheet.rows) {
      const named = row.teacher && row.teacher.toUpperCase() !== UNNAMED;
      const key = named ? `name:${row.teacher.trim().toLowerCase()}` : "";
      const load = held.get(key) ?? {
        teacherId: "",
        teacher: named ? row.teacher.trim() : "",
        bySheet: sheets.map(() => 0),
        byType: {},
        total: 0,
        sections: 0,
      };
      load.teacherId = load.teacherId || row.teacherId;
      const hours = Number(row.hours) || 0;
      load.bySheet[index] += hours;
      load.total += hours;
      load.byType[row.type.toUpperCase() || "OTHER"] = (load.byType[row.type.toUpperCase() || "OTHER"] ?? 0) + hours;
      load.sections += 1;
      held.set(key, load);
    }
  });

  const rows = [...held.values()];
  return [
    ...rows.filter((load) => load.teacher).sort((left, right) => left.teacher.localeCompare(right.teacher)),
    // Nobody yet, last, whether or not it is empty — a nought there is worth seeing.
    ...rows.filter((load) => !load.teacher),
  ];
}

/** What the page says above the table: the people, the hours, and the hours going spare. */
export function loadTotals(loads: TeacherLoad[]): { teachers: number; hours: number; unnamed: number; sections: number } {
  const named = loads.filter((load) => load.teacher);
  return {
    teachers: named.length,
    hours: loads.reduce((sum, load) => sum + load.total, 0),
    unnamed: loads.filter((load) => !load.teacher).reduce((sum, load) => sum + load.total, 0),
    sections: loads.reduce((sum, load) => sum + load.sections, 0),
  };
}

export type TaughtSection = {
  key: string;
  cohortName: string;
  termName: string;
  courseCode: string;
  courseName: string;
  scopeCode: string;
  groupLabel: string;
  crn: string;
  component: string;
  hours: string;
  students: number;
  retired: boolean;
};

/**
 * Every section this teacher holds, across every cohort and semester on the page.
 *
 * Read through the course's request the same way the workbook is, so a section that names
 * nobody but whose course names this teacher is theirs — otherwise the record would
 * disagree with the file the timetabler was sent.
 *
 * Their name counts as well as their id. Most sections carry the name the registrar wrote
 * and have never been confirmed against the department's list, so matching on the id alone
 * told a coordinator that somebody teaching four classes teaches nothing. A section that
 * has been given to somebody else is not theirs, whatever it is called — the name only
 * answers where nobody has been chosen.
 */
export function sectionsTaughtBy(cards: Card[], teacherId: string, teacherName = ""): TaughtSection[] {
  const wanted = teacherName.trim().toLowerCase();
  const taught: TaughtSection[] = [];
  for (const card of cards) {
    for (const set of card.sets) {
      for (const row of set.rows) {
        if (!row.section) continue;
        const section = filled(row.section, set.course.request);
        const mine = section.teacherId
          ? section.teacherId === teacherId
          : Boolean(wanted) && section.teacher.trim().toLowerCase() === wanted;
        if (!mine) continue;
        taught.push({
          key: `${card.key}|${row.group.id}`,
          cohortName: card.cohortName,
          termName: card.termName,
          courseCode: card.code,
          courseName: card.name,
          scopeCode: set.scope.code,
          groupLabel: row.group.label,
          crn: section.crn,
          component: row.course.component || set.scope.code,
          hours: section.hours,
          students: row.group.assigned,
          retired: section.retired,
        });
      }
    }
  }
  return taught.sort(
    (left, right) =>
      left.cohortName.localeCompare(right.cohortName) ||
      left.courseCode.localeCompare(right.courseCode, undefined, { numeric: true }) ||
      left.scopeCode.localeCompare(right.scopeCode) ||
      left.groupLabel.localeCompare(right.groupLabel, undefined, { numeric: true }),
  );
}
