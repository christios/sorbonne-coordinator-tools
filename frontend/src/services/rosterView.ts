/**
 * Turning a portal pull into the rows the Students page shows.
 *
 * Pure functions, because these are the rules that have to be right: which students are
 * new, which have gone, and what a coordinator is looking at after filtering and sorting.
 * None of it touches the network, and none of it leaves the browser.
 */

import { displayNameOf, studentIdOf, type RosterRow } from "@/services/scenRosters";

/** Against the chosen cohort: in both, in the cohort only, or in the pull only. */
export type Membership = "stayed" | "left" | "new";

export type StudentRow = {
  studentId: string;
  name: string;
  yearLevel: string;
  major: string;
  status: string;
  email: string;
  membership: Membership;
};

export type SortKey = "name" | "studentId" | "yearLevel" | "major" | "membership";

const MEMBERSHIP_ORDER: Record<Membership, number> = { new: 0, left: 1, stayed: 2 };

/**
 * Merge today's pull with a cohort's membership.
 *
 * A student the cohort holds but the portal no longer returns is shown too — that is the
 * whole point of "left", and their name is unknown because nothing about them was stored.
 */
export function studentRows(portal: RosterRow[], memberIds: string[]): StudentRow[] {
  const members = new Set(memberIds.map((id) => id.toUpperCase()));
  const seen = new Set<string>();
  const rows: StudentRow[] = [];

  for (const row of portal) {
    const studentId = studentIdOf(row);
    if (!studentId || seen.has(studentId)) continue;
    seen.add(studentId);
    rows.push({
      studentId,
      name: displayNameOf(row),
      yearLevel: String(row.YEARLEVEL_CODE ?? ""),
      major: String(row.MAJOR_CODE_DESC ?? ""),
      status: String(row.ESTS_CODE ?? ""),
      email: String(row.PSUAD_EMAIL ?? ""),
      membership: members.has(studentId) ? "stayed" : "new",
    });
  }

  for (const id of members) {
    if (seen.has(id)) continue;
    rows.push({
      studentId: id,
      name: "",
      yearLevel: "",
      major: "",
      status: "",
      email: "",
      membership: "left",
    });
  }

  return rows;
}

export type Filters = {
  query: string;
  membership: Membership | "all";
  yearLevel: string;
  major: string;
};

export const NO_FILTERS: Filters = { query: "", membership: "all", yearLevel: "", major: "" };

export function filterRows(rows: StudentRow[], filters: Filters): StudentRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.membership === "all" || row.membership === filters.membership) &&
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
    if (key === "membership") {
      const difference = MEMBERSHIP_ORDER[left.membership] - MEMBERSHIP_ORDER[right.membership];
      if (difference) return difference * direction;
      return left.studentId.localeCompare(right.studentId);
    }
    const compared = String(left[key]).localeCompare(String(right[key]), undefined, { numeric: true });
    return (compared || left.studentId.localeCompare(right.studentId)) * direction;
  });
}

/** The values a filter can offer, taken from what was actually pulled. */
export function choices(rows: StudentRow[], key: "yearLevel" | "major"): string[] {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))].sort();
}

export function countBy(rows: StudentRow[]): Record<Membership | "all", number> {
  return {
    all: rows.length,
    stayed: rows.filter((row) => row.membership === "stayed").length,
    left: rows.filter((row) => row.membership === "left").length,
    new: rows.filter((row) => row.membership === "new").length,
  };
}
