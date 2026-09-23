/**
 * The teacher hours, as a workbook somebody can work in.
 *
 * The page answers "how much is she carrying" while there is still time to move something.
 * This answers the other half of the job: the file that goes to a coordinator meeting, to
 * the timetabler, or beside a stack of time sheets — where the reader wants to put their
 * own cursor in a cell and see where the number came from.
 *
 * So: one sheet per pay period, because a pay period is what a claim is settled against,
 * and a master sheet whose every figure is a live sum across those sheets. Correct a
 * period and the semester moves with it. A file of dead numbers would be a photograph of
 * a Tuesday, and this department's hours move all term.
 *
 *   Whole semester   one row per teacher; each hours cell sums that teacher's row on
 *                    every period sheet, then the plan beside it and the difference
 *   <pay period>     the same columns, for what the registrar's dated meetings say
 *                    actually met between the 15th and the 14th, with a totals row
 *
 * Built in the browser, like every other export here: the figures are already on screen,
 * and a round trip to build them again is a second answer that can disagree with the first.
 */

import ExcelJS from "exceljs";

import { periodContaining, periodEnd, periodLabel } from "@/services/payPeriods";
import type { GridColumn } from "@/services/studentColumns";
import type { LoadRow } from "@/services/teacherLoad";

const HEADER_FILL = "FF1F3864";
const HEADER_TEXT = "FFFFFFFF";
const TOTAL_FILL = "FFEDF3EC";
const SPREADSHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Hours, to the quarter, without trailing noughts on a whole number. */
const HOURS_FORMAT = "0.##";

/**
 * The columns whose figures are hours, and so can be added across periods.
 *
 * Everything else on the row is a fact about the teacher rather than a quantity of
 * teaching: their standing, their e-mail, how many sections they hold. Adding "Sections"
 * over four periods would say a teacher who taught one section all semester holds four.
 */
export function addsUp(columnId: string): boolean {
  return (
    ["total", "registrarHours", "cancelledHours", "coverTaken", "coverGiven"].includes(columnId) ||
    columnId.startsWith("sheet:") ||
    columnId.startsWith("type:")
  );
}

/** "A", "B" … "AA": which column a cell is in, for a formula that has to name it. */
export function columnLetter(index: number): string {
  let left = index;
  let said = "";
  while (left > 0) {
    const rest = (left - 1) % 26;
    said = String.fromCharCode(65 + rest) + said;
    left = Math.floor((left - 1) / 26);
  }
  return said;
}

/**
 * The pay periods a semester's teaching falls in, oldest first.
 *
 * Taken from the days classes actually meet rather than from a calendar: a semester is
 * whatever the registrar has booked, and a list of periods that ran past the last class
 * would put empty sheets in the file for somebody to wonder about.
 */
export function periodsCovering(days: string[], opensOn: number): string[] {
  const known = days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
  if (!known.length) return [];
  const found: string[] = [];
  let at = periodContaining(new Date(`${known[0]}T12:00:00`), opensOn);
  const last = periodContaining(new Date(`${known[known.length - 1]}T12:00:00`), opensOn);
  // Walked rather than derived, so a period with no classes in the middle of a term still
  // gets its sheet: a month a teacher taught nothing is a fact worth a nought.
  for (let guard = 0; guard < 24 && at <= last; guard += 1) {
    found.push(at);
    const after = new Date(`${periodEnd(at)}T12:00:00`);
    after.setDate(after.getDate() + 1);
    at = periodContaining(after, opensOn);
  }
  return found;
}

/** One teacher's place in the file: the same row on every sheet, so a formula can point at it. */
export function rowKey(row: { teacher: string }): string {
  return row.teacher.trim().toLowerCase() || "￿nobody";
}

export type HoursExport = {
  /** "BSc L1 · Semester 1", for the title row. */
  semester: string;
  /** The page's columns, in the order they are shown. */
  columns: GridColumn<LoadRow>[];
  /** The whole-semester table: the plan, which is what the master sheet is measured against. */
  plan: LoadRow[];
  /** One entry per pay period, oldest first. */
  periods: { start: string; rows: LoadRow[] }[];
};

function valueOf(column: GridColumn<LoadRow>, row: LoadRow): string | number {
  const held = column.accessor(row);
  if (column.type === "number") return typeof held === "number" ? held : Number(held) || 0;
  return held === undefined || held === null ? "" : String(held);
}

function dressHeader(sheet: ExcelJS.Worksheet, at: number, count: number): void {
  for (let column = 1; column <= count; column += 1) {
    const cell = sheet.getCell(at, column);
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }
  sheet.getRow(at).height = 24;
}

