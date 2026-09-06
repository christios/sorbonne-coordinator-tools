/**
 * The timetabler's workbook, written from the cards.
 *
 * `Time-Tables-26-27.xlsx` is the department's request to the timetabler: a sheet per
 * cohort and semester with one row per section, a CRN table, and teacher hours. It was
 * kept by hand; the cards hold everything it says, so it is written from them — the same
 * columns in the same order, the heading rows the scripts of the group-assignment cycle
 * read it by, and the retired sections marked the way they always were.
 */

import type { Card, SectionRow } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import { SPREADSHEET_TYPE, columnLetter } from "@/services/workbookExport";

export const REQUEST_COLUMNS = [
  "Course Name",
  "Degree",
  "UE",
  "CRN",
  "Parent CRN",
  "Subject",
  "Course Number",
  "Total Teaching Hours",
  "Teaching Type",
  "Room Preference",
  "Teacher",
  "Time Preference",
  "Day Preference",
  "Constraints",
  "Weeks & Sessions per Week",
  "Duration (hr/session)",
  "Anticipated Students",
  "Comments",
] as const;

export type RequestRow = {
  courseName: string;
  degree: string;
  ue: string;
  crn: string;
  parentCrn: string;
  subject: string;
  courseNumber: string;
  hours: string;
  type: string;
  roomPref: string;
  teacher: string;
  timePref: string;
  dayPref: string;
  constraints: string;
  weeks: string;
  duration: string;
  anticipated: number | "";
  comments: string;
};

export type RequestSheet = {
  /** The tab: FYS-S1, BSc-L1-S1 — within Excel's 31 characters. */
  title: string;
  heading: string;
  semester: string;
  rows: RequestRow[];
};

/** "MATH-001" or "MATH001" → subject MATH, number 001. */
export function splitCourseCode(code: string): { subject: string; number: string } {
  const match = code.trim().match(/^([A-Za-z]+)[-\s]?(\w*)$/);
  return match ? { subject: match[1].toUpperCase(), number: match[2] } : { subject: code, number: "" };
}

/** "Pre-calculus 1 G.2-TD": the workbook's way of naming a section. */
export function sectionName(card: Card, row: SectionRow): string {
  const type = row.course.component || row.scope.code;
  return `${card.name || card.code} G.${row.group.label}-${type}`;
}

/**
 * The sheets of one semester: a sheet per cohort that has sections in it, rows in the
 * order the cards show them. A section with no CRN and not retired is still a row —
 * the timetabler is the one who needs to know it is coming.
 */
export function requestSheets(
  cards: Card[],
  termId: string,
  termName: string,
  cohortDegree: (cohortId: string) => string,
  teacherName: (teacherId: string) => string,
  /** The cohort record, for the name of its sheet and the heading above it. */
  cohortNamed: (cohortId: string) => { name: string; workbookTab?: string; firstSemester?: number } = () => ({ name: "" }),
): RequestSheet[] {
  const byCohort = new Map<string, { name: string; rows: RequestRow[] }>();
  for (const card of cards) {
    if (card.termId !== termId) continue;
    const held = byCohort.get(card.cohortId) ?? { name: card.cohortName, rows: [] };
    const code = splitCourseCode(card.code);
    for (const set of card.sets) {
      for (const row of set.rows) {
        // What this group says, and what its course said for every group that says nothing.
        const section = row.section ? filled(row.section, set.course.request) : null;
        if (!section) continue;
        const comments = [section.comments, section.retired ? "Retired group" : ""].filter(Boolean).join("; ");
        held.rows.push({
          courseName: sectionName(card, row),
          degree: cohortDegree(card.cohortId),
          ue: card.ue,
          crn: section.crn,
          // The register's answer for this very CRN: a course may hang from more than one.
          parentCrn: row.parentCrn,
          subject: code.subject,
          courseNumber: code.number,
          hours: section.hours,
          type: row.course.component || row.scope.code,
          roomPref: section.roomPref,
          teacher: section.teacherId ? teacherName(section.teacherId) || section.teacher : section.teacher,
          timePref: section.timePref,
          dayPref: section.dayPref,
          constraints: section.constraints,
          weeks: section.sessionsPerWeek || section.weeks,
          duration: section.duration,
          anticipated: section.anticipated || "",
          comments,
        });
      }
    }
    byCohort.set(card.cohortId, held);
  }
  return [...byCohort.entries()].map(([cohortId, held]) => {
    const cohort = cohortNamed(cohortId);
    return {
      title: sheetTitle({ ...cohort, name: cohort.name || held.name }, termName),
      heading: held.name,
      semester: termName,
      rows: held.rows,
    };
  });
}

