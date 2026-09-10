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
    /** The programme this group takes first, when it takes one. Empty means any. */
    program?: string;
    crns: Record<string, { crn: string; teacher: string; teacherId?: string }>;
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
  /** A course code to the UE the workbook keys on: MATH100 → UL1MA001. */
  ueOf?: (courseCode: string) => string;
  /**
   * The name to print for a section's teacher.
   *
   * A section carries two: the name the registrar's row happened to say, and the Active
   * teacher somebody afterwards chose. The chosen one is the answer where there is one,
   * and the file printed neither unless the row had text on it — so a course staffed
   * properly on the platform came out with an empty Teacher column.
   */
  teacherOf?: (section: { teacher: string; teacherId?: string }) => string;
};

/** The chosen Active teacher, else whatever the row said. */
export function teacherName(
  input: { teacherOf?: (section: { teacher: string; teacherId?: string }) => string },
  section: { teacher: string; teacherId?: string },
): string {
  return input.teacherOf?.(section) ?? section.teacher;
}

const REFERENCE_HEADERS = [
  "CRN",
  "Group",
  "Scope",
  "UE code",
  "Course Name",
  "Component",
  "Teacher",
  "Tab",
  "Group column",
  "Helper key",
];

const REFERENCE_WIDTHS = [11, 10, 9, 14, 38, 12, 26, 15, 20, 22];
/** #, Student ID, Student Full Name, Program — the four every tab starts with. */
const CAPACITY_HEADERS = [
  "CRN",
  "UE",
  "Course",
  "Component",
  "Group",
  "Teacher",
  "Capacity",
  "Enrolled",
  "Seats free",
  "Status",
  "Note",
];
const CAPACITY_WIDTHS = [12.3, 15.1, 41.1, 15.1, 11, 30.1, 13.7, 13.7, 15.1, 12.3, 63.1];
const STUDENT_WIDTHS = [13, 15, 38, 17];
/** The amber group column, and each green CRN column after it. */
const GROUP_WIDTH = 15;
const COURSE_WIDTH = 16;
/**
 * Blank rows kept under the students, formulas and dropdowns and all.
 *
 * The file is worked in: somebody arrives in October and is typed onto the end of the tab.
 * Without a buffer their row has no formula in it and no dropdown on it, and the CRN
 * columns beside them stay empty with nothing to say why.
 */
const SPARE_ROWS = 20;
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

/**
 * What a course is called in the workbook's columns and helper keys: its UE code.
 *
 * `UL1MA001`, not `MATH100`. The UE is the Sorbonne unit — the thing Paris registers and
 * the thing the file has always been keyed on — while the subject-and-number is the
 * registrar's local code for the same teaching. A workbook keyed the other way looks
 * right and matches nothing anybody has.
 */
export function keyOf(input: { ueOf?: (courseCode: string) => string }, course: { code: string }): string {
  return input.ueOf?.(course.code) || course.code;
}

/** A prefix Excel will accept in a defined name: letters, digits and underscores. */
export function prefixOf(cohortName: string): string {
  const cleaned = cohortName.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Z]/.test(cleaned) ? cleaned.slice(0, 20) : `C_${cleaned}`.slice(0, 20);
}

/**
 * "2026-27" → "26-27": the academic year as the file names have it.
 *
 * The department writes the year both ways — "2026-2027" in a syllabus, "26-27" on a
 * workbook — and the workbooks are what these files sit beside, so this is the short one.
 */
export function shortYear(term: string): string {
  const years = term.match(/\d{2,4}/g) ?? [];
  const short = years.map((year) => year.slice(-2));
  return short.length >= 2 ? `${short[0]}-${short[1]}` : short[0] ?? "";
}

/** The name of the programme list the Program column is chosen from. */
export function programsName(prefix: string): string {
  return `${prefix}_PROGRAMS`;
}

