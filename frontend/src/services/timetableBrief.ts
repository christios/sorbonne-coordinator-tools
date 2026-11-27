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
  figure,
  heldOf,
  hoursWords,
  orderWords,
  rowWords,
  rowsOf,
  sessionLengths,
  withWeeksOff,
  type Component,
  type CoursePlan,
  type CoursePlanSemester,
  type TeachingWeek,
} from "@/services/coursePlans";
import type { Mutualized } from "@/services/portalLists";
import type { Period, Plan } from "@/services/semesterPlans";
import { DAY_SHORT, clockOf, isoPlus, isoWeekday, periodRules, teachingWeeks, type WishSemester } from "@/services/teacherWishes";
import { answerWords, rowKeyOf, teacherWords, type TeacherWords } from "@/services/timetableConstraints";
import type { RequestSheet } from "@/services/timetableExport";
import { formatDayAndMonth } from "@/services/weekSchedule";

// ------------------------------------------------------------------ what it says

/** A column of the week strips: a teaching week, or a week off between two; each with the holidays in it. */
export type BriefWeek = { number: number; monday: string; holidays: string[] } | { off: string; holidays: string[] };

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
  /**
   * By week number: each session's length (0 where the course has no length yet), how many of
   * them are exams, and whether one lasts other than usual.
   */
  cells: Record<string, { lengths: number[]; exams: number; own: boolean }>;
};

export type BriefCourse = {
  code: string;
  title: string;
  lead: string;
  /** Taught to the mathematicians and the physicists at once: "yes", "no", or "" not said. */
  mutualized: Mutualized;
  /** What the lead wrote beside their weeks, and why their weeks run unevenly, when they said. */
  leadNote: string;
  paceReason: string;
  classes: BriefClass[];
  strip: BriefStrip[];
  /** Exams, the order asked for — or, not laid out, what was typed. */
  lines: string[];
};

/** A period binding everybody (Ramadan), in words, with its dates to find the weeks it touches. */
export type BriefPeriod = { label: string; from: string; to: string; words: string };

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
  /** "Week 1 starts Mon 25 Jan 2027 · 17 teaching weeks · ends Fri 21 May 2027"; "" without dates. */
  calendar: string;
  weeks: BriefWeek[];
  periods: BriefPeriod[];
  /** Every holiday of the semester, a line each: "Wed 31 Mar 2027 — Eid al-Fitr". */
  holidays: string[];
  grid: { days: number[]; firstHour: number; lastHour: number };
  cohorts: BriefCohort[];
  teachers: BriefTeacher[];
  /** What could not be read for the semester and is missing from the brief. */
  missing: string[];
};

/** "Wed 31 Mar", "Wed 31 Mar 2027": a date as the brief says it. */
function dayWords(iso: string, year = false): string {
  return `${DAY_SHORT[isoWeekday(iso)]} ${formatDayAndMonth(iso)}${year ? ` ${iso.slice(0, 4)}` : ""}`;
}

