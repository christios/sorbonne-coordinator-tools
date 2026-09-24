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
import { rowsPerPart, type Card } from "@/services/courseCards";
import type { TaughtHour } from "@/services/hoursInPeriod";
import type { TeacherWarning } from "@/services/teacherWarnings";
import type { ActiveTeacher, FacilityHours } from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";
import type { RequestSheet } from "@/services/timetableExport";

/** The name the workbook prints for a row nobody has been chosen for. */
const UNNAMED = "TBD";

/** The teaching types the workbook counts separately; anything else lands in the total alone. */
export const LOAD_TYPES = ["CM", "TD", "TP"];

/** "FYS-S1" → "FYS", "BSc-L1-S1" → "BSc L1": the column one sheet's hours sit in. */
export function hoursColumn(sheetTitle: string): string {
  return sheetTitle.replace(/-S\d+$/i, "").replace(/-/g, " ");
}

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
      // A retired group's hours are nobody's to teach. They stay on the sheet, marked, so
      // the timetabler knows; here they would read as a class with nobody in front of it.
      if (row.retired) continue;
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

/** Where a CRN sits in the plan: whose cohort's sheet it is on, and what kind of class it is. */
export type SectionPlace = { sheetIndex: number; type: string };

export function placeByCrn(sheets: RequestSheet[]): Map<string, SectionPlace> {
  const found = new Map<string, SectionPlace>();
  sheets.forEach((sheet, sheetIndex) => {
    for (const row of sheet.rows) {
      if (!row.crn || row.retired) continue;
      found.set(row.crn, { sheetIndex, type: row.type.toUpperCase() || "OTHER" });
    }
  });
  return found;
}

/**
 * The same row, counted from what happened rather than from what was planned.
 *
 * The plan has no dates on it — a section is 21 hours for the semester — so it cannot
 * answer "what did they teach in October". The registrar's dated meetings can, and this
 * lays them out the same way: a column per cohort, then by kind of class, then a total.
 * Cancelled classes are already gone from `hours` and a covered one already belongs to
 * whoever stood in, so nothing is adjusted afterwards.
 *
 * A teacher with nothing in the window keeps their row, at nought. A row that disappears
 * for a month reads as a teacher who left.
 */
