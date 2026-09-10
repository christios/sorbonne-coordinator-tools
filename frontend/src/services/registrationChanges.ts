/**
 * The registrar's worklist: which CRNs to add and which to drop, per student.
 *
 * The Cohorts page can already say that a student's registrations differ from the groups
 * they are in. What it could not do is hand that to the person who acts on it, who works
 * from a table of add-and-remove lines and does not care which verdict each came from.
 *
 * Built from `expected` against `registered` and NOT from the verdict's kind, because the
 * two sets are the whole of the arithmetic: what we say they should hold minus what they
 * hold is the adds, and the other way round is the removes. The kind only decides whether
 * a verdict belongs here at all.
 */

import type { Mismatch } from "@/services/portalLists";

/**
 * The verdicts that name a registration to change, and only those.
 *
 * `unplaced` is deliberately absent: it means the registrar has them in a course we have
 * placed them in no group of, and the remedy is to place them rather than to take the
 * registration away. `doubled` is absent because it says two groups of one set are held
 * and cannot say which of them is the mistake. `collides` is not about registration at
 * all. Exporting a guess for any of the three would put a wrong line in front of somebody
 * who acts on it.
 */
const ACTIONABLE = new Set(["missing", "wrong", "extra"]);

export type RegistrationChange = {
  studentId: string;
  studentName: string;
  cohortName: string;
  action: "Add" | "Remove";
  crn: string;
  /** The course the CRN is for, so the line can be read without a lookup. */
  courseCode: string;
};

export function registrationChanges(
  mismatches: Mismatch[],
  nameOf: (studentId: string) => string,
  cohortName: string,
): RegistrationChange[] {
  const changes: RegistrationChange[] = [];
  for (const mismatch of mismatches) {
    if (!ACTIONABLE.has(mismatch.kind)) continue;
    const held = new Set(mismatch.registered);
    const wanted = new Set(mismatch.expected);
    const line = (action: "Add" | "Remove", crn: string) => ({
      studentId: mismatch.studentId,
      studentName: nameOf(mismatch.studentId),
      cohortName,
      action,
      crn,
      courseCode: mismatch.courseCode,
    });
    // Removes first for each course: a registrar working down the list frees the seat
    // before filling it, which is the order the two lines have to be done in.
    for (const crn of mismatch.registered) if (!wanted.has(crn)) changes.push(line("Remove", crn));
    for (const crn of mismatch.expected) if (!held.has(crn)) changes.push(line("Add", crn));
  }
  return changes.sort(byStudentThenByAction);
}

/**
 * Cohort, then the name somebody reads down, then Remove before Add.
 *
 * Spelt out rather than a chain of `localeCompare`s, because two of the three would have
 * been wrong that way. "Remove" against "Add" compares as A before R, which reverses the
 * one ordering that matters — a seat is freed before it is filled. And a student with no
 * name held in this browser cannot be sorted by a placeholder like `~id`: punctuation
 * sorts BEFORE letters, so the unnamed would head a list of names.
 */
function byStudentThenByAction(left: RegistrationChange, right: RegistrationChange): number {
  const cohort = left.cohortName.localeCompare(right.cohortName);
  if (cohort) return cohort;
  // Named first, in name order; then the unnamed, in id order.
  if (Boolean(left.studentName) !== Boolean(right.studentName)) return left.studentName ? -1 : 1;
  const who = left.studentName
    ? left.studentName.localeCompare(right.studentName)
    : left.studentId.localeCompare(right.studentId);
  if (who) return who;
  const same = left.studentId.localeCompare(right.studentId);
  if (same) return same;
  if (left.action !== right.action) return left.action === "Remove" ? -1 : 1;
  return left.crn.localeCompare(right.crn);
}

/** The header of the table the registrar is sent. */
export const CHANGE_COLUMNS = [
  "Student ID",
  "Student",
  "Cohort",
  "Action",
  "Remove CRN",
  "Add CRN",
  "Course",
] as const;

/**
 * The table as text, tab separated, for pasting straight into a sheet.
 *
 * The id and the name are written on the FIRST line of each student's block and left blank
 * under it, which is what the sheet this replaces looks like: eight lines for one student
 * repeating their id eight times reads as eight students at a glance.
 */
export function changesTable(changes: RegistrationChange[]): string {
  const lines = [CHANGE_COLUMNS.join("\t")];
  let last = "";
  for (const change of changes) {
    const first = change.studentId !== last;
    last = change.studentId;
    lines.push(
      [
        first ? change.studentId : "",
        first ? change.studentName : "",
        first ? change.cohortName : "",
        change.action,
        change.action === "Remove" ? change.crn : "",
        change.action === "Add" ? change.crn : "",
        change.courseCode,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