/** Every programme anybody in this file belongs to, or that a group prefers. */
export function programsIn(input: ExportInput): string[] {
  const held = new Set<string>();
  for (const student of input.students) if (student.program) held.add(student.program);
  for (const block of input.blocks) for (const group of block.groups) if (group.program) held.add(group.program);
  return [...held].sort((left, right) => left.localeCompare(right));
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

/**
 * The green CRN columns of one tab, as the contiguous runs they form.
 *
 * A tab is amber column, its courses, amber column, its courses — so the CRN cells are
 * several runs rather than one range, and a tally has to look through each of them. The
 * amber columns in between hold group labels like "1", which would otherwise be counted
 * as CRNs on a workbook where a CRN happened to be small.
 */
export function crnRanges(blocks: ExportBlock[]): string[] {
  return columnsOf(blocks)
    .filter(({ block }) => block.courses.length > 0)
    .map(({ block, courses }) => `$${columnLetter(courses)}:$${columnLetter(courses + block.courses.length - 1)}`);
}

/** Every Reference row, in the order the sheet holds them: sorted by CRN. */
export function referenceRows(
  blocks: ExportBlock[],
  ueOf: (courseCode: string) => string = (code) => code,
  named: (section: { teacher: string; teacherId?: string }) => string = (section) => section.teacher,
): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const block of blocks) {
    const codeOf = new Map(block.courses.map((course) => [course.id, course]));
    for (const group of block.groups) {
      for (const [courseId, cell] of Object.entries(group.crns)) {
        const course = codeOf.get(courseId);
        if (!course || !cell.crn) continue;
        const key = ueOf(course.code) || course.code;
        rows.push([
          cell.crn,
          group.label,
          block.code,
          key,
          course.name,
          course.component,
          named(cell),
          block.tab || block.code,
          block.groupColumn || `${block.code} group`,
          helperKey(block.code, group.label, key),
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
  cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_TEXT } };
  cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  paint(cell, amber ? TYPE_HERE_FILL : HEADER_FILL);
}

/** The thin rule the student tabs draw around every cell. */
function ruled() {
  return (["top", "left", "bottom", "right"] as const).reduce(
    (edges, side) => ({ ...edges, [side]: { style: "thin" as const } }),
    {},
  );
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
  writeCapacity(book.addWorksheet("Capacity") as unknown as Sheet, input);
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
      heading(sheet, 1, courses + offset, `${keyOf(input, course)}\n${course.name}${suffix}`);
    });
  }

  sheet.getRow(1).height = 60.75;
  // Frozen so the four identifying columns and the heading stay put while a long list of
  // students is scrolled — which is the only way the amber columns stay identifiable.
  sheet.views = [{ state: "frozen", xSplit: FIRST_BLOCK_COLUMN - 1, ySplit: 1 }];
  const lastColumn = placed.length
    ? placed[placed.length - 1].courses + placed[placed.length - 1].block.courses.length - 1
    : 4;
  sheet.autoFilter = `A1:${columnLetter(lastColumn)}${input.students.length + 1}`;

  widen(sheet, [
    ...STUDENT_WIDTHS,
    ...placed.flatMap(({ block }) => [GROUP_WIDTH, ...block.courses.map(() => COURSE_WIDTH)]),
  ]);

  // The students, and then the blank rows under them that are ready for the next arrival.
  for (let index = 0; index < input.students.length + SPARE_ROWS; index += 1) {
    const student = input.students[index];
    const row = index + 2;
    if (student) {
      sheet.getCell(row, 1).value = index + 1;
      sheet.getCell(row, 2).value = student.studentId;
      sheet.getCell(row, 3).value = student.name;
      sheet.getCell(row, 4).value = student.program ?? "";
    }
    for (let column = 1; column <= 4; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = ruled();
    }

    for (const { block, group, courses } of placed) {
      const letter = columnLetter(group);
      const typed = sheet.getCell(row, group);
      typed.value = student ? (student.groups[block.code] ?? "") : "";
      typed.font = { name: "Calibri", size: 11, bold: true };
      typed.alignment = { horizontal: "center", vertical: "middle" };
      typed.border = ruled();
      paint(typed, TYPED_CELL_FILL);

      block.courses.forEach((course, offset) => {
        const cell = sheet.getCell(row, courses + offset);
        cell.value = { formula: crnFormula(input.prefix, block.code, letter, keyOf(input, course), row) };
        cell.font = { name: "Calibri", size: 11 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = ruled();
        paint(cell, CALCULATED_FILL);
      });
    }
  }
}

