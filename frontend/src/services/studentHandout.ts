/**
 * The file the students themselves get: "find your row, here are your groups".
 *
 * Every other export here is written for somebody who already knows how the department
 * works — the timetabler, admissions, the coordinator. This one is read once, by a
 * seventeen-year-old looking for their own name, and it is the only artefact of this
 * application most of them will ever see. So it is built to be found in: alphabetical by
 * family name, a row per student, and each set of groups in a colour of its own with the
 * CRN and the teacher written out rather than left as a number to look up.
 *
 * Built in the browser like the other two, and for the same reason: it carries names, and
 * the server holds none.
 */

import type { CatalogueScope } from "@/services/studentDatabase";
import { SPREADSHEET_TYPE } from "@/services/workbookExport";

/**
 * A colour per set, in the order the sets come.
 *
 * Three shades each — the banner, the group cell, and the courses under it — because the
 * point of the colour is that a student can see at a glance which of their three numbers
 * is which. Taken from the file the department already sends, and cycled where a cohort
 * has more sets than the palette has entries.
 */
export const PALETTE = [
  { dark: "FF1F4E79", mid: "FF9DC3E6", pale: "FFDDEBF7" },
  { dark: "FF375623", mid: "FFA9D08E", pale: "FFE2EFDA" },
  { dark: "FF833C00", mid: "FFF4B183", pale: "FFFCE4D6" },
  { dark: "FF4A2A6B", mid: "FFB4A7D6", pale: "FFE4DFEC" },
  { dark: "FF1D5B5B", mid: "FF9FD5D0", pale: "FFDDEFED" },
  { dark: "FF7B241C", mid: "FFE6A0A0", pale: "FFF7DDDD" },
] as const;

export type HandoutStudent = {
  studentId: string;
  /** Sorted on, so it is the one that must be right. Falls back to the whole name. */
  family: string;
  first: string;
  programme: string;
  /** `scope id -> group label`. */
  groups: Record<string, string>;
};

export type Handout = {
  cohortName: string;
  /** "Semester 1", as the sheet says it. */
  semester: string;
  /** "2026-27". */
  year: string;
  scopes: CatalogueScope[];
  students: HandoutStudent[];
  /** The teacher to print for a section — the chosen one, else what the row carried. */
  teacherOf?: (section: { teacher: string; teacherId?: string }) => string;
};

/**
 * "FYS-2026-27-S1_Your-Groups_STUDENTS.xlsx", as the ones already sent are named.
 *
 * `sheet` is the tab the timetable workbook gives this cohort's semester — "BSc-L2-S3" —
 * so the handout is numbered the way the department numbers everything else. The number is
 * read off the end rather than found anywhere in the string, or Licence 2 would take its
 * semester from its own name.
 */
export function handoutName(tab: string, year: string, sheet: string): string {
  const number = sheet.match(/S(\d+)\s*$/i)?.[1] ?? "";
  return `${[tab || "Groups", year, number && `S${number}`].filter(Boolean).join("-")}_Your-Groups_STUDENTS.xlsx`;
}

/**
 * "YOUR LECTURE GROUP": the set's own name, in the singular, over the column that holds it.
 *
 * Its code — CM, TD, RDNS — is the department's shorthand and means nothing to a student,
 * so the banner carries it and the column heading does not. A trailing "s" comes off, but
 * not from a word that ends in one already: Lectures becomes LECTURE and Readiness stays.
 */
export function singular(scope: { code: string; name: string }): string {
  const name = (scope.name || scope.code).trim();
  return /ss$/i.test(name) ? name : name.replace(/s$/i, "");
}

export function groupHeading(scope: { code: string; name: string }): string {
  return `YOUR\n${singular(scope).toUpperCase()}\nGROUP`;
}

/** A group label as the sheet holds it: a number where it is one, so 10 sorts after 9. */
export function labelValue(label: string): string | number {
  return label && String(Number(label)) === label ? Number(label) : label;
}

