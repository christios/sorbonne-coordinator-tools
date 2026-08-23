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
  /** First seen by the most recent sync, so worth a coordinator's attention. */
  isNew: boolean;
  /** What the portal says differently from the previous pull: "year FY → L1". */
  changes: string[];
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
 * Every student we hold, with whatever this browser can say about them.
 *
 * `syncedAt` is when the last sync ran: a student first seen at that moment is one it
 * brought in. Nobody is invented here — a portal row for somebody the server has never
 * heard of does not appear, because syncing is what puts them on the list.
 */
export function studentRows(
  students: Student[],
  portal: RosterRow[],
  changes: Map<string, string[]> = new Map(),
  syncedAt = "",
): StudentRow[] {
  const pulled = new Map<string, RosterRow>();
  for (const row of portal) {
    const id = studentIdOf(row);
    if (id && !pulled.has(id)) pulled.set(id, row);
  }

  return students.map((student) => {
    const row = pulled.get(student.studentId);
    return {
      studentId: student.studentId,
      name: row ? displayNameOf(row) : "",
      yearLevel: row ? String(row.YEARLEVEL_CODE ?? "") : "",
      major: row ? String(row.MAJOR_CODE_DESC ?? "") : "",
      email: row ? String(row.PSUAD_EMAIL ?? "") : "",
      status: student.status,
      cohortId: student.cohortId,
      cohortName: student.cohortName,
      isNew: Boolean(syncedAt) && student.firstSeenAt >= syncedAt,
      changes: changes.get(student.studentId) ?? [],
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

export function sortRows(rows: StudentRow[], key: SortKey, ascending: boolean): StudentRow[] {
  const direction = ascending ? 1 : -1;
  return [...rows].sort((left, right) => {
    const compared = String(left[key]).localeCompare(String(right[key]), undefined, { numeric: true });
    return (compared || left.studentId.localeCompare(right.studentId)) * direction;
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
