/**
 * The timetabling brief (27 Nov 2026): what the timetabling team is sent for a semester, as a
 * PDF to read rather than a sheet to filter. The team agreed to it in place of the Excel file.
 *
 * The user's choices: by course, then teachers. Part 1 is each cohort's courses, each with its
 * classes (CRN, teacher, hours, session length, students, what Groups & CRNs says of it) and the
 * weeks its lead laid out, a strip of teaching weeks with the sessions in each, the exams and the
 * order asked for. Part 2 is each teacher of those classes, their hard and soft constraints drawn
 * on a week and listed in words, their limits, needs and note. A teacher's reasons are never
 * printed. Retired groups are left out: there is nothing to book.
 *
 * Built in the browser, from the same rows as the Timetable workbook.
 */

import type { jsPDF as JsPdf } from "jspdf";

import {
  COMPONENTS,
  examWords,
  figure,
  heldOf,
  hoursWords,
  lengthWords,
  orderWords,
  rowWords,
  rowsOf,
  withWeeksOff,
  type Component,
  type CoursePlan,
  type CoursePlanSemester,
  type TeachingWeek,
} from "@/services/coursePlans";
import { DAY_SHORT, clockOf, teachingWeeks, type WishSemester } from "@/services/teacherWishes";
import { answerWords, rowKeyOf, teacherWords, type TeacherWords } from "@/services/timetableConstraints";
import type { RequestSheet } from "@/services/timetableExport";
import { formatDayAndMonth } from "@/services/weekSchedule";

// ------------------------------------------------------------------ what it says

/** A column of the week strips: a teaching week, or a week off between two. */
export type BriefWeek = { number: number; monday: string; holidays: string[] } | { off: string };

export type BriefClass = {
  /** "TD 1", "CM A": the class's type and its group. */
  label: string;
  crn: string;
  teacher: string;
  hours: string;
  length: string;
  students: number | "";
  /** What Groups & CRNs says of it, typed there: room, time and day, constraints, comments. */
  notes: string;
};

/** A row of a course's week strip: a component or a part of one, and its sessions week by week. */
export type BriefStrip = {
  label: string;
  hours: string;
  /** By week number: how many sessions, how many of them exams, and whether one lasts otherwise. */
  cells: Record<string, { count: number; exams: number; own: boolean }>;
};

export type BriefCourse = {
  code: string;
  title: string;
  lead: string;
  classes: BriefClass[];
  strip: BriefStrip[];
  /** Exams, the order asked for, sessions lasting otherwise — or, not laid out, what was typed. */
  lines: string[];
};

export type BriefCohort = { name: string; courses: BriefCourse[] };

/** A block of a teacher's week, drawn: every week, or every week from one. One week's are listed, not drawn. */
export type BriefBlock = { hard: boolean; days: number[]; from: number; to: number; fromWeek: number | null };

export type BriefTeacher = {
  name: string;
  answer: string;
  /** "MATH-233 TD 1 (31010)": what they teach in the brief. */
  classes: string[];
  words: TeacherWords | null;
  blocks: BriefBlock[];
};

export type Brief = {
  semester: string;
  /** Whose classes: a cohort's name, or "All cohorts". */
  scope: string;
  made: string;
  weeks: BriefWeek[];
  grid: { days: number[]; firstHour: number; lastHour: number };
  cohorts: BriefCohort[];
  teachers: BriefTeacher[];
  /** What could not be read for the semester and is missing from the brief. */
  missing: string[];
};

/** The semester's weeks as the strips show them: teaching weeks with their Mondays, and the weeks off between. */
function briefWeeks(plans: CoursePlanSemester | null, wishes: WishSemester | null): BriefWeek[] {
  const weeks: TeachingWeek[] = plans?.weeks.length
    ? plans.weeks
    : teachingWeeks(wishes?.calendar).map((week) => ({ week: week.number, monday: week.monday, holidays: [] }));
  if (weeks.some((week) => !week.monday)) return weeks.map((week) => ({ number: week.week, monday: "", holidays: [] }));
  return withWeeksOff(weeks).map((column) =>
    column.week
      ? {
          number: column.week.week,
          monday: column.week.monday,
          holidays: column.week.holidays.map((holiday) => `${formatDayAndMonth(holiday.date)} ${holiday.label}`.trim()),
        }
      : { off: column.off },
  );
}

