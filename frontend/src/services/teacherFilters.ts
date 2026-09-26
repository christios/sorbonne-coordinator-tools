/**
 * What the Part-time Teachers list can be filtered on, with the tables' own filter bar.
 *
 * Every fact a row shows is a column here — the hours on the requisitions, the newest
 * time sheet, the documents, the tasks — so a question like "who has admin hours and no
 * documents yet" is two chips rather than a scroll down two dozen rows.
 */

import { taskUrgency } from "@/components/taskPresentation";
import { shortPeriodLabel } from "@/services/payPeriods";
import type { GridColumn } from "@/services/studentColumns";
import type { Teacher, TeacherSummary } from "@/services/teachers";
import type { ScopedTask } from "@/services/workflow";

/** A row of the list, as the filters read it. */
export type TeacherFilterRow = {
  teacher: Teacher;
  summary?: TeacherSummary;
  tasks: ScopedTask[];
  /** "Physics › Autumn", or "" for a teacher in no folder. */
  folder: string;
};

const column = (
  id: string,
  displayName: string,
  type: GridColumn<TeacherFilterRow>["type"],
  accessor: (row: TeacherFilterRow) => unknown,
): GridColumn<TeacherFilterRow> => ({ id, displayName, type, accessor, defaultWidth: 120 });

/** Where their tasks stand, in the words the filter offers. */
export function taskStanding(tasks: ScopedTask[], today = new Date()): string {
  if (!tasks.length) return "No tasks";
  if (tasks.some((task) => taskUrgency(task, today) === "OVERDUE")) return "Overdue";
  if (tasks.some((task) => taskUrgency(task, today) === "DUE_SOON")) return "Due soon";
  return tasks.every((task) => task.status === "COMPLETED") ? "All done" : "In hand";
}

export const TEACHER_COLUMNS: GridColumn<TeacherFilterRow>[] = [
  column("name", "Name", "text", (row) => row.teacher.fullName),
  column("email", "E-mail", "text", (row) => row.teacher.email || "No email"),
  column("folder", "Folder", "option", (row) => row.folder || "No folder"),
  column("requisitions", "Requisitions", "number", (row) => row.summary?.requisitions ?? 0),
  column("teaching", "Teaching hours", "number", (row) => row.summary?.contractedHours ?? 0),
  column("admin", "Admin hours", "number", (row) => row.summary?.adminHours ?? 0),
  column("sheet", "Time sheet", "option", (row) => {
    const sheet = row.summary?.newestTimeSheet;
    if (!sheet) return "No time sheet";
    return sheet.periodStart ? shortPeriodLabel(sheet.periodStart) : "No period";
  }),
  column("documents", "Documents", "option", (row) => (row.summary?.hasDocuments ? "Documents" : "No documents")),
  column("tasks", "Tasks", "option", (row) => taskStanding(row.tasks)),
];
