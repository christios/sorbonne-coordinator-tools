/**
 * Writing a semester back out as the workbook it came from.
 *
 * Built in the browser, deliberately. The file has a Student Full Name column and this
 * application holds no names — they arrive from the registrar extension and live in this
 * tab only. Assembling the workbook here is the only way to fill that column without a name
 * ever reaching the server, which is the rule the whole student database is built on.
 *
 * The shape is the real one, because the point is that it can be uploaded again:
 *
 *   Reference   four title rows, a blank, then CRN | Group | Scope | … | Helper key
 *   <block>     one tab per block: id, name, the typed group, then a CRN per course
 *
 * The CRN columns are the same INDEX/MATCH formulas the coordinator's template uses, so a
 * group typed into the workbook still resolves to a CRN in Excel — and so `parse_group_
 * assignments` can still read the block out of the formula when it comes back.
 */

/** One block, as the catalogue holds it. */
export type ExportBlock = {
  code: string;
  name: string;
  courses: { id: string; code: string; name: string; component: string }[];
  groups: {
    id: string;
    label: string;
    capacity: number;
    note: string;
    crns: Record<string, { crn: string; teacher: string }>;
  }[];
};

export type ExportStudent = {
  studentId: string;
  name: string;
  /** Block code -> the group they are in. */
  groups: Record<string, string>;
};

export type ExportInput = {
  cohortName: string;
  /** Names the ranges: FYS_CRN, FYS_KEY… taken from the cohort so a file reads as its own. */
  prefix: string;
  blocks: ExportBlock[];
  students: ExportStudent[];
};

const HEADERS = [
  "CRN",
  "Group",
  "Scope",
  "Course Code",
  "Course Name",
  "Component",
  "Teacher",
  "Tab",
  "Group column",
  "Helper key",
];

/** `TD|3|MATH001` — the key the student tabs look a group up by. */
export function helperKey(scopeCode: string, groupLabel: string, courseCode: string): string {
  return `${scopeCode}|${groupLabel}|${courseCode}`;
}

/** The formula a CRN cell carries, which is also how the block is read back out. */
export function crnFormula(prefix: string, scopeCode: string, groupColumn: string, courseCode: string, row: number): string {
  return (
    `IF($${groupColumn}${row}="","",IFERROR(INDEX(${prefix}_CRN,` +
    `MATCH("${scopeCode}|"&$${groupColumn}${row}&"|${courseCode}",${prefix}_KEY,0)),"group?"))`
  );
}

/** A prefix Excel will accept in a defined name: letters, digits and underscores. */
export function prefixOf(cohortName: string): string {
  const cleaned = cohortName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Z]/.test(cleaned) ? cleaned.slice(0, 20) : `C_${cleaned}`.slice(0, 20);
}

/** Every Reference row, in the order the sheet holds them: sorted by CRN. */
export function referenceRows(blocks: ExportBlock[]): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const block of blocks) {
    const codeOf = new Map(block.courses.map((course) => [course.id, course]));
    for (const group of block.groups) {
      for (const [courseId, cell] of Object.entries(group.crns)) {
        const course = codeOf.get(courseId);
        if (!course || !cell.crn) continue;
        rows.push([
          cell.crn,
          group.label,
          block.code,
          course.code,
          course.name,
          course.component,
          cell.teacher,
          block.code,
          `${block.code} group`,
          helperKey(block.code, group.label, course.code),
        ]);
      }
    }
  }
  return rows.sort((left, right) => String(left[0]).localeCompare(String(right[0]), undefined, { numeric: true }));
}

/**
 * Build the file. `exceljs` is imported here rather than at the top so it lands in a chunk
 * of its own — it is a megabyte, and nobody who is not exporting should pay for it.
 */
export async function buildWorkbookBuffer(input: ExportInput): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();

  const reference = book.addWorksheet("Reference");
  reference.addRow([`${input.cohortName} — Reference: CRN ⇄ group`]);
  reference.addRow(["Primary key is CRN (column A). Column J is a scope-qualified helper key, <Scope>|<Group>|<Course Code>, used by the data tabs."]);
  reference.addRow([`CRN → group     VLOOKUP(<crn>, ${input.prefix}_LOOKUP, 2, FALSE)`]);
  reference.addRow([`group → CRN     INDEX(${input.prefix}_CRN, MATCH("TD|1|MATH001", ${input.prefix}_KEY, 0))`]);
  reference.addRow([]);
  reference.addRow(HEADERS);

  const rows = referenceRows(input.blocks);
  rows.forEach((row) => reference.addRow(row));
  reference.getRow(6).font = { bold: true };

  // The names the student tabs' formulas resolve through. Without these the workbook opens
  // with #NAME? in every CRN cell and stops being the file it claims to be.
  const last = 6 + rows.length;
  if (rows.length) {
    book.definedNames.add(`Reference!$A$7:$J$${last}`, `${input.prefix}_LOOKUP`);
    book.definedNames.add(`Reference!$A$7:$A$${last}`, `${input.prefix}_CRN`);
    book.definedNames.add(`Reference!$J$7:$J$${last}`, `${input.prefix}_KEY`);
  }

  for (const block of input.blocks) {
    const sheet = book.addWorksheet(block.code.slice(0, 31));
    const groupColumn = "C";
    sheet.addRow([
      "Student ID",
      "Student Full Name",
      `${block.code} group\n◀ TYPE HERE`,
      ...block.courses.map((course) => `${course.code}\n${course.name}`),
    ]);
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 26;

    input.students.forEach((student, index) => {
      const row = sheet.addRow([student.studentId, student.name, student.groups[block.code] ?? ""]);
      block.courses.forEach((course, offset) => {
        row.getCell(4 + offset).value = {
          formula: crnFormula(input.prefix, block.code, groupColumn, course.code, index + 2),
        };
      });
    });
  }

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export const SPREADSHEET_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Hand the finished file to the browser. Nothing here has been anywhere near the server. */
export async function downloadWorkbook(input: ExportInput, filename: string): Promise<void> {
  const blob = new Blob([await buildWorkbookBuffer(input)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