/** "1.5": a figure Groups & CRNs holds as typed, when it is one. */
const isFigure = (text: string) => /^\d+(?:[.,]\d+)?$/.test(text.trim());

/**
 * A class's session length: what its row says when that is a length, else what its course says
 * for its component or part — Groups & CRNs sets lengths on the course (23 Nov 2026), and a row
 * often says nothing of its own.
 */
function lengthOf(typed: string, plan: CoursePlan | undefined, type: string, crn: string): string {
  if (isFigure(typed)) return typed.trim();
  const component = type.trim().toUpperCase() as Component;
  const held = plan && (COMPONENTS as readonly string[]).includes(component) ? heldOf(plan, rowKeyOf(plan, component, crn)) : undefined;
  return held?.length ? figure(held.length) : typed.trim();
}

/** A course's weeks, as its lead laid them out: a strip row per component or part, and the lines under it. */
function planOf(plan: CoursePlan | undefined, typed: string[]): { strip: BriefStrip[]; lines: string[]; lead: string } {
  const strip: BriefStrip[] = [];
  const otherwise: string[] = [];
  for (const row of plan ? rowsOf(plan) : []) {
    const weeks = Object.entries(plan!.weeks[row.key] ?? {}).filter(([, count]) => count > 0);
    if (!weeks.length) continue;
    const exams = plan!.exams?.[row.key] ?? {};
    const own = plan!.lengths?.[row.key] ?? {};
    strip.push({
      label: rowWords(row.key),
      hours: hoursWords(row.component, row.held),
      cells: Object.fromEntries(
        weeks.map(([week, count]) => [week, { count, exams: (exams[week] ?? []).filter((place) => place <= count).length, own: Boolean(own[week]) }]),
      ),
    });
    const lasting = lengthWords(own);
    if (lasting) otherwise.push(`${rowWords(row.key)}: ${lasting}`);
  }
  if (!plan || !strip.length) {
    const said = [...new Set(typed.map((each) => each.trim()).filter(Boolean))];
    return {
      strip,
      lead: plan?.leadName ?? "",
      lines: said.length ? said.map((each) => `Weeks as typed on Groups & CRNs: ${each}`) : ["Weeks not laid out by the course lead yet."],
    };
  }
  const order = orderWords(plan);
  return {
    strip,
    lead: plan.leadName,
    lines: [
      ...examWords(plan.exams),
      order.length ? `In a week with both: ${order.join("; ")}` : "",
      otherwise.length ? `Sessions lasting otherwise — ${otherwise.join(" · ")}` : "",
    ].filter(Boolean),
  };
}

/**
 * The brief, from the Timetable workbook's own rows (made without the answers folded in, so
 * what was typed and what was answered stay apart), the semester's answers and its course plans.
 */
