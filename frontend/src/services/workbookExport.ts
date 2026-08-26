/**
 * Writing a semester back out as the workbook it came from.
 *
 * Built in the browser, deliberately. The file has a Student Full Name column and this
 * application holds no names — they arrive from the registrar extension and live in this
 * tab only. Assembling the workbook here is the only way to fill that column without a
 * name ever reaching the server, which is the rule the whole student database is built on.
 *
 * It is the same file, not merely a readable one: the tabs a coordinator's blocks were laid
 * out on, the amber columns they type in and the green ones they must not, the dropdowns,
 * the frozen panes, the Legend. A workbook that parses but looks like something else is a
 * workbook somebody has to re-make by hand before they can use it.
 *
 *   <tab>       # · Student ID · Student Full Name · Program, then per block on that tab
 *               its amber group column and a green CRN column per course
 *   Reference   four title rows, a blank, the header at row 6, one row per CRN, and the
 *               group lists off to the right that the dropdowns read from
 *   Legend      what each group stands for, block by block
 *
 * What is not written back is "Notes & assumptions": it is prose about the decisions taken
 * when a particular workbook was built, and inventing it here would be putting words in
 * somebody's mouth.
 */

const HEADER_FILL = "FF1F3864";
/** Amber: the columns a coordinator types in. */
const TYPE_HERE_FILL = "FFBF8F00";
const TYPED_CELL_FILL = "FFFFF2CC";
/** Green: filled by formula, and overwriting one breaks the sheet. */
const CALCULATED_FILL = "FFEDF3EC";
const BAND_FILL = "FFF2F6FC";
const HEADER_TEXT = "FFFFFFFF";

/** One block, as the catalogue holds it. */
export type ExportBlock = {
  code: string;
  name: string;
  /** The student tab this block's column lives on. Blocks sharing a tab share a sheet. */
  tab: string;
  /** What the column is called there: "TD group", "Readiness group". */
  groupColumn: string;
  /** Which column it was, so two blocks on one tab come back in the order they were in. */
  columnIndex?: number;
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
  /** The programme the portal has them on, when this browser knows it. */
  program?: string;
};

export type ExportInput = {
  cohortName: string;
  /** Names the ranges: FYS_CRN, FYS_KEY… taken from the cohort so a file reads as its own. */
  prefix: string;
  blocks: ExportBlock[];
  students: ExportStudent[];
  /** "Semester 1 2026-27", for the sheets that say what they are. */
  semester?: string;
};

const REFERENCE_HEADERS = [
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

const REFERENCE_WIDTHS = [11, 10, 9, 14, 38, 12, 26, 15, 20, 22];
/** #, Student ID, Student Full Name, Program — the four every tab starts with. */
const STUDENT_WIDTHS = [13, 15, 38, 16];
const FIRST_BLOCK_COLUMN = 5;

/** `TD|3|MATH001` — the key the student tabs look a group up by. */
export function helperKey(scopeCode: string, groupLabel: string, courseCode: string): string {
  return `${scopeCode}|${groupLabel}|${courseCode}`;
}

/** The formula a CRN cell carries, which is also how the block is read back out. */
export function crnFormula(
  prefix: string,
  scopeCode: string,
  groupColumn: string,
  courseCode: string,
  row: number,
): string {
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

/** A defined name for one block's group list, which its dropdown reads from. */
export function groupsName(prefix: string, scopeCode: string): string {
  return `${prefix}_${scopeCode.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_GROUPS`;
}

/** `A`, `B` … `AA`. */
export function columnLetter(index: number): string {
  let rest = index;
  let letters = "";
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    rest = Math.floor((rest - remainder) / 26);
  }
  return letters;
}

/**
 * The blocks grouped onto the tabs they were laid out on.
 *
 * A block with no tab recorded — one added by hand, or stored before the layout was kept —
 * gets a tab of its own named after it, which is what this used to do for all of them.
 */
export function tabsOf(blocks: ExportBlock[]): { title: string; blocks: ExportBlock[] }[] {
  const tabs: { title: string; blocks: ExportBlock[] }[] = [];
  for (const block of blocks) {
    const title = (block.tab || block.code).slice(0, 31);
    const held = tabs.find((tab) => tab.title === title);
    if (held) held.blocks.push(block);
    else tabs.push({ title, blocks: [block] });
  }
  // Within a tab, the order the columns were in — tutorials before readiness, because
  // that is where the coordinator put them and a swapped pair is a different sheet.
  for (const tab of tabs) {
    tab.blocks.sort((left, right) => (left.columnIndex ?? 0) - (right.columnIndex ?? 0));
  }
  return tabs;
}

/** Where each block's amber column sits on its tab, and where its courses start. */
export function columnsOf(blocks: ExportBlock[]): { block: ExportBlock; group: number; courses: number }[] {
  let next = FIRST_BLOCK_COLUMN;
  return blocks.map((block) => {
    const group = next;
    next += 1 + block.courses.length;
    return { block, group, courses: group + 1 };
  });
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
          block.tab || block.code,
          block.groupColumn || `${block.code} group`,
          helperKey(block.code, group.label, course.code),
        ]);
      }
    }
  }
  return rows.sort((left, right) =>
    String(left[0]).localeCompare(String(right[0]), undefined, { numeric: true }),
  );
}