export function taughtLoads(input: {
  hours: TaughtHour[];
  place: Map<string, SectionPlace>;
  sheets: RequestSheet[];
  /** Everybody who should have a row, so a quiet month is a nought rather than a gap. */
  everyone: { teacherId: string; teacher: string }[];
}): TeacherLoad[] {
  const { hours, place, sheets, everyone } = input;
  const held = new Map<string, TeacherLoad & { crns: Set<string> }>();
  const keyOf = (name: string) => (name ? `name:${name.trim().toLowerCase()}` : "");
  const blank = (teacherId: string, teacher: string) => ({
    teacherId,
    teacher,
    bySheet: sheets.map(() => 0),
    byType: {} as Record<string, number>,
    total: 0,
    sections: 0,
    crns: new Set<string>(),
  });
  for (const row of everyone) held.set(keyOf(row.teacher), blank(row.teacherId, row.teacher));

  for (const hour of hours) {
    const key = keyOf(hour.teacherName);
    const load = held.get(key) ?? blank(hour.teacherId, hour.teacherName);
    load.teacherId = load.teacherId || hour.teacherId;
    const where = place.get(hour.crn);
    const taught = Math.round((hour.minutes / 60) * 100) / 100;
    if (where) load.bySheet[where.sheetIndex] += taught;
    load.byType[where?.type ?? "OTHER"] = (load.byType[where?.type ?? "OTHER"] ?? 0) + taught;
    load.total += taught;
    load.crns.add(hour.crn);
    held.set(key, load);
  }

  const rows = [...held.values()].map(({ crns, ...load }) => ({
    ...load,
    total: Math.round(load.total * 100) / 100,
    bySheet: load.bySheet.map((hours_) => Math.round(hours_ * 100) / 100),
    byType: Object.fromEntries(Object.entries(load.byType).map(([type, hours_]) => [type, Math.round(hours_ * 100) / 100])),
    sections: crns.size,
  }));
  return [
    ...rows.filter((load) => load.teacher).sort((left, right) => left.teacher.localeCompare(right.teacher)),
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
  /** The Hub semester the section is taught in; what links it to a portal term. */
  termId: string;
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
      // Per part: a section taught in two halves is two stretches of teaching, and the
      // second belongs to whoever is named on it rather than to whoever took the first.
      for (const row of set.rows.flatMap((entry) => rowsPerPart(entry))) {
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
          termId: card.termId,
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


/** One row of the Teacher hours table: the load, and who the department knows them to be. */
export type LoadRow = TeacherLoad & {
  /** How the name got here: chosen from Active teachers, typed by the registrar, or nobody. */
  standing: "Confirmed" | "Not confirmed" | "Nobody yet";
  active: ActiveTeacher | null;
  /** The CRNs the planning gives this teacher, for the notes on their classes. */
  crns: string[];
  /** What the term's cancelled and covered classes do to their hours. Zero until read. */
  cancelledHours: number;
  coverGiven: number;
  coverTaken: number;
  /** The registrar's booked hours on the sections the portal staffs with them. Zero until read. */
  registrarHours: number;
  /** Where this teacher's hours disagree with themselves. Empty until the figures are read. */
  warnings: TeacherWarning[];
  /**
   * Minutes actually taught in the pay period on screen: the classes that met, less the
   * cancelled, plus any they stood in for. Absent until a period is chosen, and not the
   * same kind of number as the rest of this row — those are a plan for the semester.
   */
  periodMinutes?: number;
};

/**
 * The loads, joined to the department's list.
 *
 * By id where the section named one, and otherwise by the name itself — because a teacher
 * can be on the list and still have every section carrying only what the registrar typed,
 * and the table is more useful for knowing that they are the same person.
 */
export function loadRows(loads: TeacherLoad[], active: ActiveTeacher[], crnsOf: (teacher: string) => string[] = () => []): LoadRow[] {
  const byId = new Map(active.map((teacher) => [teacher.id, teacher]));
  const byName = new Map(active.map((teacher) => [teacher.fullName.trim().toLowerCase(), teacher]));
  return loads.map((load) => ({
    ...load,
    standing: !load.teacher ? "Nobody yet" : load.teacherId ? "Confirmed" : "Not confirmed",
    active: byId.get(load.teacherId) ?? byName.get(load.teacher.trim().toLowerCase()) ?? null,
    crns: crnsOf(load.teacher),
    cancelledHours: 0,
    coverGiven: 0,
    coverTaken: 0,
    registrarHours: 0,
    warnings: [],
  }));
}

/**
 * The registrar's hours for one teacher: every section the portal staffs with them, added up.
 *
 * Theirs by the portal's own staffing, not by our planning — that is what makes the number
 * worth reading beside ours. Where the registrar has given a section to somebody else, the
 * two columns part company on both rows, and that is the whole point of having both.
 */
export function registrarHoursFor(
  hours: FacilityHours,
  teacher: string,
  same: (left: string, right: string) => boolean,
): number {
  if (!teacher) return 0;
  const total = Object.values(hours)
    .filter((section) => section.teacherName && same(section.teacherName, teacher))
    .reduce((sum, section) => sum + section.hours, 0);
  return Math.round(total * 100) / 100;
}

/** The registrar's hours per section, `term|crn -> hours`, and which terms have answered at all. */
export type BookedHours = { hours: Map<string, number>; answered: Set<string> };

/**
 * One section's hours as the registrar's timetable books them over the semester — or why
 * there are none: no CRN to ask about, a term whose timetable has not answered yet, or a
 * CRN the registrar has no meetings for.
 */
export function bookedHoursOf(booked: BookedHours, termCode: string, crn: string): number | "no-crn" | "waiting" | "none" {
  if (!crn || !termCode) return "no-crn";
  const hours = booked.hours.get(`${termCode}|${crn}`);
  if (hours !== undefined) return Math.round(hours * 100) / 100;
  return booked.answered.has(termCode) ? "none" : "waiting";
}

/** `teacher name -> CRNs`, from the same rows the hours come from, keyed as `teacherLoads` keys. */
export function crnsByTeacher(sheets: RequestSheet[]): (teacher: string) => string[] {
  const held = new Map<string, Set<string>>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (!row.crn || row.retired) continue;
      const key = row.teacher && row.teacher.toUpperCase() !== UNNAMED ? row.teacher.trim().toLowerCase() : "";
      const crns = held.get(key) ?? new Set<string>();
      crns.add(row.crn);
      held.set(key, crns);
    }
  }
  return (teacher: string) => [...(held.get(teacher.trim().toLowerCase()) ?? [])];
}

/**
 * The columns, which depend on which cohorts are in the semester being looked at.
 *
 * A cohort's hours are a column of their own because that is the question the department
 * asks of this table — not "how much does she teach" but "how much of L1 does she teach" —
 * and it is the shape the timetable workbook has always had. Who the person is comes after
 * the numbers: it is what the filter chips work on rather than what the eye reads across.
 */
/**
 * `period` names the pay period on screen — "15 Sep – 14 Oct 2026". Given one, the table
 * gains a column of what was actually taught in it, which is a different kind of number
 * from every other column here: those are the semester's plan, this is what happened.
 */
export function hoursColumns(sheetTitles: string[], window = ""): GridColumn<LoadRow>[] {
  /*
   * Every number below is counted over the same stretch of time, so every one of them
   * carries the same mark. A table whose figures silently mean "October" reads exactly
   * like one whose figures mean "the year", and the difference is somebody's pay.
   */
  const when = window ? { window } : {};
  return [
    { id: "teacher", displayName: "Teacher", type: "text", accessor: (row) => row.teacher || "Nobody yet", required: true, defaultWidth: 240 },
    { id: "standing", displayName: "Standing", type: "option", accessor: (row) => row.standing, defaultWidth: 130 },
    /*
     * Two different totals, because the rows underneath are two different things.
     *
     * Over the whole semester a row is the plan, so the total is the plan adjusted by what
     * happened to it. Over a window the row is already what happened — the cancelled class
     * never entered it — so adjusting again would take the same hour off twice, which is
     * exactly the bug this comment replaces.
     */
    { id: "total", displayName: "Total", type: "number", accessor: window ? (row) => row.total : asTaught, defaultWidth: 110, source: "planning", ...when },
    // The registrar's count beside ours. A comparison with no warning on it: teachers and
    // hours move during a semester, and cover is normal.
    { id: "registrarHours", displayName: "Registrar", type: "number", accessor: (row) => row.registrarHours, defaultWidth: 100, source: "registrar", ...when },
    ...sheetTitles.map((title, index) => ({
      id: `sheet:${title}`,
      displayName: hoursColumn(title),
      type: "number" as const,
      accessor: (row: LoadRow) => row.bySheet[index] ?? 0,
      defaultWidth: 100,
      ...when,
    })),
    ...LOAD_TYPES.map((type) => ({
      id: `type:${type}`,
      displayName: type,
      type: "number" as const,
      accessor: (row: LoadRow) => row.byType[type] ?? 0,
      defaultWidth: 80,
      ...when,
    })),
    { id: "sections", displayName: "Sections", type: "number", accessor: (row) => row.sections, defaultWidth: 100, source: "planning", ...when },
    /*
     * What the semester did to the plan, beside the plan rather than folded into it: hours
     * of theirs that were cancelled, hours somebody else taught for them, hours they taught
     * for somebody else. From the notes on the CRNs' calendars.
     */
    { id: "cancelledHours", displayName: "Cancelled", type: "number", accessor: (row) => row.cancelledHours, defaultWidth: 100, source: "planning", ...when },
    { id: "coverTaken", displayName: "Covered by others", type: "number", accessor: (row) => row.coverTaken, defaultWidth: 140, source: "planning", ...when },
    { id: "coverGiven", displayName: "Covered for others", type: "number", accessor: (row) => row.coverGiven, defaultWidth: 150, source: "planning", ...when },
    /*
     * Beside the numbers it is about, not at the far end of the row. A warning column
     * somebody has to scroll to is a warning column nobody reads.
     */
    {
      id: "warnings",
      displayName: "Warnings",
      type: "text",
      accessor: (row) => row.warnings.map((warning) => warning.label).join(", "),
      defaultWidth: 260,
    },
    { id: "type", displayName: "Type", type: "option", accessor: (row) => row.active?.type ?? "", defaultWidth: 190, source: "portal" },
    { id: "category", displayName: "Category", type: "option", accessor: (row) => row.active?.category ?? "", defaultWidth: 120, source: "portal" },
    { id: "department", displayName: "Dept.", type: "option", accessor: (row) => row.active?.department ?? "", defaultWidth: 110, source: "portal" },
    { id: "email", displayName: "E-mail", type: "text", accessor: (row) => row.active?.email ?? "", defaultWidth: 240 },
  ];
}

/**
 * The plan as it turned out.
 *
 * A cancelled class showed as -1.5 in its own column while the total beside it did not
 * move, because the total was the plan and the plan had not changed. True, and useless:
 * the number people read is the total, and reading it meant adding three other columns
 * to it in your head.
 *
 * So the total is what they taught: the plan, less the classes that did not happen, less
 * the ones somebody else took, plus the ones they took for somebody else. The columns it
 * is made of stay where they are, as the explanation of why it moved.
 */
export function asTaught(row: LoadRow): number {
  return Math.round((row.total - row.cancelledHours - row.coverTaken + row.coverGiven) * 100) / 100;
}

/**
 * Which columns are on screen to begin with: every cohort's, and the totals.
 *
 * A cohort column waiting in the picker is a cohort somebody forgets to count, so they are
 * all shown however many there are. What waits is who the person is.
 */
export function shownHoursColumns(sheetTitles: string[]): string[] {
  return [
    "teacher",
    "standing",
    ...sheetTitles.map((title) => `sheet:${title}`),
    ...LOAD_TYPES.map((type) => `type:${type}`),
    "total",
    "warnings",
    "registrarHours",
    "sections",
    "cancelledHours",
    "coverTaken",
    "coverGiven",
  ];
}

/**
 * Whether two spellings name the same teacher: the same words in any order, whatever the
 * case, the accents and the punctuation. The portal writes "YOUNES Grace" where the
 * register writes "Grace Younes", and a section staffed under either is theirs.
 */
export function sameTeacher(left: string, right: string): boolean {
  const words = (name: string) =>
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .sort()
      .join(" ");
  const a = words(left);
  const b = words(right);
  return Boolean(a) && a === b;
}

/**
 * The registrar's booked hours inside a window, for the teacher the registrar names.
 *
 * Its own count, from the meetings themselves rather than from our notes: no cancellation
 * of ours and no cover of ours touches it, because the point of the column is to be the
 * other side of the comparison. The whole-semester figure comes from the sweep's own
 * total; this is the same question asked of a narrower pair of dates.
 */
export function bookedInWindow(
  sections: { teacherName: string; meetings: { meetsOn: string; startsAt: string; endsAt: string }[] }[],
  teacher: string,
  window: { from: string; to: string },
): number {
  if (!teacher) return 0;
  let minutes = 0;
  for (const section of sections) {
    if (!sameTeacher(section.teacherName, teacher)) continue;
    for (const meeting of section.meetings) {
      if (meeting.meetsOn < window.from || meeting.meetsOn > window.to) continue;
      minutes += Math.max(0, clockMinutes(meeting.endsAt) - clockMinutes(meeting.startsAt));
    }
  }
  return Math.round((minutes / 60) * 100) / 100;
}

function clockMinutes(at: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec((at || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}