function writeReference(book: { definedNames: { add: (range: string, name: string) => void } }, sheet: Sheet, input: ExportInput): void {
  const title = sheet.getCell(1, 1);
  title.value = "Reference — CRN ⇄ group";
  title.font = { bold: true, size: 14 };
  for (const [row, text] of [
    [2, "Primary key is CRN (column A, sorted ascending). Column J is a SCOPE-QUALIFIED helper key, <Scope>|<Group>|<UE code>, used by the data tabs."],
    [3, `CRN → group     VLOOKUP(<crn>, ${input.prefix}_LOOKUP, 2, FALSE)`],
    [4, `group → CRN     INDEX(${input.prefix}_CRN, MATCH("TD|1|MATH001", ${input.prefix}_KEY, 0))`],
  ] as [number, string][]) {
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { size: 10 };
  }

  REFERENCE_HEADERS.forEach((label, index) => heading(sheet, 6, index + 1, label));
  sheet.getRow(6).height = 28;

  const rows = referenceRows(input.blocks, (code) => input.ueOf?.(code) || code, (section) => teacherName(input, section));
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
  const listsBanner = sheet.getCell(6, 12);
  listsBanner.value = "Valid group values";
  listsBanner.font = { bold: true, size: 9 };

  /*
   * The programmes, first among the lists.
   *
   * A programme is not a group — it is what the student reads, and it decides which of the
   * optional courses apply to them — so the Program column is chosen from its own list
   * rather than from any block's groups.
   */
  const programs = programsIn(input);
  if (programs.length) {
    const header = sheet.getCell(6, 13);
    header.value = "Program";
    header.font = { bold: true, size: 9 };
    header.alignment = { wrapText: true };
    programs.forEach((program, offset) => {
      sheet.getCell(7 + offset, 13).value = program;
    });
    book.definedNames.add(`Reference!$M$7:$M$${6 + programs.length}`, programsName(input.prefix));
  }

  const firstList = programs.length ? 14 : 13;
  input.blocks.forEach((block, index) => {
    const column = firstList + index;
    const header = sheet.getCell(6, column);
    header.value = block.groupColumn || `${block.code} group`;
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

  widen(sheet, [...REFERENCE_WIDTHS, 0, 0, ...(programsIn(input).length ? [20] : []), ...input.blocks.map(() => 20)]);

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
  title.value = "Legend — groups at a glance";
  title.font = { bold: true, size: 14 };
  const note = sheet.getCell(2, 1);
  note.value = "Which CRNs make up each group. The data tabs derive these from the group you type.";
  note.font = { size: 10 };

  sheet.getColumn(1).width = 13;
  let row = 4;
  for (const block of input.blocks) {
    const banner = sheet.getCell(row, 1);
    banner.value = `Tab "${block.tab || block.code}"  →  column "${block.groupColumn || `${block.code} group`}"   (${block.groups.length} group${block.groups.length === 1 ? "" : "s"})`;
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
        const who = held ? teacherName(input, held) : "";
        cell.value = held?.crn ? `${held.crn}${who ? `\n${who}` : ""}` : "";
        cell.font = { size: 9 };
        cell.alignment = { wrapText: true };
      });
      sheet.getRow(row).height = 26;
      row += 1;
    }
    row += 1;
  }
}

