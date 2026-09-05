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
import { SPREADSHEET_TYPE } from "@/services/workbookExport";

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
): RequestSheet[] {
  const byCohort = new Map<string, { name: string; rows: RequestRow[] }>();
  for (const card of cards) {
    if (card.termId !== termId) continue;
    const held = byCohort.get(card.cohortId) ?? { name: card.cohortName, rows: [] };
    const code = splitCourseCode(card.code);
    for (const set of card.sets) {
      for (const row of set.rows) {
        const section = row.section;
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
  const short = shortSemester(termName);
  return [...byCohort.values()].map((held) => ({
    title: `${sheetPrefix(held.name)}-${short}`.slice(0, 31),
    heading: held.name,
    semester: termName,
    rows: held.rows,
  }));
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

const HEADER_FILL = "FF1F3864";
const HEADER_TEXT = "FFFFFFFF";

export async function buildTimetableWorkbook(sheets: RequestSheet[]): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const heading = (cell: { value: unknown; font?: unknown; fill?: unknown; alignment?: unknown }, text: string) => {
    cell.value = text;
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  };

  for (const sheet of sheets) {
    const ws = book.addWorksheet(sheet.title);
    ws.getCell(1, 1).value = sheet.heading;
    ws.getCell(1, 1).font = { bold: true, size: 14 };
    ws.getCell(2, 1).value = sheet.semester;
    ws.getCell(2, 1).font = { italic: true };
    REQUEST_COLUMNS.forEach((column, index) => heading(ws.getCell(4, index + 1), column));
    sheet.rows.forEach((row, at) => {
      const values = [
        row.courseName, row.degree, row.ue, row.crn ? Number(row.crn) || row.crn : "", row.parentCrn ? Number(row.parentCrn) || row.parentCrn : "",
        row.subject, row.courseNumber, Number(row.hours) || row.hours, row.type, row.roomPref, row.teacher, row.timePref,
        row.dayPref, row.constraints, row.weeks, Number(row.duration) || row.duration, row.anticipated, row.comments,
      ];
      values.forEach((value, index) => {
        ws.getCell(5 + at, index + 1).value = value === "" ? null : value;
      });
    });
    [34, 24, 12, 9, 11, 9, 9, 10, 9, 14, 22, 18, 16, 28, 26, 10, 11, 28].forEach((width, index) => {
      ws.getColumn(index + 1).width = width;
    });
    ws.views = [{ state: "frozen", ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sheet.rows.length, column: REQUEST_COLUMNS.length } };
  }

  const table = book.addWorksheet("CRN-Table");
  table.getCell(1, 1).value = "Master Course List — All Programmes";
  table.getCell(1, 1).font = { bold: true, size: 14 };
  table.getCell(2, 1).value = "Every section of the semester, by CRN.";
  ["CRN", "Course Name", "Teacher"].forEach((column, index) => heading(table.getCell(3, index + 1), column));
  const all = sheets.flatMap((sheet) => sheet.rows).filter((row) => row.crn).sort((left, right) => left.crn.localeCompare(right.crn, undefined, { numeric: true }));
  all.forEach((row, at) => {
    table.getCell(4 + at, 1).value = Number(row.crn) || row.crn;
    table.getCell(4 + at, 2).value = row.courseName;
    table.getCell(4 + at, 3).value = row.teacher;
  });
  [9, 40, 24].forEach((width, index) => {
    table.getColumn(index + 1).width = width;
  });

  const hours = book.addWorksheet("Teacher Hours");
  hours.getCell(1, 1).value = "Teacher Hours";
  hours.getCell(1, 1).font = { bold: true, size: 14 };
  hours.getCell(2, 1).value = "Totals from the request sheets.";
  const types = ["CM", "TD", "TP"];
  const columns = ["Teacher", ...sheets.map((sheet) => sheet.title), ...types, "Total"];
  columns.forEach((column, index) => heading(hours.getCell(3, index + 1), column));
  teacherHours(sheets).forEach((entry, at) => {
    const values = [entry.teacher, ...entry.bySheet, ...types.map((type) => entry.byType[type] ?? 0), entry.total];
    values.forEach((value, index) => {
      hours.getCell(4 + at, index + 1).value = value;
    });
  });
  hours.getColumn(1).width = 26;

  const professors = book.addWorksheet("Professor List");
  heading(professors.getCell(1, 1), "Professor");
  teacherHours(sheets).forEach((entry, at) => {
    professors.getCell(2 + at, 1).value = entry.teacher;
  });
  professors.getColumn(1).width = 26;

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function downloadTimetableWorkbook(sheets: RequestSheet[], filename: string): Promise<void> {
  const blob = new Blob([await buildTimetableWorkbook(sheets)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