/** As much of an exceljs worksheet as this file touches. */
type Sheet = {
  getCell: (row: number, column: number) => Record<string, unknown>;
  getRow: (row: number) => Record<string, unknown>;
  getColumn: (column: number) => Record<string, unknown>;
  views: { state?: string; xSplit?: number; ySplit?: number }[];
  autoFilter: string;
  dataValidations?: { add: (range: string, rule: unknown) => void };
};

function paint(cell: Record<string, unknown>, colour: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colour } };
}

/**
 * Column widths, set in one pass once the sheet is written.
 *
 * Set as the columns are made, only the first few survive: exceljs decides what a column
 * is when the first row is added, and widths given to columns it has not met yet are lost.
 */
function widen(sheet: Sheet, widths: number[]): void {
  widths.forEach((width, index) => {
    if (width > 0) sheet.getColumn(index + 1).width = width;
  });
}

function heading(sheet: Sheet, row: number, column: number, text: string, amber = false): void {
  const cell = sheet.getCell(row, column);
  cell.value = text;
  cell.font = { bold: true, color: { argb: HEADER_TEXT } };
  cell.alignment = { wrapText: true, vertical: "middle" };
  paint(cell, amber ? TYPE_HERE_FILL : HEADER_FILL);
}

/**
 * Build the file. `exceljs` is imported here rather than at the top so it lands in a chunk
 * of its own — it is a megabyte, and nobody who is not exporting should pay for it.
 */
