/**
 * What changed between the registrar portal and the published term, and which groups a
 * coordinator may choose from.
 *
 * Pure functions on purpose: these rules are the part that has to be right, and they are
 * much easier to trust when they can be read and tested without a browser, an extension,
 * or a database.
 */

import { displayNameOf, studentIdOf, type RosterRow } from "@/services/scenRosters";
import type { RosterCourse, RosterStudent } from "@/services/timetables";

/**
 * One column of the coordinator's group template: a course, an activity, and the groups
 * it is taught in. "MATH-001 CM group" offers Gr. A and Gr. B; "SCEN-101 group" offers
 * Group F1 … F7. The group is the only thing a coordinator fills in — everything else on
 * the screen is read back from the term's own catalogue.
 */
export type CourseFamily = {
  key: string;
  /** "MATH-001" — the course, without the activity or the group. */
  course: string;
  /** "CM", "TD", or "" for a course taught as a single activity. */
  scope: string;
  /** What the template's column header says: "MATH-001 CM group". */
  label: string;
  title: string;
  kind: string;
  options: { crn: string; group: string; staff: string; code: string }[];
};

export type RowStatus = "joined" | "left" | "assigned";

export type ReconcileRow = {
  studentId: string;
  /** Empty until a roster is pulled — the platform never tells us anybody's name. */
  name: string;
  yearLevel: string;
  crns: string[];
  version: number;
  updatedBy: string;
  updatedAt: string;
  status: RowStatus;
};

export type Reconciliation = {
  rows: ReconcileRow[];
  counts: { assigned: number; joined: number; left: number };
};

const COURSE = /^[A-Za-z]+-\d+/;
const ACTIVITY = /^[A-Za-z]+$/;

/**
 * Split a section code into the course and the activity, discarding the group.
 *
 * The registrar writes all three into one string, and which parts are present varies:
 *   MATH-001-CM-GR.A → MATH-001, CM   (the group is its own column in the template)
 *   SCEN-101-F1      → SCEN-101, ""   (F1 *is* the group, so it is not an activity)
 *   SCEN-102         → SCEN-102, ""
 * An activity is a segment of letters only; anything carrying a digit is a group, which
 * is why the French sections collapse into one column instead of seven.
 */
export function familyOf(code: string): { course: string; scope: string } {
  const course = COURSE.exec(code)?.[0];
  if (!course) return { course: code, scope: "" };
  const rest = code.slice(course.length).split("-").filter(Boolean);
  const scope = rest[0] && ACTIVITY.test(rest[0]) ? rest[0].toUpperCase() : "";
  return { course, scope };
}

export function courseFamilies(courses: RosterCourse[]): CourseFamily[] {
  const families = new Map<string, CourseFamily>();
  for (const row of courses) {
    const { course, scope } = familyOf(row.code);
    const key = scope ? `${course}-${scope}` : course;
    const family = families.get(key) ?? {
      key,
      course,
      scope,
      label: scope ? `${course} ${scope} group` : `${course} group`,
      kind: row.kind,
      title: row.shortTitle || row.title,
      options: [],
    };
    family.options.push({ crn: row.crn, group: row.group || row.crn, staff: row.staff, code: row.code });
    families.set(key, family);
  }
  for (const family of families.values()) {
    family.options.sort((left, right) => left.group.localeCompare(right.group, undefined, { numeric: true }));
  }
  return [...families.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** The CRN this student holds in one family, or "" when they hold none. */
export function chosenCrn(family: CourseFamily, crns: string[]): string {
  return family.options.find((option) => crns.includes(option.crn))?.crn ?? "";
}

/** Swap this student's group in one family, leaving every other family untouched. */
export function withGroup(family: CourseFamily, crns: string[], crn: string): string[] {
  const others = crns.filter((held) => !family.options.some((option) => option.crn === held));
  return crn ? [...others, crn] : others;
}

/** Everything the term knows about the CRNs one student holds — read-only, for preview. */
export function heldCourses(families: CourseFamily[], crns: string[]) {
  return families.flatMap((family) =>
    family.options.filter((option) => crns.includes(option.crn)).map((option) => ({ family, ...option })),
  );
}

const ORDER: Record<RowStatus, number> = { joined: 0, left: 1, assigned: 2 };

/**
 * Merge what the term holds with what the portal says today.
 *
 * `portal` is empty until somebody pulls, and that is a normal state: the screen then
 * shows the term's own students by id, with no diff and no names.
 */
export function reconcile(students: RosterStudent[], portal: RosterRow[]): Reconciliation {
  const byId = new Map(students.map((student) => [student.studentId.toUpperCase(), student]));
  const rows: ReconcileRow[] = [];
  const seen = new Set<string>();

  for (const row of portal) {
    const id = studentIdOf(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const held = byId.get(id);
    rows.push({
      studentId: held?.studentId ?? id,
      name: displayNameOf(row),
      yearLevel: String(row.YEARLEVEL_CODE ?? ""),
      crns: held?.crns ?? [],
      version: held?.version ?? 0,
      updatedBy: held?.updatedBy ?? "",
      updatedAt: held?.updatedAt ?? "",
      status: held ? "assigned" : "joined",
    });
  }

  for (const student of students) {
    if (seen.has(student.studentId.toUpperCase())) continue;
    rows.push({
      studentId: student.studentId,
      name: "",
      yearLevel: "",
      crns: student.crns,
      version: student.version,
      updatedBy: student.updatedBy,
      updatedAt: student.updatedAt,
      // Without a pull we cannot know anybody left; we only know the term's own list.
      status: portal.length ? "left" : "assigned",
    });
  }

  rows.sort(
    (left, right) =>
      ORDER[left.status] - ORDER[right.status] ||
      (left.name || left.studentId).localeCompare(right.name || right.studentId),
  );

  return {
    rows,
    counts: {
      assigned: rows.filter((row) => row.status === "assigned").length,
      joined: rows.filter((row) => row.status === "joined").length,
      left: rows.filter((row) => row.status === "left").length,
    },
  };
}