export function briefOf(input: {
  sheets: RequestSheet[];
  semester: string;
  scope: string;
  wishes: WishSemester | null;
  plans: CoursePlanSemester | null;
  made?: Date;
}): Brief {
  const { sheets, wishes, plans } = input;
  const byCourse = new Map((plans?.courses ?? []).map((plan) => [plan.courseCode.toUpperCase(), plan]));
  const byTeacher = new Map((wishes?.teachers ?? []).map((teacher) => [teacher.teacherId, teacher]));
  const collection = wishes?.collection ?? null;
  const grid = {
    days: collection?.days.length ? [...collection.days].sort((a, b) => a - b) : [1, 2, 3, 4, 5],
    firstHour: collection?.firstHour ?? 8,
    lastHour: collection?.lastHour ?? 18,
  };
  const numberOf = new Map(teachingWeeks(wishes?.calendar).map((week) => [week.monday, week.number]));

  const cohorts: BriefCohort[] = [];
  const teaching = new Map<string, { name: string; classes: string[] }>();
  for (const sheet of sheets) {
    const courses = new Map<string, { title: string; classes: BriefClass[]; typed: string[] }>();
    for (const row of sheet.rows) {
      if (row.retired) continue;
      const code = row.courseCode || `${row.subject}-${row.courseNumber}`;
      const held = courses.get(code) ?? { title: row.courseTitle || row.courseName, classes: [], typed: [] };
      const label = [row.type, row.group].filter(Boolean).join(" ");
      held.classes.push({
        label,
        crn: row.crn,
        teacher: row.teacher,
        hours: row.hours,
        length: lengthOf(row.duration, byCourse.get(code.toUpperCase()), row.type, row.crn),
        students: row.anticipated,
        notes: [
          row.roomPref && `Room: ${row.roomPref}`,
          row.timePref && `Time: ${row.timePref}`,
          row.dayPref && `Day: ${row.dayPref}`,
          row.constraints,
          row.comments,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      held.typed.push(row.weeks);
      courses.set(code, held);
      if (row.teacherId) {
        const who = teaching.get(row.teacherId) ?? { name: row.teacher, classes: [] };
        who.classes.push(`${code} ${label}${row.crn ? ` (${row.crn})` : ""}`);
        teaching.set(row.teacherId, who);
      }
    }
    if (!courses.size) continue;
    cohorts.push({
      name: sheet.heading,
      courses: [...courses.entries()].map(([code, held]) => {
        const plan = planOf(byCourse.get(code.toUpperCase()), held.typed);
        return { code, title: held.title, lead: plan.lead, classes: held.classes, strip: plan.strip, lines: plan.lines };
      }),
    });
  }

  const teachers: BriefTeacher[] = [...teaching.entries()]
    .map(([teacherId, who]) => {
      const answered = byTeacher.get(teacherId);
      const words = answered ? teacherWords(answered, collection, wishes?.calendar) : null;
      return {
        name: who.name,
        answer: answered ? answerWords(answered) : "No answer yet",
        classes: [...new Set(who.classes)],
        words,
        blocks: (answered?.wishes?.blocks ?? [])
          .filter((block) => block.repeat !== "once")
          .map((block) => ({
            hard: block.kind === "constraint",
            days: block.days,
            from: block.from,
            to: block.to,
            fromWeek: block.repeat === "from" ? (numberOf.get(block.week) ?? null) : null,
          }))
          // Every week's first, so a block starting later is drawn over them, as the form layers them.
          .sort((left, right) => Number(left.fromWeek !== null) - Number(right.fromWeek !== null)),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const made = input.made ?? new Date();
  return {
    semester: input.semester,
    scope: input.scope,
    made: made.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    weeks: briefWeeks(plans, wishes),
    grid,
    cohorts,
    teachers,
    missing: [collection ? "" : "teachers' answers", plans ? "" : "course leads' weeks"].filter(Boolean),
  };
}

// ------------------------------------------------------------------ how it is drawn

type Rgb = [number, number, number];
const INK: Rgb = [23, 23, 23];
const SOFT: Rgb = [102, 112, 133];
const FAINT: Rgb = [152, 162, 179];
const NAVY: Rgb = [31, 78, 121];
const BAND: Rgb = [31, 56, 100];
const RULE: Rgb = [208, 213, 221];
const HEAD_FILL: Rgb = [242, 244, 247];
const OFF_FILL: Rgb = [228, 231, 236];
/** The form's own colours: a hard constraint red, a soft one yellow; an exam purple. */
const HARD: Rgb = [217, 100, 106];
const HARD_LIGHT: Rgb = [236, 178, 181];
const HARD_INK: Rgb = [166, 41, 47];
const SOFT_FILL: Rgb = [233, 189, 58];
const SOFT_LIGHT: Rgb = [244, 222, 157];
const SOFT_INK: Rgb = [122, 90, 0];
const EXAM: Rgb = [83, 56, 158];
const OWN: Rgb = [138, 97, 22];

const PAGE = { width: 595.28, height: 841.89, left: 36, right: 595.28 - 36, top: 40, bottom: 841.89 - 40 };
const WIDTH = PAGE.right - PAGE.left;

/**
 * The words as the PDF's built-in font can set them. Helvetica holds Western European letters
 * and the usual punctuation, not every character a teacher may type, so anything else is
 * written as "?" rather than as garbage.
 */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function printable(text: string): string {
  return [...text.normalize("NFC")]
    .map((char) => {
      if (char === "\t") return " ";
      if (char === "\n") return char;
      const code = char.codePointAt(0) ?? 0;
      if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char)) return char;
      if (char === "→") return "->";
      return "?";
    })
    .join("");
}

/** Where the pen is, and a page turned when what comes next would not fit. */
class Pen {
  y = PAGE.top;
  constructor(readonly doc: JsPdf) {}
  /** A new page unless `height` fits on this one; true when one was added. */
  need(height: number): boolean {
    if (this.y + height <= PAGE.bottom || this.y === PAGE.top) return false;
    this.page();
    return true;
  }
  page() {
    this.doc.addPage("a4", "portrait");
    this.y = PAGE.top;
  }
}

function font(doc: JsPdf, size: number, style: "normal" | "bold" | "italic" = "normal", color: Rgb = INK) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/** The lines `text` takes at `width`, in the font set now. */
function wrap(doc: JsPdf, text: string, width: number): string[] {
  return text ? (doc.splitTextToSize(printable(text), width) as string[]) : [];
}

/** A paragraph: its lines from `y`, `leading` apart; returns the height it took. */
function paragraph(doc: JsPdf, text: string, x: number, y: number, width: number, leading: number): number {
  const lines = wrap(doc, text, width);
  lines.forEach((line, index) => doc.text(line, x, y + index * leading));
  return lines.length * leading;
}

// The classes' table: its columns, left to right, across the page's width.
const CLASS_COLUMNS = [
  { name: "Class", width: 52 },
  { name: "CRN", width: 40 },
  { name: "Teacher", width: 112 },
  { name: "Hours", width: 34, align: "center" as const },
  { name: "Session", width: 38, align: "center" as const },
  { name: "Students", width: 40, align: "center" as const },
  { name: "Notes", width: WIDTH - 52 - 40 - 112 - 34 - 38 - 40 },
];
const CELL_PAD = 3;
const ROW_LEADING = 9.5;

function classCells(entry: BriefClass): string[] {
  return [
    entry.label,
    entry.crn || "—",
    entry.teacher || "—",
    // A figure in hours; anything else typed there, as typed.
    entry.hours && isFigure(entry.hours) ? `${entry.hours.trim()} h` : entry.hours,
    entry.length && isFigure(entry.length) ? `${entry.length} h` : entry.length,
    entry.students === "" ? "" : String(entry.students),
    entry.notes,
  ];
}

function classRowHeight(doc: JsPdf, entry: BriefClass): number {
  font(doc, 7.5);
  const lines = Math.max(1, ...classCells(entry).map((cell, index) => wrap(doc, cell, CLASS_COLUMNS[index].width - 2 * CELL_PAD).length));
  return lines * ROW_LEADING + 4;
}

function drawClassHeader(pen: Pen) {
  const { doc } = pen;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(PAGE.left, pen.y, WIDTH, 13, "F");
  font(doc, 7, "bold", SOFT);
  let x = PAGE.left;
  for (const column of CLASS_COLUMNS) {
    doc.text(column.name, column.align === "center" ? x + column.width / 2 : x + CELL_PAD, pen.y + 9, { align: column.align ?? "left" });
    x += column.width;
  }
  pen.y += 13;
}

function drawClassRow(pen: Pen, entry: BriefClass) {
  const { doc } = pen;
  const height = classRowHeight(doc, entry);
  font(doc, 7.5);
  let x = PAGE.left;
  classCells(entry).forEach((cell, index) => {
    const column = CLASS_COLUMNS[index];
    if (index === 2 && !entry.teacher) doc.setTextColor(...FAINT);
    else if (index === 6) doc.setTextColor(...SOFT);
    else doc.setTextColor(...INK);
    wrap(doc, cell, column.width - 2 * CELL_PAD).forEach((line, at) => {
      doc.text(line, column.align === "center" ? x + column.width / 2 : x + CELL_PAD, pen.y + 9 + at * ROW_LEADING, { align: column.align ?? "left" });
    });
    x += column.width;
  });
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(PAGE.left, pen.y + height, PAGE.right, pen.y + height);
  pen.y += height;
}

// The week strips: a label column, then a column a week, a narrow grey one for a week off.
const STRIP_LABEL = 74;
const OFF_WIDTH = 9;
const STRIP_ROW = 13;

function stripColumns(weeks: BriefWeek[]): { week: BriefWeek; x: number; width: number }[] {
  const teaching = weeks.filter((week) => "number" in week).length;
  const offs = weeks.length - teaching;
  const width = teaching ? (WIDTH - STRIP_LABEL - offs * OFF_WIDTH) / teaching : 0;
  let x = PAGE.left + STRIP_LABEL;
  return weeks.map((week) => {
    const column = { week, x, width: "number" in week ? width : OFF_WIDTH };
    x += column.width;
    return column;
  });
}

function drawStripHead(pen: Pen, weeks: BriefWeek[], withDates: boolean) {
  const { doc } = pen;
  const height = withDates ? 22 : 12;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(PAGE.left, pen.y, WIDTH, height, "F");
  font(doc, 7, "bold", SOFT);
  doc.text("Week", PAGE.left + CELL_PAD, pen.y + 8.5);
  if (withDates) {
    font(doc, 6, "normal", FAINT);
    doc.text("Monday", PAGE.left + CELL_PAD, pen.y + 18);
  }
  for (const column of stripColumns(weeks)) {
    if (!("number" in column.week)) {
      doc.setFillColor(...OFF_FILL);
      doc.rect(column.x, pen.y, column.width, height, "F");
      continue;
    }
    font(doc, 7, "bold", column.week.holidays.length ? OWN : SOFT);
    doc.text(String(column.week.number), column.x + column.width / 2, pen.y + 8.5, { align: "center" });
    if (withDates && column.week.monday) {
      font(doc, 5.5, "normal", FAINT);
      doc.text(formatDayAndMonth(column.week.monday), column.x + column.width / 2, pen.y + 18, { align: "center" });
    }
  }
  pen.y += height;
}

function drawStripRow(pen: Pen, weeks: BriefWeek[], row: BriefStrip) {
  const { doc } = pen;
  font(doc, 7.5, "bold", INK);
  doc.text(printable(row.label), PAGE.left + CELL_PAD, pen.y + 9);
  if (row.hours) {
    font(doc, 6, "normal", FAINT);
    doc.text(printable(row.hours), PAGE.left + STRIP_LABEL - CELL_PAD, pen.y + 9, { align: "right" });
  }
  for (const column of stripColumns(weeks)) {
    if (!("number" in column.week)) {
      doc.setFillColor(...OFF_FILL);
      doc.rect(column.x, pen.y, column.width, STRIP_ROW, "F");
      continue;
    }
    const cell = row.cells[String(column.week.number)];
    const middle = column.x + column.width / 2;
    if (!cell) {
      font(doc, 7, "normal", [200, 208, 218]);
      doc.text("·", middle, pen.y + 9, { align: "center" });
      continue;
    }
    font(doc, 8, "bold", cell.exams ? EXAM : cell.own ? OWN : NAVY);
    const count = String(cell.count);
    if (cell.exams) {
      const countWidth = doc.getTextWidth(count);
      font(doc, 5.5, "bold", EXAM);
      const markWidth = doc.getTextWidth("E");
      const start = middle - (countWidth + 1 + markWidth) / 2;
      font(doc, 8, "bold", EXAM);
      doc.text(count, start, pen.y + 9.5);
      font(doc, 5.5, "bold", EXAM);
      doc.text("E", start + countWidth + 1, pen.y + 6.5);
      doc.setDrawColor(...EXAM);
      doc.setLineWidth(0.6);
      doc.roundedRect(column.x + 1.5, pen.y + 1.5, column.width - 3, STRIP_ROW - 3, 2, 2, "S");
    } else {
      doc.text(count, middle, pen.y + 9.5, { align: "center" });
    }
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(PAGE.left, pen.y + STRIP_ROW, PAGE.right, pen.y + STRIP_ROW);
  pen.y += STRIP_ROW;
}

function courseHeight(doc: JsPdf, course: BriefCourse, weeks: BriefWeek[]): number {
  font(doc, 7.5);
  const lines = course.lines.reduce((sum, line) => sum + wrap(doc, line, WIDTH).length, 0);
  return (
    18 +
    13 +
    course.classes.reduce((sum, entry) => sum + classRowHeight(doc, entry), 0) +
    (course.strip.length && weeks.length ? 6 + 12 + course.strip.length * STRIP_ROW : 0) +
    (lines ? 4 + lines * 9.5 : 0) +
    14
  );
}

function drawCourse(pen: Pen, course: BriefCourse, weeks: BriefWeek[]) {
  const { doc } = pen;
  const height = courseHeight(doc, course, weeks);
  // A course on one page when it fits one; a longer one at least starts with its heading and a row.
  pen.need(Math.min(height, 18 + 13 + 30));
  font(doc, 10, "bold", INK);
  const title = printable(`${course.code} · ${course.title}`);
  doc.text(title, PAGE.left, pen.y + 10);
  if (course.lead) {
    font(doc, 8, "normal", SOFT);
    doc.text(printable(`Course lead: ${course.lead}`), PAGE.right, pen.y + 10, { align: "right" });
  }
  pen.y += 18;
  drawClassHeader(pen);
  for (const entry of course.classes) {
    if (pen.need(classRowHeight(doc, entry))) drawClassHeader(pen);
    drawClassRow(pen, entry);
  }
  if (course.strip.length && weeks.length) {
    pen.y += 6;
    pen.need(12 + course.strip.length * STRIP_ROW);
    drawStripHead(pen, weeks, false);
    for (const row of course.strip) drawStripRow(pen, weeks, row);
  }
  if (course.lines.length) {
    pen.y += 4;
    for (const line of course.lines) {
      font(doc, 7.5, "normal", line.startsWith("Weeks not") ? FAINT : line.includes("exam") ? EXAM : SOFT);
      const lines = wrap(doc, line, WIDTH);
      pen.need(lines.length * 9.5);
      lines.forEach((each, at) => doc.text(each, PAGE.left, pen.y + 7 + at * 9.5));
      pen.y += lines.length * 9.5;
    }
  }
  pen.y += 14;
}

function band(pen: Pen, text: string) {
  const { doc } = pen;
  pen.need(22 + 60);
  doc.setFillColor(...BAND);
  doc.rect(PAGE.left, pen.y, WIDTH, 18, "F");
  font(doc, 10.5, "bold", [255, 255, 255]);
  doc.text(printable(text), PAGE.left + 6, pen.y + 12.5);
  pen.y += 26;
}

function partHeading(pen: Pen, text: string, intro: string) {
  const { doc } = pen;
  font(doc, 14, "bold", NAVY);
  doc.text(text, PAGE.left, pen.y + 12);
  pen.y += 20;
  font(doc, 8, "normal", SOFT);
  pen.y += paragraph(doc, intro, PAGE.left, pen.y + 6, WIDTH, 10.5) + 8;
}

// A teacher's week: the days across, the hours down, their blocks on it.
const CAL = { width: 236, hour: 9, labels: 26, head: 12 };

function calendarHeight(grid: Brief["grid"]): number {
  return CAL.head + (grid.lastHour - grid.firstHour) * CAL.hour;
}

function drawCalendar(doc: JsPdf, grid: Brief["grid"], blocks: BriefBlock[], x: number, y: number) {
  const days = grid.days;
  const dayWidth = (CAL.width - CAL.labels) / days.length;
  const top = y + CAL.head;
  const bottom = top + (grid.lastHour - grid.firstHour) * CAL.hour;
  const left = x + CAL.labels;
  font(doc, 6.5, "bold", SOFT);
  days.forEach((day, index) => doc.text(DAY_SHORT[day], left + index * dayWidth + dayWidth / 2, y + 8.5, { align: "center" }));
  // The hours' lines first, the blocks over them, the days' frame last.
  doc.setLineWidth(0.3);
  for (let hour = grid.firstHour; hour <= grid.lastHour; hour += 1) {
    const lineY = top + (hour - grid.firstHour) * CAL.hour;
    doc.setDrawColor(...(hour % 2 === 0 ? ([190, 198, 210] as Rgb) : ([228, 232, 238] as Rgb)));
    doc.line(left, lineY, left + days.length * dayWidth, lineY);
    if (hour % 2 === 0 && hour < grid.lastHour) {
      font(doc, 6, "normal", FAINT);
      doc.text(clockOf(hour), left - 3, lineY + 2.5, { align: "right" });
    }
  }
  for (const block of blocks) {
    const from = Math.max(block.from, grid.firstHour);
    const to = Math.min(block.to, grid.lastHour);
    if (to <= from) continue;
    for (const day of block.days) {
      const index = days.indexOf(day);
      if (index < 0) continue;
      const bx = left + index * dayWidth;
      const by = top + (from - grid.firstHour) * CAL.hour;
      const height = (to - from) * CAL.hour;
      const later = block.fromWeek !== null;
      doc.setFillColor(...(block.hard ? (later ? HARD_LIGHT : HARD) : later ? SOFT_LIGHT : SOFT_FILL));
      doc.rect(bx, by, dayWidth, height, "F");
      if (later && height >= 8) {
        font(doc, 5.5, "bold", block.hard ? HARD_INK : SOFT_INK);
        doc.text(`from wk ${block.fromWeek}`, bx + dayWidth / 2, by + 6, { align: "center" });
      }
    }
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  for (let index = 0; index <= days.length; index += 1) doc.line(left + index * dayWidth, top, left + index * dayWidth, bottom);
  doc.line(left, bottom, left + days.length * dayWidth, bottom);
}

/**
 * The lines of a teacher's answer as listed beside their week: a coloured mark and its word, so
 * a black-and-white print still tells hard from soft, then when. A limit holds all semester and
 * says nothing more.
 */
type Listed = { mark: Rgb | null; word: string; ink: Rgb; text: string };
function answerList(words: TeacherWords): Listed[] {
  const weeks = (line: TeacherWords["lines"][number]) =>
    line.weeks && !line.limit ? `, ${line.weeks.charAt(0).toLowerCase()}${line.weeks.slice(1)}` : "";
  return words.lines.map((line) => {
    if (line.kind === "Hard constraint") return { mark: HARD, word: "Hard", ink: HARD_INK, text: `${line.when}${weeks(line)}` };
    if (line.kind === "Soft constraint") return { mark: SOFT_FILL, word: "Soft", ink: SOFT_INK, text: `${line.when}${weeks(line)}` };
    if (line.kind === "Nothing asked") return { mark: null, word: "", ink: SOFT, text: "Answered, with no constraints." };
    return { mark: null, word: line.kind, ink: SOFT, text: line.when };
  });
}
/** Where a listed line's words start, past its mark and its word. */
const LIST_TEXT = 38;

const LIST_X = PAGE.left + CAL.width + 16;
const LIST_WIDTH = PAGE.right - LIST_X;

function teacherHeight(doc: JsPdf, teacher: BriefTeacher, grid: Brief["grid"]): number {
  font(doc, 7.5);
  const teaches = wrap(doc, `Teaches ${teacher.classes.join(", ")}`, WIDTH).length * 9.5;
  if (!teacher.words) return 16 + teaches + 14;
  const listed = answerList(teacher.words).reduce((sum, line) => sum + wrap(doc, line.text, LIST_WIDTH - LIST_TEXT).length * 9.5 + 2, 0);
  return 16 + teaches + 6 + Math.max(calendarHeight(grid), listed) + 16;
}

function drawTeacher(pen: Pen, teacher: BriefTeacher, grid: Brief["grid"]) {
  const { doc } = pen;
  pen.need(teacherHeight(doc, teacher, grid));
  font(doc, 10, "bold", INK);
  doc.text(printable(teacher.name), PAGE.left, pen.y + 10);
  const sent = teacher.answer.startsWith("Sent") || teacher.answer.startsWith("Entered");
  font(doc, 8, "bold", sent ? ([6, 118, 71] as Rgb) : teacher.words ? OWN : FAINT);
  doc.text(printable(teacher.answer), PAGE.right, pen.y + 10, { align: "right" });
  pen.y += 16;
  font(doc, 7.5, "normal", SOFT);
  pen.y += paragraph(doc, `Teaches ${teacher.classes.join(", ")}`, PAGE.left, pen.y + 6, WIDTH, 9.5);
  if (!teacher.words) {
    pen.y += 14;
    return;
  }
  pen.y += 6;
  const top = pen.y;
  drawCalendar(doc, grid, teacher.blocks, PAGE.left, top);
  let y = top + 8;
  for (const line of answerList(teacher.words)) {
    if (line.mark) {
      doc.setFillColor(...line.mark);
      doc.rect(LIST_X, y - 5.5, 6, 6, "F");
    }
    if (line.word) {
      font(doc, 7.5, "bold", line.ink);
      doc.text(printable(line.word), LIST_X + (line.mark ? 9 : 0), y);
    }
    font(doc, 7.5, "normal", line.mark ? INK : SOFT);
    y += paragraph(doc, line.text, LIST_X + (line.word ? LIST_TEXT : 0), y, LIST_WIDTH - LIST_TEXT, 9.5) + 2;
  }
  pen.y = Math.max(top + calendarHeight(grid), y) + 16;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(PAGE.left, pen.y - 8, PAGE.right, pen.y - 8);
}

export async function buildBriefPdf(brief: Brief): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pen = new Pen(doc);

  // The front: what it is, how to read it, and the weeks the strips count in.
  font(doc, 20, "bold", NAVY);
  doc.text("Timetabling brief", PAGE.left, pen.y + 16);
  pen.y += 26;
  font(doc, 11, "bold", INK);
  doc.text(printable(`${brief.semester} · ${brief.scope}`), PAGE.left, pen.y + 10);
  pen.y += 16;
  font(doc, 8, "normal", FAINT);
  doc.text(printable(`Made on ${brief.made} from Coordinator Tools.`), PAGE.left, pen.y + 8);
  pen.y += 18;
  if (brief.missing.length) {
    font(doc, 8.5, "bold", OWN);
    pen.y += paragraph(doc, `Not in this brief: the ${brief.missing.join(" and the ")}, which could not be read for this semester.`, PAGE.left, pen.y + 8, WIDTH, 11) + 6;
  }
  font(doc, 8.5, "normal", INK);
  for (const line of [
    "Part 1 lists each course with its classes and the weeks its course lead laid out. A number in a week is how many sessions that week; a framed number with an E holds an exam; grey columns are weeks off.",
    "Part 2 lists each teacher of those classes with what they asked. Red is a hard constraint: they can't teach then. Yellow is a soft one: they would rather not, so keep it free if possible. A lighter block starts later in the semester.",
  ]) {
    pen.y += paragraph(doc, line, PAGE.left, pen.y + 8, WIDTH, 11) + 4;
  }
  if (brief.weeks.length) {
    pen.y += 8;
    font(doc, 9, "bold", INK);
    doc.text("Teaching weeks", PAGE.left, pen.y + 8);
    pen.y += 14;
    drawStripHead(pen, brief.weeks, brief.weeks.some((week) => "monday" in week && Boolean(week.monday)));
    const holidays = brief.weeks.flatMap((week) => ("number" in week ? week.holidays.map((holiday) => `week ${week.number}, ${holiday}`) : []));
    if (holidays.length) {
      font(doc, 7.5, "normal", OWN);
      pen.y += paragraph(doc, `Holidays: ${holidays.join("; ")}.`, PAGE.left, pen.y + 9, WIDTH, 9.5) + 2;
    }
  }
  pen.y += 18;

  partHeading(pen, "1 · Courses", "Each cohort's courses, with what Groups & CRNs says of each class.");
  if (!brief.cohorts.length) {
    font(doc, 9, "normal", SOFT);
    doc.text("No classes for this semester yet.", PAGE.left, pen.y + 8);
    pen.y += 16;
  }
  for (const cohort of brief.cohorts) {
    band(pen, cohort.name);
    for (const course of cohort.courses) drawCourse(pen, course, brief.weeks);
  }

  if (brief.teachers.length) {
    pen.page();
    partHeading(pen, "2 · Teachers", "Every teacher named on the classes above, with their answer to the Timetable preferences request.");
    let x = PAGE.left;
    for (const [fill, words] of [
      [HARD, "Hard constraint: can't teach then"],
      [SOFT_FILL, "Soft constraint: would rather not, keep it free if possible"],
      [HARD_LIGHT, "Lighter: from a later week on"],
    ] as const) {
      doc.setFillColor(...fill);
      doc.rect(x, pen.y, 7, 7, "F");
      font(doc, 7.5, "normal", SOFT);
      doc.text(words, x + 10, pen.y + 6);
      x += 10 + doc.getTextWidth(words) + 16;
    }
    pen.y += 20;
    for (const teacher of brief.teachers) drawTeacher(pen, teacher, brief.grid);
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    font(doc, 6.5, "normal", FAINT);
    doc.text(printable(`Timetabling brief · ${brief.semester}`), PAGE.left, PAGE.height - 22);
    doc.text(`Page ${page} of ${total}`, PAGE.right, PAGE.height - 22, { align: "right" });
  }
  return doc.output("arraybuffer");
}

export async function downloadBriefPdf(brief: Brief, filename: string): Promise<void> {
  const blob = new Blob([await buildBriefPdf(brief)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
