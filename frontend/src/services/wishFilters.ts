/**
 * What the Timetable preferences list can be filtered on, with the tables' own filter bar.
 *
 * Every fact a row shows is a column here, so "who was invited and hasn't opened it" or
 * "who has more than 8 hours of constraints a week" is a chip or two, not a scroll.
 */

import type { GridColumn } from "@/services/studentColumns";
import { recurringConstraintHours, type WishTeacher } from "@/services/teacherWishes";

const column = (
  id: string,
  displayName: string,
  type: GridColumn<WishTeacher>["type"],
  accessor: (row: WishTeacher) => unknown,
): GridColumn<WishTeacher> => ({ id, displayName, type, accessor, defaultWidth: 120 });

const count = (row: WishTeacher, kind: "constraint" | "preference") =>
  (row.wishes?.blocks ?? []).filter((block) => block.kind === kind).length;

/** How far a teacher's invitation got, in the words the row and the filter use. */
export function invitationStage(row: WishTeacher): "Not invited" | "Invited" | "Opened" | "Signed in" {
  if (!row.invitation) return "Not invited";
  if (row.invitation.signedInAt) return "Signed in";
  return row.invitation.openedAt ? "Opened" : "Invited";
}

/** Who gave the answer: the teacher through their link, or a coordinator for them. */
export function enteredBy(row: WishTeacher): "No answer" | "The teacher" | "A coordinator" {
  if (!row.wishes) return "No answer";
  return row.wishes.source === "coordinator" ? "A coordinator" : "The teacher";
}

export const WISH_COLUMNS: GridColumn<WishTeacher>[] = [
  column("name", "Name", "text", (row) => row.name),
  column("email", "E-mail", "text", (row) => row.email || "No email"),
  column("constraints", "Constraints", "number", (row) => count(row, "constraint")),
  column("weekly", "Constraint hours a week", "number", (row) => (row.wishes ? recurringConstraintHours(row.wishes.blocks) : 0)),
  column("preferences", "Preferences", "number", (row) => count(row, "preference")),
  column("entered", "Entered by", "option", enteredBy),
  column("invitation", "Invitation", "option", invitationStage),
];