/** The row under the table: every hours column added up, as a formula rather than a figure. */
function addTotals(
  sheet: ExcelJS.Worksheet,
  columns: GridColumn<LoadRow>[],
  headerAt: number,
  rows: number,
): void {
  const at = headerAt + rows + 1;
  sheet.getCell(at, 1).value = "All teachers";
  columns.forEach((column, index) => {
    if (index === 0 || !addsUp(column.id)) return;
    const letter = columnLetter(index + 1);
    sheet.getCell(at, index + 1).value = {
      formula: `SUM(${letter}${headerAt + 1}:${letter}${headerAt + rows})`,
      date1904: false,
    };
  });
  for (let column = 1; column <= columns.length; column += 1) {
    const cell = sheet.getCell(at, column);
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    if (column > 1) cell.numFmt = HOURS_FORMAT;
  }
}

function layOut(sheet: ExcelJS.Worksheet, columns: GridColumn<LoadRow>[], title: string): number {
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { bold: true, size: 13 };
  sheet.addRow([]);
  sheet.getRow(3).values = columns.map((column) => column.displayName);
  dressHeader(sheet, 3, columns.length);
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.max(10, Math.round((column.defaultWidth ?? 110) / 8));
  });
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
  return 3;
}

export async function buildHoursBuffer(input: HoursExport): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "Academic Coordinator Tools";
  const columns = input.columns;
  // One order of teachers for the whole file. Every sheet keeps it, including the rows
  // where a teacher taught nothing that period, because the master sheet's sums point at
  // cells by number and a sheet that dropped a quiet teacher would shift everyone below.
  const order = input.plan.map(rowKey);
  const planBy = new Map(input.plan.map((row) => [rowKey(row), row]));
  const labels = input.periods.map((period) => periodLabel(period.start));
  // Made first, so it is the tab the file opens on: it is what the file is opened for.
  const master = book.addWorksheet("Whole semester");

  input.periods.forEach((period, index) => {
    const sheet = book.addWorksheet(labels[index]);
    const headerAt = layOut(sheet, columns, `${input.semester} · ${labels[index]}`);
    const byKey = new Map(period.rows.map((row) => [rowKey(row), row]));
    order.forEach((key, place) => {
      const row = byKey.get(key);
      const plan = planBy.get(key);
      const values = columns.map((column) =>
        row ? valueOf(column, row) : plan && column.type !== "number" ? valueOf(column, plan) : column.type === "number" ? 0 : "",
      );
      sheet.getRow(headerAt + place + 1).values = values;
      columns.forEach((column, at) => {
        if (column.type === "number") sheet.getCell(headerAt + place + 1, at + 1).numFmt = HOURS_FORMAT;
      });
    });
    addTotals(sheet, columns, headerAt, order.length);
  });

  /*
   * The master goes in front, and its hours are sums of the sheets behind it rather than a
   * second reckoning of the same question. Beside them, the plan — a section is 21 hours
   * for the term, with no dates on it — and the difference between the two, which is the
   * only honest way to show both: what was planned and what the dated meetings say met are
   * different numbers, and a file that printed one of them as "the semester" would be
   * quietly choosing for the reader.
   */
  const headerAt = layOut(master, columns, `${input.semester} · the whole semester`);
  master.getCell(headerAt, columns.length + 1).value = "Plan";
  master.getCell(headerAt, columns.length + 2).value = "Plan less taught";
  dressHeader(master, headerAt, columns.length + 2);
  master.getColumn(columns.length + 1).width = 12;
  master.getColumn(columns.length + 2).width = 16;
  order.forEach((key, place) => {
    const at = headerAt + place + 1;
    const plan = planBy.get(key);
    columns.forEach((column, index) => {
      const cell = master.getCell(at, index + 1);
      if (!addsUp(column.id)) {
        cell.value = plan ? valueOf(column, plan) : "";
        if (column.type === "number") cell.numFmt = HOURS_FORMAT;
        return;
      }
      const letter = columnLetter(index + 1);
      cell.value = labels.length
        ? { formula: labels.map((label) => `'${label}'!${letter}${at}`).join("+"), date1904: false }
        : 0;
      cell.numFmt = HOURS_FORMAT;
    });
    const total = columns.findIndex((column) => column.id === "total");
    const planCell = master.getCell(at, columns.length + 1);
    planCell.value = plan ? plan.total : 0;
    planCell.numFmt = HOURS_FORMAT;
    const apart = master.getCell(at, columns.length + 2);
    apart.value =
      total >= 0
        ? { formula: `${columnLetter(columns.length + 1)}${at}-${columnLetter(total + 1)}${at}`, date1904: false }
        : 0;
    apart.numFmt = HOURS_FORMAT;
  });
  addTotals(master, columns, headerAt, order.length);

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Hand the file to the browser. Nothing here has been anywhere near the server. */
export async function downloadTeacherHours(input: HoursExport, filename: string): Promise<void> {
  const blob = new Blob([await buildHoursBuffer(input)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
