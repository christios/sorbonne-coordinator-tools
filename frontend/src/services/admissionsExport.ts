/**
 * The admissions list: one flat sheet of who to register in which CRNs.
 *
 * Admissions do not want the workbook — its tabs, formulas and legend are the
 * coordinator's working papers. They want a list they can register from: one row per
 * student, one CRN column per course component, blank where a course does not apply to
 * that student. That is the file the L1 and Language cycles handed over by script; this
 * derives it from the same groups the registrar template and the Student Hub are fed
 * from, so the three cannot disagree.
 *
 * Built in the browser for the same reason as the workbook: it carries names, and the
 * server holds none.
 */

import type { CatalogueScope } from "@/services/studentDatabase";
import { SPREADSHEET_TYPE } from "@/services/workbookExport";

const HEADER_FILL = "FF44546A";
const HEADER_TEXT = "FFFFFFFF";

export type AdmissionsColumn = {
  /** "MATH001 TD CRN" — the course, its component, and what the cell holds. */
  header: string;
  scopeId: string;
  courseId: string;
};

export type AdmissionsStudent = {
  studentId: string;
  name: string;
  /** `scope id -> group id`, the groups this student holds. */
  groups: Record<string, string>;
};

/** One column per course of every block, in the order the page shows them. */
export function admissionsColumns(scopes: CatalogueScope[]): AdmissionsColumn[] {
  return scopes.flatMap((scope) =>
    scope.courses.map((course) => ({
      header: `${course.code} ${course.component || scope.code} CRN`,
      scopeId: scope.id,
      courseId: course.id,
    })),
  );
}

/**
 * The rows, sorted by name as admissions read them. A cell is the CRN the student's
 * group holds for that course, and blank when they are in no group for the block or the
 * group has no CRN there — never a guess.
 */
export function admissionsRows(
  scopes: CatalogueScope[],
  students: AdmissionsStudent[],
): { studentId: string; name: string; crns: (string | null)[] }[] {
  const columns = admissionsColumns(scopes);
  const groupsById = new Map(scopes.flatMap((scope) => scope.groups.map((group) => [group.id, group] as const)));

  return [...students]
    .sort((left, right) => left.name.localeCompare(right.name) || left.studentId.localeCompare(right.studentId))
    .map((student) => ({
      studentId: student.studentId,
      name: student.name,
      crns: columns.map((column) => {
        const group = groupsById.get(student.groups[column.scopeId] ?? "");
        return group?.crns[column.courseId]?.crn || null;
      }),
    }));
}

/** The sheet's name, within the 31 characters Excel allows. */
export function admissionsSheetName(prefix: string): string {
  return `${prefix}-CRN-Enroll`.slice(0, 31);
}

export async function buildAdmissionsBuffer(input: {
  prefix: string;
  scopes: CatalogueScope[];
  students: AdmissionsStudent[];
}): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const sheet = book.addWorksheet(admissionsSheetName(input.prefix));

  const columns = admissionsColumns(input.scopes);
  const headers = ["Student ID", "Student Full Name", ...columns.map((column) => column.header)];
  const widths = [14, 44, ...columns.map(() => 16)];
  sheet.addRow(headers);
  headers.forEach((_, index) => {
    const cell = sheet.getCell(1, index + 1);
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  sheet.getRow(1).height = 22;

  const rows = admissionsRows(input.scopes, input.students);
  for (const row of rows) {
    sheet.addRow([row.studentId, row.name, ...row.crns.map((crn) => (crn ? Number(crn) || crn : null))]);
  }
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Hand the file to the browser. Nothing here has been anywhere near the server. */
export async function downloadAdmissionsList(
  input: Parameters<typeof buildAdmissionsBuffer>[0],
  filename: string,
): Promise<void> {
  const blob = new Blob([await buildAdmissionsBuffer(input)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