/** "Pre-calculus 1\nMATH001": what one course's column is headed. */
export function courseHeading(course: { code: string; name: string }): string {
  return course.name ? `${course.name}\n${course.code}` : course.code;
}

/** "CRN 23561\nSamar Ghantous", or a hyphen where this group takes no such class. */
export function classCell(crn: string, teacher: string): string {
  if (!crn) return "—";
  return teacher ? `CRN ${crn}\n${teacher}` : `CRN ${crn}`;
}

/**
 * The sentence at the top that says what the colours mean.
 *
 * Written from the sets actually in the file, because a cohort with two sets should not be
 * told it belongs to three.
 */
export function whatYouBelongTo(scopes: CatalogueScope[]): string {
  const named = scopes.map((scope, index) => `a ${(scope.name || scope.code).toUpperCase()} group (${COLOUR_WORDS[index % COLOUR_WORDS.length]})`);
  if (!named.length) return "Find your row below.";
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `You belong to ${named.length === 1 ? "one group" : `${COUNT_WORDS[named.length] ?? named.length} groups`}: ${list}. Each box shows your class number (CRN) and your teacher.`;
}

const COLOUR_WORDS = ["blue", "green", "orange", "purple", "teal", "red"];
const COUNT_WORDS: Record<number, string> = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

/** What each set is for, in the coordinator's own words where they have written any. */
export function explain(scope: CatalogueScope): string {
  if (scope.note) return scope.note;
  const courses = scope.courses.map((course) => course.name || course.code);
  const carries =
    courses.length === 0
      ? "It carries no courses yet."
      : courses.length === 1
        ? `It decides your class for ${courses[0]}.`
        : `It decides your class for ${courses.slice(0, -1).join(", ")} and ${courses[courses.length - 1]}.`;
  return `You are in one ${singular(scope).toLowerCase()} group. ${carries} Its number is independent of your other groups — that is normal.`;
}

/** Every group of a set that anybody is in or that holds a class, in reading order. */
export function groupsOf(scope: CatalogueScope): CatalogueScope["groups"] {
  return [...scope.groups].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "accent" }),
  );
}

/** Alphabetical by family name, which is the order the sheet tells students to expect. */
export function inReadingOrder(students: HandoutStudent[]): HandoutStudent[] {
  return [...students].sort(
    (left, right) =>
      left.family.localeCompare(right.family, undefined, { sensitivity: "accent" }) ||
      left.first.localeCompare(right.first, undefined, { sensitivity: "accent" }) ||
      left.studentId.localeCompare(right.studentId),
  );
}

const IDENTITY = [
  { header: "#", width: 6 },
  { header: "Student ID", width: 14 },
  { header: "Family name", width: 34 },
  { header: "First name", width: 22 },
  { header: "Programme", width: 15 },
];
const HEADER_GREY = "FF404040";
const RULE = "FFD0D0D0";
const WHITE = "FFFFFFFF";

/** As much of an exceljs cell as this file sets. */
type Cell = { fill?: unknown; font?: unknown; alignment?: unknown; border?: unknown; value?: unknown };