/**
 * The sheet's name in the workbook: "BSc-L2-S3".
 *
 * Both halves are the cohort's own answer, because neither is derivable. "Foundation Year
 * for Science" initialises to FYFS, not FYS; the MSc's tab carries an acronym of its
 * programme that appears nowhere in its name; and Licence 2's first semester is called S3
 * because the workbook numbers across the degree rather than within the year. A cohort
 * that has not been asked falls back to its initials and the semester's own number, which
 * is what this did before anybody could answer.
 */
export function sheetTitle(
  cohort: { name: string; workbookTab?: string; firstSemester?: number },
  termName: string,
): string {
  const prefix = cohort.workbookTab?.trim() || sheetPrefix(cohort.name);
  const within = Number(termName.match(/semester\s*(\d+)/i)?.[1] ?? 0);
  const first = cohort.firstSemester ?? 0;
  const numbered = first > 0 && within > 0 ? `S${first + within - 1}` : shortSemester(termName);
  return `${prefix}-${numbered}`.slice(0, 31);
}

/** "Foundation Year" → "FY", "BSc L1" → "BSC-L1": a tab name the way the workbook has them. */
export function sheetPrefix(cohortName: string): string {
  const words = cohortName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words.filter((word) => !/^[A-Za-z]\d+$/.test(word)).map((word) => word[0].toUpperCase()).join("");
  const years = words.filter((word) => /^[A-Za-z]\d+$/.test(word)).map((word) => word.toUpperCase());
  return [initials, ...years].filter(Boolean).join("-") || "SHEET";
}

/** "Physics & Maths — First Year, Semester 1" → "S1"; anything else, its initials. */
export function shortSemester(termName: string): string {
  const match = termName.match(/semester\s*(\d+)/i);
  if (match) return `S${match[1]}`;
  return termName
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 6);
}

/** Hours per teacher per sheet and per type, the way the workbook's Teacher Hours sheet has them. */
export function teacherHours(sheets: RequestSheet[]): { teacher: string; bySheet: number[]; byType: Record<string, number>; total: number }[] {
  const held = new Map<string, { bySheet: number[]; byType: Record<string, number> }>();
  sheets.forEach((sheet, index) => {
    for (const row of sheet.rows) {
      if (!row.teacher || row.teacher.toUpperCase() === "TBD") continue;
      const hours = Number(row.hours) || 0;
      const entry = held.get(row.teacher) ?? { bySheet: sheets.map(() => 0), byType: {} };
      entry.bySheet[index] += hours;
      const type = row.type.toUpperCase() || "OTHER";
      entry.byType[type] = (entry.byType[type] ?? 0) + hours;
      held.set(row.teacher, entry);
    }
  });
  return [...held.entries()]
    .map(([teacher, entry]) => ({ teacher, ...entry, total: entry.bySheet.reduce((sum, hours) => sum + hours, 0) }))
    .sort((left, right) => left.teacher.localeCompare(right.teacher));
}

/*
 * The workbook's own livery, taken from `Time-Tables-26-27.xlsx` itself.
 *
 * A file the timetabler already knows how to read is worth more than a tidier one. These
 * are the colours, fonts, heights and rules that file uses — the navy title band, the
 * lighter band under it that the column headings repeat, Arial 10 throughout, and a thin
 * grey rule around every cell — so what this writes can be opened beside last year's and
 * not look like a different document.
 */
const TITLE_FILL = "FF1F3864";
const BAND_FILL = "FF305496";
/** The Teacher Hours sheet's own title and heading blues, a shade off the others. Theirs, not a slip of ours. */
const HOURS_FILL = "FF1F4E78";
const HOURS_HEADER_FILL = "FF4472C4";
const GRID = "FFC4CAD3";
const WHITE = "FFFFFFFF";
const BODY_FONT = { name: "Arial", size: 10 };

