/**
 * Turning the student record and the latest portal pull into the rows the page shows.
 *
 * Pure functions, because these are the rules that have to be right: who the portal still
 * returns, who it has stopped returning, and what a coordinator is looking at after
 * filtering and sorting. None of it touches the network.
 *
 * The list itself is the server's: one row per student, kept between syncs. All this adds
 * is the name, year and major from the pull held in this browser, which is the only place
 * they live.
 */

import type { Warning } from "@/services/discrepancies";
import type { FieldChange } from "@/services/pullHistory";
import { displayNameOf, studentIdOf, type RosterRow } from "@/services/scenRosters";
import type { Student } from "@/services/studentDatabase";

/** What the last sync found: the portal returned them, or it did not. */
export type StudentStatus = "in_portal" | "not_in_portal";

export type StudentRow = {
  studentId: string;
  name: string;
  yearLevel: string;
  major: string;
  email: string;
  status: StudentStatus;
  cohortId: string | null;
  cohortName: string;
  /** When they were placed in that cohort; empty for a placement made before this was kept. */
  cohortSince: string;
  /** When we first held this student, and when the portal last returned them. */
  firstSeenAt: string;
  lastSeenAt: string;
  /** Every field the portal returned for them, by its own field name. */
  portal: Record<string, string>;
  /** First seen by the most recent sync, so worth a coordinator's attention. */
  isNew: boolean;
  /** What the portal says differently from the previous pull: "year FY → L1". */
  changes: string[];
  /** Where the portal and the cohort disagree — see services/discrepancies.ts. Empty off the Cohorts page. */
  warnings: Warning[];
  /** The blocks they sit in, as a coordinator says them: "TD 1", or "S2 · TD 3". */
  groups: string[];
};

export type SortKey = "name" | "studentId" | "yearLevel" | "major" | "status" | "cohortName";

/** The fields worth noticing a change in, and what to call each one. */
const WATCHED: { column: keyof RosterRow; label: string }[] = [
  { column: "YEARLEVEL_CODE", label: "year" },
  { column: "MAJOR_CODE_DESC", label: "major" },
  { column: "ESTS_CODE", label: "status" },
  { column: "STST_CODE", label: "student status" },
  { column: "FULL_NAME", label: "name" },
  { column: "PSUAD_EMAIL", label: "e-mail" },
];

/**
 * What the portal now says differently for each student, against the previous pull.
 *
 * Only students present in both are compared: somebody who has just appeared is new
 * rather than changed, and somebody the portal has dropped is answered by their status.
 */
export function changesSince(previous: RosterRow[], current: RosterRow[]): Map<string, string[]> {
  const before = new Map(previous.map((row) => [studentIdOf(row), row]));
  const changes = new Map<string, string[]>();

  for (const row of current) {
    const id = studentIdOf(row);
    const earlier = before.get(id);
    if (!id || !earlier) continue;
    const moved = WATCHED.flatMap(({ column, label }) => {
      const was = String(earlier[column] ?? "").trim();
      const now = String(row[column] ?? "").trim();
      return was && now && was !== now ? [`${label} ${was} → ${now}`] : [];
    });
    if (moved.length) changes.set(id, moved);
  }
  return changes;
}

/**
 * What changed, taken from the history rather than worked out again.
 *
 * The history already records every pull's changes, field by field, against the values
 * the pull before it left behind. Keeping a second full copy of the previous roster just
 * to recompute the same answer stored it twice — 45 fields a student to look at six.
 *
 * The history watches every field; this table shows the six worth a coordinator's
 * attention, so the rest are dropped here rather than at the point they were recorded.
 */
export function changesFromRecord(record: { changed: Record<string, FieldChange[]> } | null): Map<string, string[]> {
  const changes = new Map<string, string[]>();
  if (!record) return changes;
  const watched = new Map(WATCHED.map(({ column, label }) => [String(column), label]));

  for (const [id, moved] of Object.entries(record.changed)) {
    const shown = moved.flatMap(({ field, from, to }) => {
      const label = watched.get(field);
      // Same rule as before: an arrival is not a change, so a value appearing from
      // nothing is not worth a line.
      return label && from && to ? [`${label} ${from} → ${to}`] : [];
    });
    if (shown.length) changes.set(id, shown);
  }
  return changes;
}

/**
 * Every student we hold, with whatever this browser can say about them.
 *
 * `syncedAt` is when the last sync ran: a student first seen at that moment is one it
 * brought in. Nobody is invented here — a portal row for somebody the server has never
 * heard of does not appear, because syncing is what puts them on the list.
 */
/**
 * "Semester 2" out of "Physics & Maths — First Year, Semester 2".
 *
 * A cell has room for a group, not for the registrar's full title of the semester it is in.
 */
export function shortTerm(name: string): string {
  return /semester\s*\d+/i.exec(name)?.[0] ?? name;
}

/**
 * The blocks a student sits in, said the way a coordinator says them.
 *
 * The semester is named only when the student is in more than one, because that is the
 * only time it disambiguates: "TD 1" and "TD 3" are the same block in different semesters
 * and would otherwise read as a contradiction.
 */