/**
 * Capacity, counted by Excel rather than by us.
 *
 * The seats are the coordinator's answer and do not move; how many are taken is whatever
 * the data tabs currently say, so it is a COUNTIF over their green columns rather than a
 * number frozen at the moment the file was written. Somebody moving a student from TD 2
 * to TD 3 sees both rows change without asking anybody for a new workbook.
 */
function writeCapacity(sheet: Sheet, input: ExportInput): void {
  const title = sheet.getCell(1, 1);
  const tabs = tabsOf(input.blocks);
  title.value = `Capacity — live count from the ${tabs.map((tab) => tab.title).join(", ")} tab${tabs.length === 1 ? "" : "s"}`;
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: HEADER_FILL } };
  sheet.getRow(1).height = 18.75;
  const note = sheet.getCell(2, 1);
  note.value = "Enrolled counts the green CRN columns on the data tabs, so it updates as you edit. Capacity is the seats the group was given. Retired groups are not listed.";
  note.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF595959" } };

  CAPACITY_HEADERS.forEach((label, index) => {
    const cell = sheet.getCell(4, index + 1);
    cell.value = label;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: HEADER_TEXT } };
    cell.alignment = { horizontal: "center" };
    paint(cell, HEADER_FILL);
  });

  // One COUNTIF per run of CRN columns, over every tab, added together.
  const tally = tabs
    .flatMap((tab) => crnRanges(tab.blocks).map((range) => `COUNTIF(${quoted(tab.title)}!${range},$A%ROW%)`))
    .join("+");

  let row = 5;
  for (const block of input.blocks) {
    const courseOf = new Map(block.courses.map((course) => [course.id, course]));
    for (const group of block.groups) {
      for (const [courseId, cell] of Object.entries(group.crns)) {
        const course = courseOf.get(courseId);
        if (!course || !cell.crn) continue;
        const values: (string | number | { formula: string })[] = [
          Number(cell.crn) || cell.crn,
          input.ueOf?.(course.code) || course.code,
          course.name,
          course.component || block.code,
          Number(group.label) || group.label,
          teacherName(input, cell),
          group.capacity || "",
          { formula: tally ? tally.split("%ROW%").join(String(row)) : "0" },
          { formula: `IF($G${row}="","",$G${row}-$H${row})` },
          { formula: `IF($I${row}="","",IF($I${row}<0,"OVER",IF($I${row}=0,"FULL","")))` },
          group.note ?? "",
        ];
        values.forEach((value, index) => {
          const written = sheet.getCell(row, index + 1);
          written.value = value === "" ? null : value;
          written.font = { name: "Calibri", size: 11 };
        });
        row += 1;
      }
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.autoFilter = `A4:${columnLetter(CAPACITY_HEADERS.length)}${Math.max(row - 1, 4)}`;
  widen(sheet, CAPACITY_WIDTHS);
}

/** A sheet name Excel will accept inside a formula. */
function quoted(title: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(title) ? title : `'${title.split("'").join("''")}'`;
}

/** The dropdown on each amber column, so a group is chosen rather than typed wrongly. */
function addValidation(book: { getWorksheet: (name: string) => unknown }, input: ExportInput): void {
  const lastRow = Math.max(input.students.length + SPARE_ROWS + 1, 2);
  const programs = programsIn(input);
  for (const tab of tabsOf(input.blocks)) {
    const sheet = book.getWorksheet(tab.title) as Sheet | undefined;
    if (!sheet?.dataValidations) continue;
    if (programs.length) {
      sheet.dataValidations.add(`D2:D${lastRow}`, {
        type: "list",
        allowBlank: true,
        formulae: [`=${programsName(input.prefix)}`],
        showErrorMessage: true,
        errorTitle: "Not a programme",
        error: "Choose one of the programmes this cohort reads.",
      });
    }
    for (const { block, group } of columnsOf(tab.blocks)) {
      if (block.groups.length === 0) continue;
      const letter = columnLetter(group);
      sheet.dataValidations.add(`${letter}2:${letter}${lastRow}`, {
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
