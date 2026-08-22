/**
 * What changed between the registrar portal and the published term.
 *
 * Pure functions on purpose: the reconcile rules are the part that has to be right,
 * and they are much easier to trust when they can be read and tested without a browser,
 * an extension, or a database.
 */

import type { RosterCourse, RosterStudent } from "@/services/timetables";
import { displayNameOf, studentIdOf, type RosterRow } from "@/services/scenRosters";

/** One course in as many groups as it is taught: MATH-001-TD → Gr. 1, Gr. 2, Gr. 3. */
export type CourseFamily = {
  key: string;
  /** The section code with the group stripped off: "MATH-001-TD-GR.3" → "MATH-001-TD". */
  label: string;
  kind: string;
  title: string;
  options: { crn: string; group: string; staff: string }[];
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

const squash = (value: string) => value.replace(/[\s.]/g, "").toLowerCase();

/**
 * The registrar writes the group into the section code — "MATH-001-TD-GR.3" — so the
 * column a coordinator actually wants is that code with its last segment removed. Only
 * strip it when it really is the group, so an unusual code is left alone rather than
 * silently truncated.
 */
export function familyCodeOf(course: RosterCourse): string {
  const segments = course.code.split("-");
  const group = squash(course.group);
  if (group && segments.length > 1 && squash(segments[segments.length - 1]) === group) {
    return segments.slice(0, -1).join("-");
  }
  return course.code;
}

export function courseFamilies(courses: RosterCourse[]): CourseFamily[] {
  const families = new Map<string, CourseFamily>();
  for (const course of courses) {
    const label = familyCodeOf(course);
    const family = families.get(label) ?? {
      key: label,
      label,
      kind: course.kind,
      title: course.shortTitle || course.title,
      options: [],
    };
    family.options.push({ crn: course.crn, group: course.group || course.crn, staff: course.staff });
    families.set(label, family);
  }
  return [...families.values()].sort((left, right) => left.label.localeCompare(right.label));
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