/** How each column of a request sheet is set, in the order of REQUEST_COLUMNS. */
const COLUMN_STYLE: { width?: number; align: "left" | "center"; wrap?: boolean }[] = [
  { width: 49.1, align: "left", wrap: true }, // Course Name
  { width: 20.3, align: "left", wrap: true }, // Degree
  { width: 10.9, align: "left" }, // UE
  { width: 9, align: "center" }, // CRN
  { align: "center" }, // Parent CRN
  { align: "center" }, // Subject
  { width: 11, align: "center" }, // Course Number
  { width: 20, align: "center" }, // Total Teaching Hours
  { width: 15, align: "center" }, // Teaching Type
  { width: 20, align: "left" }, // Room Preference
  { width: 22, align: "left" }, // Teacher
  { width: 28, align: "left", wrap: true }, // Time Preference
  { width: 24, align: "left", wrap: true }, // Day Preference
  { align: "left", wrap: true }, // Constraints
  { width: 26, align: "left", wrap: true }, // Weeks & Sessions per Week
  { width: 14, align: "center" }, // Duration (hr/session)
  { width: 12, align: "center" }, // Anticipated Students
  { width: 51.4, align: "left" }, // Comments
];

/** "Physics & Maths — First Year, Semester 1" → "Semester 1", which is all the sheet says. */
export function semesterLabel(termName: string): string {
  const match = termName.match(/semester\s*\d+/i);
  if (!match) return termName;
  return match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
}

/**
 * A CRN or a course number as the workbook holds it: a number where it is one.
 *
 * "001" is not 1 — the leading zeros are the course number — so only a string that comes
 * back unchanged from being a number is written as one.
 */
export function asNumber(value: string | number): string | number {
  const text = String(value);
  return text && String(Number(text)) === text ? Number(text) : text;
}

/** "FYS-S1" → "FYS", "BSc-L1-S1" → "BSc L1": the Teacher Hours sheet's column for it. */
export function hoursColumn(sheetTitle: string): string {
  return sheetTitle.replace(/-S\d+$/i, "").replace(/-/g, " ");
}

/** The thin grey rule the request sheets draw around every cell. */
function ruled(argb = GRID) {
  return (["top", "left", "bottom", "right"] as const).reduce(
    (edges, side) => ({ ...edges, [side]: { style: "thin" as const, color: { argb } } }),
    {},
  );
}

type Cell = {
  value: unknown;
  font?: unknown;
  fill?: unknown;
  alignment?: unknown;
  border?: unknown;
};