export async function buildWorkbookBuffer(input: ExportInput): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();

  const tabs = tabsOf(input.blocks);
  for (const tab of tabs) writeStudentTab(book.addWorksheet(tab.title) as unknown as Sheet, tab.blocks, input);
  writeReference(book, book.addWorksheet("Reference") as unknown as Sheet, input);
  writeLegend(book.addWorksheet("Legend") as unknown as Sheet, input);
  addValidation(book, input);

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function writeStudentTab(sheet: Sheet, blocks: ExportBlock[], input: ExportInput): void {
  heading(sheet, 1, 1, "#");
  heading(sheet, 1, 2, "Student ID");
  heading(sheet, 1, 3, "Student Full Name");
  heading(sheet, 1, 4, "Program");

  const placed = columnsOf(blocks);
  for (const { block, group, courses } of placed) {
    heading(sheet, 1, group, `${block.groupColumn || `${block.code} group`}\n◀ TYPE HERE`, true);
    block.courses.forEach((course, offset) => {
      const suffix = course.component ? ` (${course.component})` : "";
      heading(sheet, 1, courses + offset, `${course.code}\n${course.name}${suffix}`);
    });
  }

  sheet.getRow(1).height = 52;
  // Frozen so the four identifying columns and the heading stay put while a long list of
  // students is scrolled — which is the only way the amber columns stay identifiable.
  sheet.views = [{ state: "frozen", xSplit: FIRST_BLOCK_COLUMN - 1, ySplit: 1 }];
  const lastColumn = placed.length
    ? placed[placed.length - 1].courses + placed[placed.length - 1].block.courses.length - 1
    : 4;
  sheet.autoFilter = `A1:${columnLetter(lastColumn)}${input.students.length + 1}`;

  widen(sheet, [
    ...STUDENT_WIDTHS,
    ...placed.flatMap(({ block }) => [16, ...block.courses.map(() => 16)]),
  ]);

  input.students.forEach((student, index) => {
    const row = index + 2;
    sheet.getCell(row, 1).value = index + 1;
    sheet.getCell(row, 2).value = student.studentId;
    sheet.getCell(row, 3).value = student.name;
    sheet.getCell(row, 4).value = student.program ?? "";

    for (const { block, group, courses } of placed) {
      const letter = columnLetter(group);
      const typed = sheet.getCell(row, group);
      typed.value = student.groups[block.code] ?? "";
      typed.font = { bold: true };
      typed.alignment = { horizontal: "center" };
      paint(typed, TYPED_CELL_FILL);

      block.courses.forEach((course, offset) => {
        const cell = sheet.getCell(row, courses + offset);
        cell.value = { formula: crnFormula(input.prefix, block.code, letter, course.code, row) };
        cell.alignment = { horizontal: "center" };
        paint(cell, CALCULATED_FILL);
      });
    }
  });
}

function writeReference(book: { definedNames: { add: (range: string, name: string) => void } }, sheet: Sheet, input: ExportInput): void {
  const title = sheet.getCell(1, 1);
  title.value = `${input.cohortName} — Reference: CRN ⇄ group`;
  title.font = { bold: true, size: 14 };
  for (const [row, text] of [
    [2, "Primary key is CRN (column A). Column J is a scope-qualified helper key, <Scope>|<Group>|<Course Code>, used by the data tabs."],
    [3, `CRN → group     VLOOKUP(<crn>, ${input.prefix}_LOOKUP, 2, FALSE)`],
    [4, `group → CRN     INDEX(${input.prefix}_CRN, MATCH("TD|1|MATH001", ${input.prefix}_KEY, 0))`],
  ] as [number, string][]) {
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { size: 10 };
  }

  REFERENCE_HEADERS.forEach((label, index) => heading(sheet, 6, index + 1, label));
  sheet.getRow(6).height = 28;

  const rows = referenceRows(input.blocks);
  // Banded by block, so a block's rows read as one thing among the CRN ordering.
  const bandedBlocks = new Set(input.blocks.filter((_, index) => index % 2 === 1).map((block) => block.code));
  rows.forEach((values, index) => {
    const row = 7 + index;
    values.forEach((value, column) => {
      const cell = sheet.getCell(row, column + 1);
      cell.value = value;
      cell.font = { size: 10, bold: column === 1 };
      if (column === 0) paint(cell, TYPED_CELL_FILL);
      else if (bandedBlocks.has(String(values[2]))) paint(cell, BAND_FILL);
    });
  });

  const last = 6 + rows.length;
  sheet.views = [{ state: "frozen", ySplit: 6 }];
  sheet.autoFilter = `A6:J${Math.max(last, 7)}`;

  // The lists the dropdowns read from, off to the right of the sheet they belong to.
  input.blocks.forEach((block, index) => {
    const column = 13 + index;
    const header = sheet.getCell(6, column);
    header.value = `${block.tab || block.code} · ${block.groupColumn || `${block.code} group`}`;
    header.font = { bold: true, size: 9 };
    header.alignment = { wrapText: true };
    block.groups.forEach((group, offset) => {
      sheet.getCell(7 + offset, column).value = group.label;
    });
    if (block.groups.length > 0) {
      const letter = columnLetter(column);
      book.definedNames.add(
        `Reference!$${letter}$7:$${letter}$${6 + block.groups.length}`,
        groupsName(input.prefix, block.code),
      );
    }
  });

  widen(sheet, [...REFERENCE_WIDTHS, 0, 0, ...input.blocks.map(() => 20)]);

  // Without these the workbook opens with #NAME? in every CRN cell.
  if (rows.length) {
    book.definedNames.add(`Reference!$A$7:$J$${last}`, `${input.prefix}_LOOKUP`);
    book.definedNames.add(`Reference!$A$7:$A$${last}`, `${input.prefix}_CRN`);
    book.definedNames.add(`Reference!$J$7:$J$${last}`, `${input.prefix}_KEY`);
  }
}