export function groupLabels(
  groups: { termId: string; scopeCode: string; groupLabel: string }[],
  termNames: Record<string, string> = {},
): string[] {
  const terms = new Set(groups.map((group) => group.termId));
  return groups.map((group) => {
    const label = `${group.scopeCode} ${group.groupLabel}`;
    if (terms.size < 2) return label;
    const term = termNames[group.termId];
    return term ? `${shortTerm(term)} · ${label}` : label;
  });
}

export function studentRows(
  students: Student[],
  portal: RosterRow[],
  changes: Map<string, string[]> = new Map(),
  syncedAt = "",
  termNames: Record<string, string> = {},
  warningsFor: (studentId: string) => Warning[] = () => [],
): StudentRow[] {
  const pulled = new Map<string, RosterRow>();
  for (const row of portal) {
    const id = studentIdOf(row);
    if (id && !pulled.has(id)) pulled.set(id, row);
  }

  return students.map((student) => {
    const row = pulled.get(student.studentId);
    const portal: Record<string, string> = {};
    for (const [field, value] of Object.entries(row ?? {})) {
      const text = String(value ?? "").trim();
      if (text) portal[field] = text;
    }
    return {
      studentId: student.studentId,
      name: row ? displayNameOf(row) : "",
      yearLevel: row ? String(row.YEARLEVEL_CODE ?? "") : "",
      major: row ? String(row.MAJOR_CODE_DESC ?? "") : "",
      email: row ? String(row.PSUAD_EMAIL ?? "") : "",
      status: student.status,
      cohortId: student.cohortId,
      cohortName: student.cohortName,
      cohortSince: student.cohortSince,
      groups: groupLabels(student.groups ?? [], termNames),
      firstSeenAt: student.firstSeenAt,
      lastSeenAt: student.lastSeenAt,
      portal,
      isNew: Boolean(syncedAt) && student.firstSeenAt >= syncedAt,
      changes: changes.get(student.studentId) ?? [],
      warnings: warningsFor(student.studentId),
    };
  });
}

/** What the chips above the table can narrow to. */
export type StatusFilter = StudentStatus | "all" | "new" | "changed";

export type Filters = {
  query: string;
  status: StatusFilter;
  /** A cohort id, "" for any, or "none" for the students not in one yet. */
  cohort: string;
  yearLevel: string;
  major: string;
};

export const NO_FILTERS: Filters = { query: "", status: "all", cohort: "", yearLevel: "", major: "" };

function matchesStatus(row: StudentRow, status: StatusFilter): boolean {
  if (status === "all") return true;
  if (status === "new") return row.isNew;
  if (status === "changed") return row.changes.length > 0;
  return row.status === status;
}

function matchesCohort(row: StudentRow, cohort: string): boolean {
  if (!cohort) return true;
  if (cohort === "none") return row.cohortId === null;
  return row.cohortId === cohort;
}

export function filterRows(rows: StudentRow[], filters: Filters): StudentRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      matchesStatus(row, filters.status) &&
      matchesCohort(row, filters.cohort) &&
      (!filters.yearLevel || row.yearLevel === filters.yearLevel) &&
      (!filters.major || row.major === filters.major) &&
      (!needle ||
        row.studentId.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle)),
  );
}

/**
 * One collator for every comparison. `localeCompare` with an options object builds a
 * collator each time it is called, and a sort of three thousand rows calls it thirty-odd
 * thousand times — which was most of the pause when a filter changed.
 */
export const COLLATOR = new Intl.Collator(undefined, { numeric: true });

export function sortRows(rows: StudentRow[], key: SortKey, ascending: boolean): StudentRow[] {
  const direction = ascending ? 1 : -1;
  return [...rows].sort((left, right) => {
    const compared = COLLATOR.compare(String(left[key]), String(right[key]));
    return (compared || COLLATOR.compare(left.studentId, right.studentId)) * direction;
  });
}

/** The values a filter can offer, taken from what was actually pulled. */
export function choices(rows: StudentRow[], key: "yearLevel" | "major"): string[] {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
}

export function countBy(rows: StudentRow[]): Record<StatusFilter, number> {
  return {
    all: rows.length,
    in_portal: rows.filter((row) => row.status === "in_portal").length,
    not_in_portal: rows.filter((row) => row.status === "not_in_portal").length,
    new: rows.filter((row) => row.isNew).length,
    changed: rows.filter((row) => row.changes.length > 0).length,
  };
}

/**
 * The one cohort a selection belongs to, or null when there isn't one.
 *
 * Blocks belong to a cohort, so a selection spanning two of them has no single block list
 * to choose from — and a student in no cohort has none at all. Rather than place what it
 * can and quietly drop the rest, the control asks for a selection it can answer for.
 */
export function sharedCohort(rows: StudentRow[], selected: Set<string>): string | null {
  const cohorts = new Set(
    rows.filter((row) => selected.has(row.studentId)).map((row) => row.cohortId ?? ""),
  );
  if (cohorts.size !== 1) return null;
  const [only] = [...cohorts];
  return only || null;
}