/** "Mon–Fri", "Mon, Wed": days of the week, three or more in a row as a range. */
function daysWords(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const inARow = sorted.every((day, index) => !index || day === sorted[index - 1] + 1);
  if (sorted.length >= 3 && inARow) return `${DAY_SHORT[sorted[0]]}–${DAY_SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((day) => DAY_SHORT[day]).join(", ");
}

/**
 * The semester's weeks: teaching weeks with their Mondays and the weeks off between, each with
 * the holidays in it. The Semester plan's own settings first, which hold the breaks, holidays and
 * periods (user, 27 Nov 2026: "the semester blocks we have and all of them"); else the course
 * plans' weeks; else the preferences request's calendar.
 */
function briefWeeks(plan: Plan | null, plans: CoursePlanSemester | null, wishes: WishSemester | null): BriefWeek[] {
  const holidays = plan?.holidays ?? [];
  const inWeek = (monday: string) =>
    holidays
      .filter((holiday) => holiday.date >= monday && holiday.date <= isoPlus(monday, 6))
      .map((holiday) => `${dayWords(holiday.date)} ${holiday.label}`.trim());
  const weeks: TeachingWeek[] = plan?.weekOne
    ? teachingWeeks(plan).map((week) => ({ week: week.number, monday: week.monday, holidays: [] }))
    : plans?.weeks.length
      ? plans.weeks
      : teachingWeeks(wishes?.calendar).map((week) => ({ week: week.number, monday: week.monday, holidays: [] }));
  if (weeks.some((week) => !week.monday)) return weeks.map((week) => ({ number: week.week, monday: "", holidays: [] }));
  return withWeeksOff(weeks).map((column) =>
    column.week
      ? {
          number: column.week.week,
          monday: column.week.monday,
          holidays: plan
            ? inWeek(column.week.monday)
            : column.week.holidays.map((holiday) => `${dayWords(holiday.date)} ${holiday.label}`.trim()),
        }
      : { off: column.off, holidays: inWeek(column.off) },
  );
}

/** "Ramadan, 8 Feb – 9 Mar: classes end by 15:00 · longest class 1h30, Mon–Fri". */
function periodOf(period: Period): BriefPeriod {
  const days = period.days.length && period.days.length < 7 ? `, ${daysWords(period.days)}` : "";
  const rules = periodRules(period);
  return {
    label: period.label,
    from: period.from,
    to: period.to,
    words: `${period.label}, ${formatDayAndMonth(period.from)} – ${formatDayAndMonth(period.to)}${rules.length ? `: ${rules.join(" · ")}` : ""}${days}`,
  };
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

/** "1st", "2nd", "3rd", "4th": a session's place in its week. */
function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${["th", "st", "nd", "rd"][place % 10] ?? "th"}`;
}

/**
 * A course's weeks, as its lead laid them out: a strip row per component or part, each week's
 * sessions with their lengths, and the lines under it — each exam's week, session and length,
 * and the order asked for.
 */