/** What each group stands for, block by block — the sheet a coordinator reads, not Excel. */
function writeLegend(sheet: Sheet, input: ExportInput): void {
  const title = sheet.getCell(1, 1);
  title.value = `${input.cohortName} — Legend: groups and the CRNs they hold`;
  title.font = { bold: true, size: 14 };
  const note = sheet.getCell(2, 1);
  note.value = "Which CRNs make up each group. The data tabs work from these, so a group is a bundle rather than a list to copy.";
  note.font = { size: 10 };

  sheet.getColumn(1).width = 13;
  let row = 4;
  for (const block of input.blocks) {
    const banner = sheet.getCell(row, 1);
    banner.value = `Tab “${block.tab || block.code}”  →  column “${block.groupColumn || `${block.code} group`}”`;
    banner.font = { bold: true, size: 10 };
    paint(banner, "FFE7E6E6");
    row += 1;

    const header = sheet.getCell(row, 1);
    header.value = "Group";
    header.font = { bold: true, size: 9 };
    header.alignment = { wrapText: true };
    paint(header, "FFD9E2F3");
    block.courses.forEach((course, offset) => {
      const cell = sheet.getCell(row, 2 + offset);
      const suffix = course.component ? `\n(${course.component})` : "";
      cell.value = `${course.name || course.code}${suffix}`;
      cell.font = { bold: true, size: 9 };
      cell.alignment = { wrapText: true };
      paint(cell, "FFD9E2F3");
      sheet.getColumn(2 + offset).width = 28;
    });
    sheet.getRow(row).height = 34;
    row += 1;

    for (const group of block.groups) {
      const label = sheet.getCell(row, 1);
      label.value = group.label;
      label.font = { bold: true, size: 10 };
      block.courses.forEach((course, offset) => {
        const held = group.crns[course.id];
        const cell = sheet.getCell(row, 2 + offset);
        cell.value = held?.crn ? `${held.crn}${held.teacher ? `\n${held.teacher}` : ""}` : "";
        cell.font = { size: 9 };
        cell.alignment = { wrapText: true };
      });
      sheet.getRow(row).height = 26;
      row += 1;
    }
    row += 1;
  }
}

/** The dropdown on each amber column, so a group is chosen rather than typed wrongly. */
function addValidation(book: { getWorksheet: (name: string) => unknown }, input: ExportInput): void {
  for (const tab of tabsOf(input.blocks)) {
    const sheet = book.getWorksheet(tab.title) as Sheet | undefined;
    if (!sheet?.dataValidations) continue;
    for (const { block, group } of columnsOf(tab.blocks)) {
      if (block.groups.length === 0) continue;
      const letter = columnLetter(group);
      sheet.dataValidations.add(`${letter}2:${letter}${Math.max(input.students.length + 1, 2)}`, {
        type: "list",
        allowBlank: true,
        formulae: [`=${groupsName(input.prefix, block.code)}`],
        showErrorMessage: true,
        errorTitle: "Not a group of this block",
        error: "Pick one of the groups listed for this column.",
      });
    }
  }
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