function paint(cell: Cell, argb: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function ruled() {
  return (["top", "left", "bottom", "right"] as const).reduce(
    (edges, side) => ({ ...edges, [side]: { style: "thin" as const, color: { argb: RULE } } }),
    {},
  );
}

export async function buildHandoutBuffer(input: Handout): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const named = (section: { teacher: string; teacherId?: string }) => input.teacherOf?.(section) ?? section.teacher;

  const sheet = book.addWorksheet("Find your groups", {
    views: [{ state: "frozen", xSplit: IDENTITY.length, ySplit: 7, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToWidth: 1, fitToHeight: 0 },
  });

  // The four lines of instruction the file opens with, before any of the data.
  const lines: [string, { size: number; bold?: boolean; italic?: boolean; colour: string; height: number }][] = [
    [
      `Your class groups — ${input.cohortName}, ${input.semester}${input.year ? ` (${input.year})` : ""}`,
      { size: 20, bold: true, colour: "FF1F4E79", height: 30 },
    ],
    [
      "Find your row below. The list is in alphabetical order by FAMILY NAME. Names appear exactly as the registrar records them.",
      { size: 12, colour: HEADER_GREY, height: 20 },
    ],
    [whatYouBelongTo(input.scopes), { size: 11, colour: HEADER_GREY, height: 20 }],
    [
      "Tip: press Ctrl+F (Cmd+F on Mac) and search your Student ID to jump straight to your row.  ·  Questions, or your name is missing? Contact the Sciences and Engineering office.",
      { size: 11, italic: true, colour: "FF808080", height: 22 },
    ],
  ];
  lines.forEach(([text, look], index) => {
    const cell = sheet.getCell(index + 1, 1);
    cell.value = text;
    cell.font = { size: look.size, bold: look.bold, italic: look.italic, color: { argb: look.colour } };
    sheet.getRow(index + 1).height = look.height;
  });

  // Row 6 banners a set across its columns; row 7 heads each column under it.
  let column = IDENTITY.length + 1;
  IDENTITY.forEach((identity, index) => {
    const cell = sheet.getCell(7, index + 1);
    cell.value = identity.header;
    cell.font = { size: 10, bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    paint(cell, HEADER_GREY);
    sheet.getColumn(index + 1).width = identity.width;
  });

  const placed = input.scopes.map((scope, index) => {
    const skin = PALETTE[index % PALETTE.length];
    const at = column;
    const banner = sheet.getCell(6, at);
    banner.value = `${(scope.name || scope.code).toUpperCase()}  (${scope.code})`;
    banner.font = { size: 12, bold: true, color: { argb: WHITE } };
    banner.alignment = { horizontal: "center", vertical: "middle" };
    paint(banner, skin.dark);
    sheet.mergeCells(6, at, 6, at + scope.courses.length);
    for (const [offset, heading] of [groupHeading(scope), ...scope.courses.map(courseHeading)].entries()) {
      const cell = sheet.getCell(7, at + offset);
      cell.value = heading;
      cell.font = { size: 10, bold: true, color: { argb: WHITE } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      paint(cell, skin.dark);
      sheet.getColumn(at + offset).width = offset === 0 ? 13 : 24;
    }
    column += scope.courses.length + 1;
    return { scope, skin, at };
  });
  sheet.getRow(6).height = 26;
  sheet.getRow(7).height = 52;

  const students = inReadingOrder(input.students);
  students.forEach((student, index) => {
    const row = 8 + index;
    [index + 1, student.studentId, student.family, student.first, student.programme].forEach((value, at) => {
      const cell = sheet.getCell(row, at + 1);
      cell.value = value;
      cell.font = { size: 11 };
      cell.alignment = { horizontal: at === 2 || at === 3 ? "left" : "center", vertical: "middle", wrapText: at === 2 || at === 3 };
      cell.border = ruled();
      paint(cell, WHITE);
    });

    for (const { scope, skin, at } of placed) {
      const label = student.groups[scope.id] ?? "";
      const group = scope.groups.find((candidate) => candidate.label === label) ?? null;
      const mark = sheet.getCell(row, at);
      mark.value = label ? labelValue(label) : "—";
      mark.font = { size: 16 };
      mark.alignment = { horizontal: "center", vertical: "middle" };
      mark.border = ruled();
      paint(mark, skin.mid);

      scope.courses.forEach((course, offset) => {
        const held = group?.crns[course.id];
        const cell = sheet.getCell(row, at + offset + 1);
        cell.value = held ? classCell(held.crn, named(held)) : "—";
        cell.font = { size: 10 };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = ruled();
        paint(cell, skin.pale);
      });
    }
    sheet.getRow(row).height = 34;
  });

  sheet.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7 + students.length, column: column - 1 } };
  // Both the banner and the headings repeat at the top of every printed page — this is a
  // list a hundred and ninety rows long that somebody will pin to a noticeboard.
  sheet.pageSetup.printTitlesRow = "6:7";

  writeExplainer(book.addWorksheet("What this means", { views: [{ showGridLines: false }] }) as unknown as Explainer, input, named);
  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

type Explainer = {
  getCell: (row: number, column: number) => Cell;
  getRow: (row: number) => { height?: number };
  getColumn: (column: number) => { width?: number };
  mergeCells: (from: number, fromColumn: number, to: number, toColumn: number) => void;
};

/**
 * The second sheet: what a lecture group is, what a CRN is, and every group in full.
 *
 * A student who has found their row still has to know what it means, and one who wants to
 * swap wants to see the alternatives. The per-set explanation is the coordinator's own
 * note where they have written one on the Group schema page, and a plain sentence where
 * they have not.
 */
function writeExplainer(sheet: Explainer, input: Handout, named: (section: { teacher: string; teacherId?: string }) => string): void {
  const title = sheet.getCell(1, 1);
  title.value = "What your groups mean";
  title.font = { size: 20, bold: true, color: { argb: "FF1F4E79" } };
  [22, 30, 30, 30].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  let row = 3;
  const explanation = (label: string, text: string, colour: string) => {
    const head = sheet.getCell(row, 1);
    head.value = label;
    head.font = { size: 11, bold: true, color: { argb: colour } };
    head.alignment = { vertical: "middle", wrapText: true };
    const body = sheet.getCell(row, 2);
    body.value = text;
    body.font = { size: 11 };
    body.alignment = { vertical: "middle", wrapText: true };
    sheet.mergeCells(row, 2, row, 4);
    sheet.getRow(row).height = 34;
    row += 1;
  };

  input.scopes.forEach((scope, index) => {
    explanation(`${singular(scope)} group (${scope.code})`, explain(scope), PALETTE[index % PALETTE.length].dark);
  });
  explanation(
    "What is a CRN?",
    "The class reference number that identifies your exact class in the system. Quote it if you ever need to ask about your registration.",
    "FF1F4E79",
  );
  explanation(
    "Your timetable",
    `Days, times and rooms are published separately in the ${input.semester} timetable. Match them using the CRNs shown against your name.`,
    "FF1F4E79",
  );

  input.scopes.forEach((scope, index) => {
    const skin = PALETTE[index % PALETTE.length];
    row += 1;
    const heading = sheet.getCell(row, 1);
    heading.value = `All ${singular(scope).toLowerCase()} groups (${scope.code})`;
    heading.font = { size: 13, bold: true, color: { argb: skin.dark } };
    row += 1;

    ["Group", ...scope.courses.map((course) => course.name || course.code)].forEach((label, offset) => {
      const cell = sheet.getCell(row, offset + 1);
      cell.value = label;
      cell.font = { size: 10, bold: true, color: { argb: WHITE } };
      cell.alignment = { horizontal: offset === 0 ? "center" : "left", vertical: "middle", wrapText: true };
      paint(cell, skin.dark);
    });
    sheet.getRow(row).height = 24;
    row += 1;

    for (const group of groupsOf(scope)) {
      const label = sheet.getCell(row, 1);
      label.value = labelValue(group.label);
      label.font = { size: 13, bold: true };
      label.alignment = { horizontal: "center", vertical: "middle" };
      paint(label, skin.mid);
      scope.courses.forEach((course, offset) => {
        const held = group.crns[course.id];
        const cell = sheet.getCell(row, offset + 2);
        cell.value = held?.crn ? `CRN ${held.crn}${named(held) ? `  ·  ${named(held)}` : ""}` : "—";
        cell.font = { size: 11 };
        cell.alignment = { vertical: "middle", wrapText: true };
        paint(cell, skin.pale);
      });
      sheet.getRow(row).height = 22;
      row += 1;
    }
    row += 1;
  });
}

/** Hand the file to the browser. Nothing here has been anywhere near the server. */
export async function downloadHandout(input: Handout, filename: string): Promise<void> {
  const blob = new Blob([await buildHandoutBuffer(input)], { type: SPREADSHEET_TYPE });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
