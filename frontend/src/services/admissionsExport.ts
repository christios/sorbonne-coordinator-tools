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

import { type CatalogueGroup, type CatalogueScope, partsOf, sectionFor } from "@/services/studentDatabase";
import { SPREADSHEET_TYPE } from "@/services/workbookExport";

const HEADER_FILL = "FF44546A";
const HEADER_TEXT = "FFFFFFFF";

export type AdmissionsColumn = {
  /** "MATH001 TD CRN" — the course, its component, and what the cell holds. */
  header: string;
  scopeId: string;
  courseId: string;
  /**
   * Which half, from 0. A course handed from one professor to another at mid-semester is
   * a CRN per half, and a student is registered in both from the start — so it takes a
   * column per half, each holding one CRN as every other column does.
   */
  part: number;
};

export type AdmissionsStudent = {
  studentId: string;
  name: string;
  /** `scope id -> group id`, the groups this student holds. */
  groups: Record<string, string>;
  /**
   * `scope id -> major id`, the sub-row they sit on in a group that has them. Their
   * major's own cell stands over the group's shared one, and a major not taught a course
   * gets no CRN for it — the same reading as their record and the registration check.
   */
  majors?: Record<string, string>;
};

/** The CRNs a group gives a student on one sub-row for one course, in the order taught. */
function crnsFor(group: CatalogueGroup, majorId: string, courseId: string): string[] {
  return partsOf(sectionFor(group, majorId, courseId))
    .filter((part) => part.crn && !part.retired)
    .map((part) => part.crn);
}

/** "(2nd half)" for the second of two, and a plain count beyond that, which nothing has yet. */
function partLabel(part: number): string {
  return part === 1 ? " (2nd half)" : ` (part ${part + 1})`;
}

/**
 * One column per course of every block, in the order the page shows them — and one more
 * per extra half, for a course any group of the block teaches in more than one.
 */
export function admissionsColumns(scopes: CatalogueScope[]): AdmissionsColumn[] {
  return scopes.flatMap((scope) =>
    scope.courses.flatMap((course) => {
      const halves = Math.max(
        1,
        ...scope.groups.flatMap((group) =>
          ["", ...(group.majors ?? []).map((major) => major.id)].map((majorId) => crnsFor(group, majorId, course.id).length),
        ),
      );
      return Array.from({ length: halves }, (_, part) => ({
        header: `${course.code} ${course.component || scope.code} CRN${part ? partLabel(part) : ""}`,
        scopeId: scope.id,
        courseId: course.id,
        part,
      }));
    }),
  );
}

/**
 * The rows, sorted by name as admissions read them. A cell is the CRN the student's
 * group holds for that course and half, and blank when they are in no group for the block,
 * the group has no CRN there, or their major is not taught the course — never a guess.
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
        if (!group) return null;
        return crnsFor(group, student.majors?.[column.scopeId] ?? "", column.courseId)[column.part] || null;
      }),
    }));
}

/**
 * "SCEN-L1-CRN-Enroll-26-27": the sheet's name, as the files admissions already have.
 *
 * The department's name in front and the year on the end, because these land in an inbox
 * beside the same file from three other cohorts and last year's. Within the 31 characters
 * Excel allows, the year going first if something has to be dropped — a truncated name is
 * still recognisable, a wrong year is not.
 */
export function admissionsSheetName(prefix: string, year = ""): string {
  const tail = year ? `-${year}` : "";
  const head = `SCEN-${prefix}-CRN-Enroll`;
  return `${head.slice(0, 31 - tail.length)}${tail}`;
}

export async function buildAdmissionsBuffer(input: {
  prefix: string;
  /** "26-27", so a file in an inbox says which year it is for. */
  year?: string;
  scopes: CatalogueScope[];
  students: AdmissionsStudent[];
}): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const sheet = book.addWorksheet(admissionsSheetName(input.prefix, input.year ?? ""));

  const columns = admissionsColumns(input.scopes);
  const headers = ["Student ID", "Student Full Name", ...columns.map((column) => column.header)];
  const widths = [14, 44, ...columns.map(() => 15)];
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