function planOf(plan: CoursePlan | undefined, typed: string[]): { strip: BriefStrip[]; lines: string[] } {
  const strip: BriefStrip[] = [];
  const exams: string[] = [];
  for (const row of plan ? rowsOf(plan) : []) {
    const weeks = Object.entries(plan!.weeks[row.key] ?? {}).filter(([, count]) => count > 0);
    if (!weeks.length) continue;
    const examsOf = plan!.exams?.[row.key] ?? {};
    const own = plan!.lengths?.[row.key] ?? {};
    const usual = row.held.length ?? 0;
    strip.push({
      label: rowWords(row.key),
      hours: hoursWords(row.component, row.held),
      cells: Object.fromEntries(
        weeks.map(([week, count]) => [
          week,
          {
            lengths: sessionLengths(usual, own[week], count),
            exams: (examsOf[week] ?? []).filter((place) => place <= count).length,
            own: Boolean(own[week]),
          },
        ]),
      ),
    });
    for (const [week, places] of Object.entries(examsOf).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      const count = plan!.weeks[row.key]?.[week] ?? 0;
      const lengths = sessionLengths(usual, own[week], count);
      for (const place of places.filter((each) => each <= count)) {
        const length = lengths[place - 1];
        const which = [count > 1 ? `${ordinal(place)} session` : "", length ? `${figure(length)} h` : ""].filter(Boolean).join(", ");
        exams.push(`${rowWords(row.key)} exam in week ${week}${which ? ` (${which})` : ""}`);
      }
    }
  }
  if (!plan || !strip.length) {
    const said = [...new Set(typed.map((each) => each.trim()).filter(Boolean))];
    return {
      strip,
      lines: said.length ? said.map((each) => `Weeks as typed on Groups & CRNs: ${each}`) : ["Weeks not laid out by the course lead yet."],
    };
  }
  const order = orderWords(plan);
  return { strip, lines: [...exams, order.length ? `In a week with both: ${order.join("; ")}` : ""].filter(Boolean) };
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
  /** The Semester plan's settings: its weeks, breaks, holidays and periods. */
  plan?: Plan | null;
  made?: Date;
}): Brief {
  const { sheets, wishes, plans } = input;
  const plan = input.plan ?? null;
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
    const courses = new Map<string, { title: string; mutualized: Mutualized; classes: BriefClass[]; typed: string[] }>();
    for (const row of sheet.rows) {
      if (row.retired) continue;
      const code = row.courseCode || `${row.subject}-${row.courseNumber}`;
      const held = courses.get(code) ?? { title: row.courseTitle || row.courseName, mutualized: row.mutualized ?? "", classes: [], typed: [] };
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
        const course = byCourse.get(code.toUpperCase());
        const laid = planOf(course, held.typed);
        return {
          code,
          title: held.title,
          lead: course?.leadName ?? "",
          mutualized: held.mutualized,
          leadNote: course?.note?.trim() ?? "",
          paceReason: course?.paceReason?.trim() ?? "",
          classes: held.classes,
          strip: laid.strip,
          lines: laid.lines,
        };
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
  const weeks = briefWeeks(plan, plans, wishes);
  const teachingOnly = weeks.filter((week): week is Extract<BriefWeek, { number: number }> => "number" in week);
  const first = teachingOnly[0];
  const last = teachingOnly[teachingOnly.length - 1];
  const lastDay = Math.max(...grid.days);
  return {
    semester: input.semester,
    scope: input.scope,
    made: made.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    calendar:
      first?.monday && last?.monday
        ? `Week 1 starts ${dayWords(first.monday, true)} · ${teachingOnly.length} teaching weeks · ends ${dayWords(isoPlus(last.monday, lastDay - 1), true)}`
        : "",
    weeks,
    periods: (plan?.periods ?? []).filter((period) => period.from && period.to).map(periodOf),
    holidays: [...(plan?.holidays ?? [])]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((holiday) => `${dayWords(holiday.date, true)} — ${holiday.label}`),
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
const STRIP_LABEL = 64;
const OFF_WIDTH = 8;
const STRIP_ROW = 14;

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
      doc.text("·", middle, pen.y + 9.5, { align: "center" });
      continue;
    }
    // The week's sessions with their lengths, set as large as the column lets them.
    const said = cellWords(cell.lengths);
    const room = column.width - (cell.exams ? 7 : 3);
    let size = 7;
    font(doc, size, "bold");
    while (size > 4.5 && doc.getTextWidth(said) > room) {
      size -= 0.25;
      font(doc, size, "bold");
    }
    font(doc, size, "bold", cell.exams ? EXAM : cell.own ? OWN : NAVY);
    doc.text(fitted(doc, said, room), cell.exams ? middle - 2 : middle, pen.y + 9.5, { align: "center" });
    if (cell.exams) {
      font(doc, 5, "bold", EXAM);
      doc.text("E", column.x + column.width - 3.2, pen.y + 6, { align: "right" });
      doc.setDrawColor(...EXAM);
      doc.setLineWidth(0.6);
      doc.roundedRect(column.x + 1, pen.y + 1.5, column.width - 2, STRIP_ROW - 3, 2, 2, "S");
    }
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(PAGE.left, pen.y + STRIP_ROW, PAGE.right, pen.y + STRIP_ROW);
  pen.y += STRIP_ROW;
}

/** "2×1.5h", "1.5+3h", or the count alone while the course has no session length. */
export function cellWords(lengths: number[]): string {
  if (!lengths.length) return "";
  if (lengths.some((length) => !length)) return String(lengths.length);
  return new Set(lengths).size === 1 ? `${lengths.length}×${figure(lengths[0])}h` : `${lengths.map(figure).join("+")}h`;
}

/** As much of the words as fits, cut with an ellipsis. */
function fitted(doc: JsPdf, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** What is said under a course's weeks: its exams and order, why its weeks are uneven, its lead's note. */
function courseLines(course: BriefCourse): { text: string; ink: Rgb }[] {
  return [
    ...course.lines.map((text) => ({ text, ink: text.startsWith("Weeks not") ? FAINT : text.includes(" exam in ") ? EXAM : SOFT })),
    ...(course.paceReason ? [{ text: `Why the weeks are uneven: ${course.paceReason}`, ink: SOFT }] : []),
    ...(course.leadNote ? [{ text: `Lead's note: ${course.leadNote}`, ink: SOFT }] : []),
  ];
}

/** The course's Mutualized tag, as Active courses says it: none while nobody has said. */
function mutualizedWords(mutualized: BriefCourse["mutualized"]): string {
  if (mutualized === "yes") return "Mutualized: Maths and Physics together";
  if (mutualized === "no") return "Not mutualized";
  return "";
}

function courseHeight(doc: JsPdf, course: BriefCourse, weeks: BriefWeek[]): number {
  font(doc, 7.5);
  const lines = courseLines(course).reduce((sum, line) => sum + wrap(doc, line.text, WIDTH).length, 0);
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
  let leadAt = PAGE.right;
  if (course.lead) {
    font(doc, 8, "normal", SOFT);
    const said = printable(`Course lead: ${course.lead}`);
    doc.text(said, PAGE.right, pen.y + 10, { align: "right" });
    leadAt -= doc.getTextWidth(said) + 10;
  }
  // The Mutualized tag beside the title, as a pill.
  const tag = mutualizedWords(course.mutualized);
  if (tag) {
    font(doc, 10, "bold");
    const x = PAGE.left + doc.getTextWidth(title) + 8;
    font(doc, 7, "bold", course.mutualized === "yes" ? ([6, 89, 102] as Rgb) : SOFT);
    const width = doc.getTextWidth(tag) + 8;
    if (x + width <= leadAt) {
      doc.setFillColor(...(course.mutualized === "yes" ? ([224, 242, 245] as Rgb) : HEAD_FILL));
      doc.roundedRect(x, pen.y + 2.5, width, 10, 3, 3, "F");
      doc.text(tag, x + 4, pen.y + 9.6);
    } else {
      doc.text(tag, PAGE.left, pen.y + 20);
      pen.y += 10;
    }
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
  const said = courseLines(course);
  if (said.length) {
    pen.y += 4;
    for (const line of said) {
      font(doc, 7.5, "normal", line.ink);
      const lines = wrap(doc, line.text, WIDTH);
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

/** A colour for each period of the semester, in turn: its chip in the weeks and in the list. */
const PERIOD_COLORS: Rgb[] = [
  [21, 112, 239],
  [112, 65, 196],
  [3, 152, 85],
  [220, 104, 3],
  [192, 38, 211],
];
const GLANCE = { week: 40, dates: 104, row: 13 };

function chip(doc: JsPdf, color: Rgb, x: number, y: number) {
  doc.setFillColor(...color);
  doc.roundedRect(x, y, 3, 9, 1, 1, "F");
}

/**
 * The semester at a glance (user, 27 Nov 2026: "the semester blocks we have and all of them …
 * at the beginning"): a line saying when it starts and ends, then a row a week — its dates, a
 * break as a grey row, the periods and holidays that touch it — then each period's rules in full
 * and every holiday.
 */
function drawGlance(pen: Pen, brief: Brief) {
  const { doc } = pen;
  font(doc, 14, "bold", NAVY);
  doc.text("Semester at a glance", PAGE.left, pen.y + 12);
  pen.y += 20;
  if (brief.calendar) {
    font(doc, 9, "bold", INK);
    doc.text(printable(brief.calendar), PAGE.left, pen.y + 8);
    pen.y += 16;
  }
  if (!brief.weeks.length) {
    font(doc, 8.5, "normal", SOFT);
    doc.text("The semester's weeks are not set yet.", PAGE.left, pen.y + 8);
    pen.y += 16;
    return;
  }
  const lastDay = Math.max(...brief.grid.days);
  const dated = brief.weeks.every((week) => ("number" in week ? Boolean(week.monday) : true));
  const touches = (monday: string) =>
    brief.periods
      .map((period, index) => ({ period, color: PERIOD_COLORS[index % PERIOD_COLORS.length] }))
      .filter(({ period }) => monday && period.from <= isoPlus(monday, 6) && period.to >= monday);

  // The heading row.
  doc.setFillColor(...HEAD_FILL);
  doc.rect(PAGE.left, pen.y, WIDTH, 13, "F");
  font(doc, 7, "bold", SOFT);
  doc.text("Week", PAGE.left + CELL_PAD, pen.y + 9);
  if (dated) doc.text("Dates", PAGE.left + GLANCE.week + CELL_PAD, pen.y + 9);
  doc.text("On that week", PAGE.left + GLANCE.week + GLANCE.dates + CELL_PAD, pen.y + 9);
  pen.y += 13;

  const notesX = PAGE.left + GLANCE.week + GLANCE.dates + CELL_PAD;
  for (const week of brief.weeks) {
    pen.need(GLANCE.row);
    const off = !("number" in week);
    const monday = off ? week.off : week.monday;
    if (off) {
      doc.setFillColor(...OFF_FILL);
      doc.rect(PAGE.left, pen.y, WIDTH, GLANCE.row, "F");
    }
    font(doc, 8, "bold", off ? SOFT : INK);
    doc.text(off ? "—" : String(week.number), PAGE.left + CELL_PAD, pen.y + 9);
    if (monday) {
      font(doc, 8, "normal", off ? SOFT : INK);
      doc.text(`${formatDayAndMonth(monday)} – ${formatDayAndMonth(isoPlus(monday, lastDay - 1))}`, PAGE.left + GLANCE.week + CELL_PAD, pen.y + 9);
    }
    // What is on that week: a break, the periods it falls in, its holidays.
    let x = notesX;
    const room = () => PAGE.right - CELL_PAD - x;
    if (off) {
      font(doc, 8, "bold", SOFT);
      doc.text("Break, no teaching", x, pen.y + 9);
      x += doc.getTextWidth("Break, no teaching") + 10;
    }
    for (const { period, color } of touches(monday)) {
      if (room() < 20) break;
      chip(doc, color, x, pen.y + 2);
      font(doc, 8, "bold", color);
      const label = fitted(doc, printable(period.label), room() - 6);
      doc.text(label, x + 6, pen.y + 9);
      x += 6 + doc.getTextWidth(label) + 10;
    }
    for (const holiday of week.holidays) {
      if (room() < 20) break;
      font(doc, 8, "normal", OWN);
      const said = fitted(doc, printable(`${holiday} (holiday)`), room());
      doc.text(said, x, pen.y + 9);
      x += doc.getTextWidth(said) + 10;
    }
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(PAGE.left, pen.y + GLANCE.row, PAGE.right, pen.y + GLANCE.row);
    pen.y += GLANCE.row;
  }

  // Each period's rules in full, then every holiday.
  pen.y += 10;
  font(doc, 9, "bold", INK);
  pen.need(30);
  doc.text("Periods for everybody", PAGE.left, pen.y + 8);
  pen.y += 13;
  if (!brief.periods.length) {
    font(doc, 8, "normal", SOFT);
    doc.text("None set for this semester.", PAGE.left, pen.y + 8);
    pen.y += 12;
  }
  brief.periods.forEach((period, index) => {
    const color = PERIOD_COLORS[index % PERIOD_COLORS.length];
    font(doc, 8, "normal", INK);
    const lines = wrap(doc, period.words, WIDTH - 8);
    pen.need(lines.length * 10.5);
    chip(doc, color, PAGE.left, pen.y + 1.5);
    lines.forEach((line, at) => doc.text(line, PAGE.left + 8, pen.y + 8.5 + at * 10.5));
    pen.y += lines.length * 10.5 + 2;
  });
  pen.y += 8;
  font(doc, 9, "bold", INK);
  pen.need(30);
  doc.text("Holidays", PAGE.left, pen.y + 8);
  pen.y += 13;
  font(doc, 8, "normal", brief.holidays.length ? OWN : SOFT);
  for (const holiday of brief.holidays.length ? brief.holidays : ["None set for this semester."]) {
    pen.need(10.5);
    doc.text(printable(holiday), PAGE.left, pen.y + 8.5);
    pen.y += 10.5;
  }
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
  drawGlance(pen, brief);
  pen.y += 16;
  pen.need(80);
  font(doc, 9, "bold", INK);
  doc.text("How to read it", PAGE.left, pen.y + 8);
  pen.y += 13;
  font(doc, 8.5, "normal", INK);
  for (const line of [
    "Part 1 lists each course with its classes and the weeks its course lead laid out. A week shows its sessions and their length: 2×1.5h is two sessions of 1.5 hours, 1.5+3h two sessions of different lengths. A framed week with an E holds an exam. Grey columns are breaks.",
    "Part 2 lists each teacher of those classes with what they asked. Red is a hard constraint: they can't teach then. Yellow is a soft one: they would rather not, so keep it free if possible. A lighter block starts later in the semester.",
  ]) {
    pen.y += paragraph(doc, line, PAGE.left, pen.y + 8, WIDTH, 11) + 4;
  }
  pen.y += 14;

  pen.page();
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