function band(cell: Cell, text: string, { fill, size }: { fill: string; size: number }): void {
  cell.value = text;
  cell.font = { ...BODY_FONT, size, bold: true, color: { argb: WHITE } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  cell.alignment = { vertical: "middle" };
}

export async function buildTimetableWorkbook(sheets: RequestSheet[], academicYear = ""): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const last = columnLetter(REQUEST_COLUMNS.length);

  const heading = (cell: Cell, text: string) => {
    cell.value = text;
    cell.font = { ...BODY_FONT, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
    cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  };

  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheet.title, { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });

    // The two bands the file opens with: the cohort, then the semester it is for.
    ws.mergeCells(`A1:${last}1`);
    band(ws.getCell(1, 1), sheet.heading, { fill: TITLE_FILL, size: 16 });
    ws.mergeCells(`A2:${last}2`);
    band(ws.getCell(2, 1), semesterLabel(sheet.semester), { fill: BAND_FILL, size: 12 });
    ws.getRow(1).height = 25.5;
    ws.getRow(2).height = 19.5;
    // Row 3 is a rule of white space, not an empty row somebody forgot to delete.
    ws.getRow(3).height = 6;

    REQUEST_COLUMNS.forEach((column, index) => heading(ws.getCell(4, index + 1), column));
    ws.getRow(4).height = 33.75;

    sheet.rows.forEach((row, at) => {
      const values = [
        row.courseName, row.degree, row.ue, row.crn ? asNumber(row.crn) : "", row.parentCrn ? asNumber(row.parentCrn) : "",
        row.subject, row.courseNumber ? asNumber(row.courseNumber) : "", asNumber(row.hours), row.type, row.roomPref,
        row.teacher, row.timePref, row.dayPref, row.constraints, row.weeks, asNumber(row.duration), row.anticipated,
        row.comments,
      ];
      values.forEach((value, index) => {
        const cell = ws.getCell(5 + at, index + 1);
        const style = COLUMN_STYLE[index];
        cell.value = value === "" ? null : value;
        cell.font = { ...BODY_FONT };
        cell.alignment = { horizontal: style.align, vertical: "middle", wrapText: style.wrap ?? false };
        cell.border = ruled();
      });
    });

    COLUMN_STYLE.forEach((style, index) => {
      if (style.width) ws.getColumn(index + 1).width = style.width;
    });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sheet.rows.length, column: REQUEST_COLUMNS.length } };
  }

  const table = book.addWorksheet("CRN-Table", { views: [{ showGridLines: false }] });
  table.mergeCells("A1:C1");
  band(table.getCell(1, 1), "Master Course List — All Programs", { fill: TITLE_FILL, size: 16 });
  table.getRow(1).height = 25.5;
  table.mergeCells("A2:C2");
  table.getCell(2, 1).value = "Every section of this semester, by CRN, as the request sheets have them. Written out as values rather than the lookups the hand-kept file used, so it opens the same anywhere.";
  table.getCell(2, 1).font = { ...BODY_FONT, size: 8, italic: true, color: { argb: "FF666666" } };
  table.getCell(2, 1).alignment = { wrapText: true, vertical: "middle" };
  table.getRow(2).height = 33.95;
  ["CRN", "Course Name", "Teacher"].forEach((column, index) => heading(table.getCell(3, index + 1), column));
  table.getRow(3).height = 33.75;
  const all = sheets.flatMap((sheet) => sheet.rows).filter((row) => row.crn).sort((left, right) => left.crn.localeCompare(right.crn, undefined, { numeric: true }));
  all.forEach((row, at) => {
    [asNumber(row.crn), row.courseName, row.teacher].forEach((value, index) => {
      const cell = table.getCell(4 + at, index + 1);
      cell.value = value;
      cell.font = { ...BODY_FONT };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = ruled();
    });
  });
  [12, 55, 26].forEach((width, index) => {
    table.getColumn(index + 1).width = width;
  });

  /*
   * The last two sheets are set in Calibri, not Arial, and their headings are a lighter
   * blue. That is how the file is — they were made at a different time from the request
   * sheets — and a coordinator opening ours beside theirs should not find the difference.
   */
  const hours = book.addWorksheet("Teacher Hours");
  const columns = ["Teacher", ...sheets.map((sheet) => hoursColumn(sheet.title)), "CM", "TD", "TP", "Total"];
  hours.mergeCells(1, 1, 1, Math.max(columns.length, 2));
  const title = hours.getCell(1, 1);
  title.value = academicYear ? `Teacher Hours — ${academicYear}` : "Teacher Hours";
  title.font = { name: "Calibri", size: 14, bold: true, color: { argb: WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HOURS_FILL } };
  title.alignment = { vertical: "middle" };
  hours.getRow(1).height = 18.95;
  hours.getCell(2, 1).value = "Totals from the timetable sheets. Hours without a classified CM / TD / TP type are counted in the total and in no type column.";
  hours.getCell(2, 1).font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF666666" } };
  columns.forEach((column, index) => {
    const cell = hours.getCell(3, index + 1);
    cell.value = column;
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HOURS_HEADER_FILL } };
    cell.alignment = { horizontal: "center" };
  });
  const types = ["CM", "TD", "TP"];
  teacherHours(sheets).forEach((entry, at) => {
    const values = [entry.teacher, ...entry.bySheet, ...types.map((type) => entry.byType[type] ?? 0), entry.total];
    values.forEach((value, index) => {
      const cell = hours.getCell(4 + at, index + 1);
      cell.value = value;
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = { horizontal: index === 0 ? "left" : "center" };
      cell.border = ruled("FF000000");
    });
  });
  hours.getColumn(1).width = 30;
  for (let column = 2; column <= columns.length; column += 1) hours.getColumn(column).width = 13.3;

  const professors = book.addWorksheet("Professor List");
  heading(professors.getCell(1, 1), "Professor");
  professors.getRow(1).height = 15.95;
  teacherHours(sheets).forEach((entry, at) => {
    professors.getCell(2 + at, 1).value = entry.teacher;
    professors.getCell(2 + at, 1).font = { name: "Calibri", size: 11 };
  });
  professors.getColumn(1).width = 30;

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function downloadTimetableWorkbook(sheets: RequestSheet[], filename: string, academicYear = ""): Promise<void> {
  const blob = new Blob([await buildTimetableWorkbook(sheets, academicYear)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
