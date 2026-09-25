/**
 * CRN schedules as a PDF: the record's week grid, one page per teaching week.
 *
 * One CRN from its record, or several ticked on Active CRNs and drawn on the same grid — a
 * group's week, or a teacher's. Drawn like the calendar in the app — days across, hours
 * down, 08:00 to 18:00 at least — and each class says what its box says there: the name,
 * the hours, the room, the group and CRN, the teacher, with the same icons. Each CRN has
 * its colour and a line in the legend; two that meet at the same hour sit side by side.
 * A cancelled class is faded and struck through, a covered one striped and says who
 * covered it, as on screen.
 *
 * Built in the browser from the portal's dated meetings and the department's notes on
 * them. It holds no student names.
 */

import type { jsPDF as JsPdf } from "jspdf";

import { COURSE_COLORS, MONTH_NAMES, formatRoom, minutesOf, mondayOf, parseIsoDate, toIsoDate, weekNumber } from "@/services/weekSchedule";

export type ScheduleMeeting = { meetsOn: string; startsAt: string; endsAt: string; room: string };
export type ScheduleNote = { meetsOn: string; startsAt: string; kind: "cancelled" | "covered"; coverTeacherName: string; note: string };

/** One CRN: what it is, who teaches it, and every meeting the portal has for it. */
export type ScheduleSection = {
  crn: string;
  courseCode: string;
  title: string;
  teacher: string;
  /** The group of ours it teaches — "CM Mathematics", "TD 3" — where a course card says. */
  group?: string;
  meetings: ScheduleMeeting[];
  notes: ScheduleNote[];
};

export type ScheduleInput = {
  /** The semester, named; blank when the CRNs span more than one. */
  semester: string;
  sections: ScheduleSection[];
  /** Any day of the semester's first teaching week, when Settings → Semesters has one. */
  weekOne?: string;
  /** When the portal's timetable was last swept, ISO. */
  sweptAt?: string;
};

/** One class on the page, and what happened to it. */
export type ScheduleClass = {
  crn: string;
  courseCode: string;
  group: string;
  teacher: string;
  day: string;
  startsAt: string;
  endsAt: string;
  room: string;
  state: "" | "cancelled" | "covered";
  /** Who covered it, for a covered class. */
  cover: string;
  note: string;
  /** Side by side with the classes it overlaps: which of how many places it takes. */
  lane: number;
  lanes: number;
};

/** One page: a week of the schedule, with or without a class in it. */
export type ScheduleWeek = {
  monday: string;
  /** Its teaching week, counted from Week 1; null where no Week 1 is set, or before it. */
  week: number | null;
  /** Monday to Friday, and Saturday only in a week that uses it. */
  days: string[];
  classes: ScheduleClass[];
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 31 Aug 2026". */
export function dayWords(iso: string): string {
  const day = parseIsoDate(iso);
  return `${DAYS[day.getDay()]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`;
}

/** "31 Aug". */
function shortDay(iso: string): string {
  const day = parseIsoDate(iso);
  return `${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`;
}

function plusDays(iso: string, days: number): string {
  const day = parseIsoDate(iso);
  return toIsoDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days));
}

/**
 * Side by side, as the calendar does: classes that overlap share their hour, each in a
 * place of its own, and a class overlapping nothing has the whole width of its day.
 */
function laidSideBySide(classes: Omit<ScheduleClass, "lane" | "lanes">[]): ScheduleClass[] {
  const placed: ScheduleClass[] = [];
  const byDay = new Map<string, Omit<ScheduleClass, "lane" | "lanes">[]>();
  for (const entry of classes) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
  for (const day of [...byDay.keys()].sort()) {
    const ordered = [...(byDay.get(day) ?? [])].sort(
      (left, right) => minutesOf(left.startsAt) - minutesOf(right.startsAt) || left.crn.localeCompare(right.crn),
    );
    let cluster: ScheduleClass[] = [];
    let ends: number[] = [];
    let reach = -1;
    const close = () => {
      for (const entry of cluster) entry.lanes = ends.length;
      placed.push(...cluster);
      cluster = [];
      ends = [];
    };
    for (const entry of ordered) {
      const start = minutesOf(entry.startsAt);
      if (cluster.length && start >= reach) close();
      let lane = ends.findIndex((end) => end <= start);
      if (lane < 0) lane = ends.length;
      ends[lane] = minutesOf(entry.endsAt);
      reach = cluster.length ? Math.max(reach, minutesOf(entry.endsAt)) : minutesOf(entry.endsAt);
      cluster.push({ ...entry, lane, lanes: 1 });
    }
    close();
  }
  return placed;
}

/**
 * The pages: every week from the first class to the last, in order. A week with none — a
 * break — keeps its page, drawn empty, so the weeks run on without a gap to explain.
 */
export function scheduleWeeks(input: ScheduleInput): ScheduleWeek[] {
  const byWeek = new Map<string, Omit<ScheduleClass, "lane" | "lanes">[]>();
  for (const section of input.sections) {
    const noteOn = new Map(section.notes.map((note) => [`${note.meetsOn}|${note.startsAt}`, note]));
    for (const meeting of section.meetings) {
      const monday = toIsoDate(mondayOf(parseIsoDate(meeting.meetsOn)));
      const note = noteOn.get(`${meeting.meetsOn}|${meeting.startsAt}`);
      byWeek.set(monday, [
        ...(byWeek.get(monday) ?? []),
        {
          crn: section.crn,
          courseCode: section.courseCode,
          group: section.group?.trim() ?? "",
          teacher: section.teacher,
          day: meeting.meetsOn,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          room: meeting.room,
          state: note?.kind ?? "",
          cover: note?.kind === "covered" ? note.coverTeacherName.trim() : "",
          note: note?.note.trim() ?? "",
        },
      ]);
    }
  }
  const mondays = [...byWeek.keys()].sort();
  if (!mondays.length) return [];
  const weeks: ScheduleWeek[] = [];
  for (let monday = mondays[0]; monday <= mondays[mondays.length - 1]; monday = plusDays(monday, 7)) {
    const classes = byWeek.get(monday) ?? [];
    const days = Array.from({ length: 6 }, (_, offset) => plusDays(monday, offset));
    const counted = input.weekOne ? weekNumber(parseIsoDate(monday), input.weekOne) : 0;
    weeks.push({
      monday,
      week: counted >= 1 ? counted : null,
      days: classes.some((entry) => entry.day === days[5]) ? days : days.slice(0, 5),
      classes: laidSideBySide(classes),
    });
  }
  return weeks;
}

/**
 * The hours every page shows: 08:00 to 18:00, as the calendar in the app, and wider where
 * a class starts earlier or ends later — the same on each page, so the weeks line up.
 */
export function hourRange(input: ScheduleInput): [number, number] {
  let first = 8;
  let last = 18;
  for (const meeting of input.sections.flatMap((section) => section.meetings)) {
    first = Math.min(first, Math.floor(minutesOf(meeting.startsAt) / 60));
    last = Math.max(last, Math.ceil(minutesOf(meeting.endsAt) / 60));
  }
  return [first, Math.max(first + 1, last)];
}

/**
 * What a box is called, as in the app. Every class of one course: its group, since the
 * course is in the heading — the course's own calendar. Several courses: the course.
 */
export function classLabel(entry: Pick<ScheduleClass, "courseCode" | "group" | "crn">, oneCourse: boolean): string {
  return (oneCourse && entry.group) || entry.courseCode || entry.crn;
}

/** "MATH-351-23436-schedule.pdf" for one; "schedule-4-CRNs.pdf" for several. */
export function scheduleFilename(input: Pick<ScheduleInput, "sections">): string {
  const [only] = input.sections;
  if (input.sections.length !== 1) return `schedule-${input.sections.length}-CRNs.pdf`;
  return `${[only.courseCode, only.crn].filter(Boolean).join("-").replace(/[^A-Za-z0-9-]+/g, "-")}-schedule.pdf`;
}

type Rgb = [number, number, number];
const LINE: Rgb = [228, 232, 239];
const HEADER: Rgb = [248, 250, 252];
const SOFT: Rgb = [102, 112, 133];
const FAINT: Rgb = [152, 162, 179];

function rgbOf(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

/** A colour moved towards white by `amount` — how the calendar fades and stripes, and its white text at part opacity. */
function towardsWhite([r, g, b]: Rgb, amount: number): Rgb {
  return [r, g, b].map((part) => Math.round(part + (255 - part) * amount)) as Rgb;
}

/** The part of a line from (x1, y1) to (x2, y2) inside a rectangle, or nothing. */
function clipped(x1: number, y1: number, x2: number, y2: number, box: { x: number; y: number; w: number; h: number }) {
  let low = 0;
  let high = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (const [p, q] of [
    [-dx, x1 - box.x],
    [dx, box.x + box.w - x1],
    [-dy, y1 - box.y],
    [dy, box.y + box.h - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return null;
  }
  return [x1 + low * dx, y1 + low * dy, x1 + high * dx, y1 + high * dy] as const;
}

/*
 * The app's icons, redrawn: Lucide's pin, person and repeat arrows on their 24-unit grid.
 * Each stroke is a start and a run of moves from it — a pair is a line, six numbers a
 * curve, both measured from where the stroke has got to, which is how the PDF draws.
 */
type Stroke = { from: [number, number]; moves: number[][] };
type Icon = { strokes: Stroke[]; circles: [number, number, number][] };
const ICONS: Record<"pin" | "person" | "cover", Icon> = {
  pin: {
    strokes: [
      {
        from: [12, 22],
        moves: [
          [-3, -2.5, -8, -7.5, -8, -12],
          [0, -4.4, 3.6, -8, 8, -8],
          [4.4, 0, 8, 3.6, 8, 8],
          [0, 4.5, -5, 9.5, -8, 12],
        ],
      },
    ],
    circles: [[12, 10, 3]],
  },
  person: {
    strokes: [{ from: [5, 21], moves: [[0, -2], [0, -2.2, 1.8, -4, 4, -4], [6, 0], [2.2, 0, 4, 1.8, 4, 4], [0, 2]] }],
    circles: [[12, 7, 4]],
  },
  cover: {
    strokes: [
      { from: [17, 2], moves: [[4, 4], [-4, 4]] },
      { from: [3, 11], moves: [[0, -1], [0, -2.2, 1.8, -4, 4, -4], [14, 0]] },
      { from: [7, 22], moves: [[-4, -4], [4, -4]] },
      { from: [21, 13], moves: [[0, 1], [0, 2.2, -1.8, 4, -4, 4], [-14, 0]] },
    ],
    circles: [],
  },
};

function drawIcon(doc: JsPdf, icon: keyof typeof ICONS, x: number, y: number, size: number, color: Rgb) {
  const scale = size / 24;
  doc.setDrawColor(...color);
  doc.setLineWidth(2 * scale);
  doc.setLineCap("round");
  doc.setLineJoin("round");
  for (const stroke of ICONS[icon].strokes) {
    doc.lines(stroke.moves, x + stroke.from[0] * scale, y + stroke.from[1] * scale, [scale, scale], "S", false);
  }
  for (const [cx, cy, r] of ICONS[icon].circles) doc.circle(x + cx * scale, y + cy * scale, r * scale, "S");
  doc.setLineCap("butt");
  doc.setLineJoin("miter");
}

/** As much of the words as fits, cut with an ellipsis as the app cuts a box's line. */
function fitted(doc: JsPdf, text: string, width: number): string {
  if (doc.getTextWidth(text) <= width) return text;
  let cut = text;
  while (cut.length > 1 && doc.getTextWidth(`${cut}…`) > width) cut = cut.slice(0, -1);
  return `${cut.replace(/[\s·]+$/, "")}…`;
}

/** One line of a class's box: its words, and what it is drawn with. */
type BoxLine = { text: string; size: number; bold?: boolean; icon?: keyof typeof ICONS; ink: Rgb; strike?: boolean; keep: number };

export async function buildSchedulePdf(input: ScheduleInput, today = new Date()): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageWidth - 40;
  const gutter = 38;
  const bottom = pageHeight - 46;
  const one = input.sections.length === 1 ? input.sections[0] : null;
  const oneCourse = new Set(input.sections.map((section) => section.courseCode)).size === 1;
  // A colour per CRN, the calendar's own; one CRN alone is the calendar's first, navy.
  const colorOf = new Map(input.sections.map((section, index) => [section.crn, rgbOf(COURSE_COLORS[index % COURSE_COLORS.length])]));

  /*
   * The legend, for several CRNs: a swatch and a line each, laid in columns across the
   * page. Measured once, since every page carries it and the grid starts below it.
   */
  const legendColumns = 3;
  const legendRows = one ? 0 : Math.ceil(input.sections.length / legendColumns);
  const legendTop = 84;
  const subtitleY = legendTop + legendRows * 13 + (one ? 6 : 14);
  const headTop = subtitleY + 12;
  const top = headTop + 30;
  const [firstHour, lastHour] = hourRange(input);
  const hourHeight = (bottom - top) / (lastHour - firstHour);
  const yOf = (time: string) => top + ((minutesOf(time) - firstHour * 60) / 60) * hourHeight;
  const weeks = scheduleWeeks(input);

  const heading = (subtitle: string) => {
    doc.setTextColor(23);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(
      one
        ? `${one.courseCode}${one.title ? ` · ${one.title}` : ""}`
        : oneCourse
          ? `${input.sections[0].courseCode} · ${input.sections.length} CRNs`
          : `${input.sections.length} CRNs`,
      left,
      50,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...SOFT);
    doc.text(
      (one ? [`CRN ${one.crn}`, one.group, input.semester, one.teacher] : [input.semester]).filter(Boolean).join("   ·   "),
      left,
      68,
    );
    if (!one) {
      const columnWidth = (right - left) / legendColumns;
      input.sections.forEach((section, index) => {
        const x = left + (index % legendColumns) * columnWidth;
        const y = legendTop + Math.floor(index / legendColumns) * 13;
        doc.setFillColor(...(colorOf.get(section.crn) ?? rgbOf(COURSE_COLORS[0])));
        doc.roundedRect(x, y - 7, 9, 9, 1.5, 1.5, "F");
        doc.setFontSize(8.5);
        doc.setTextColor(52, 64, 84);
        // The teacher before the title: when a line has to be cut, the course's name is the part to lose.
        const words = [`${section.courseCode} · ${section.crn}`, section.group, section.teacher, section.title].filter(Boolean).join(" · ");
        doc.text(fitted(doc, words, columnWidth - 18), x + 14, y);
      });
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(31, 78, 121);
    doc.text(subtitle, left, subtitleY);
  };

  if (!weeks.length) heading("The portal has booked no classes for these CRNs.");

  weeks.forEach((week, index) => {
    if (index > 0) doc.addPage();
    const last = week.days[week.days.length - 1];
    heading(`${week.week ? `Week ${week.week}   ·   ` : ""}${shortDay(week.monday)} – ${shortDay(last)} ${parseIsoDate(last).getFullYear()}`);

    const columnWidth = (right - left - gutter) / week.days.length;
    const columnX = (column: number) => left + gutter + column * columnWidth;
    const gridBottom = top + (lastHour - firstHour) * hourHeight;

    // The frame and the day band across its top, as the calendar has them.
    doc.setFillColor(...HEADER);
    doc.rect(left, headTop, right - left, top - headTop, "F");
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.roundedRect(left, headTop, right - left, gridBottom - headTop, 4, 4, "S");
    doc.line(left, top, right, top);
    doc.line(left + gutter, headTop, left + gutter, gridBottom);

    // The hours down the side, and a rule across for each.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setLineWidth(0.5);
    for (let hour = firstHour; hour < lastHour; hour += 1) {
      const y = top + (hour - firstHour) * hourHeight;
      doc.setDrawColor(...LINE);
      if (hour > firstHour) doc.line(left + gutter, y, right, y);
      doc.setTextColor(...FAINT);
      doc.text(`${String(hour).padStart(2, "0")}:00`, left + gutter - 6, y + 9, { align: "right" });
    }
    // A column per day, headed with its name and date.
    week.days.forEach((day, column) => {
      const x = columnX(column);
      if (column > 0) {
        doc.setDrawColor(...LINE);
        doc.line(x, headTop, x, gridBottom);
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(52, 64, 84);
      doc.text(DAYS[parseIsoDate(day).getDay()], x + columnWidth / 2, headTop + 13, { align: "center" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...FAINT);
      doc.text(shortDay(day), x + columnWidth / 2, headTop + 24, { align: "center" });
    });

    for (const entry of week.classes) {
      const column = week.days.indexOf(entry.day);
      if (column < 0) continue;
      const laneWidth = columnWidth / entry.lanes;
      const box = {
        x: columnX(column) + entry.lane * laneWidth + 2.5,
        y: yOf(entry.startsAt) + 1,
        w: laneWidth - 5,
        h: Math.max(14, yOf(entry.endsAt) - yOf(entry.startsAt) - 2),
      };
      const color = colorOf.get(entry.crn) ?? rgbOf(COURSE_COLORS[0]);
      const cancelled = entry.state === "cancelled";
      const covered = entry.state === "covered";
      // Faded as the calendar fades it: the box at a little over half its colour.
      const fill = cancelled ? towardsWhite(color, 0.45) : color;
      const ink = (opacity: number): Rgb => (cancelled ? [255, 255, 255] : towardsWhite(fill, opacity));
      doc.setFillColor(...fill);
      doc.roundedRect(box.x, box.y, box.w, box.h, 3, 3, "F");
      if (covered) {
        // Stripes, and a pale edge inside, as on screen: still the class, plainly not the usual one.
        // Held inside the box's own rounded edge, so no stripe's end pokes out past it.
        doc.saveGraphicsState();
        doc.roundedRect(box.x, box.y, box.w, box.h, 3, 3, null);
        doc.clip();
        doc.discardPath();
        doc.setDrawColor(...towardsWhite(color, 0.26));
        doc.setLineWidth(2.4);
        for (let offset = -box.h; offset < box.w; offset += 9) {
          const part = clipped(box.x + offset, box.y + box.h, box.x + offset + box.h, box.y, box);
          if (part) doc.line(...part);
        }
        doc.restoreGraphicsState();
        doc.setDrawColor(...towardsWhite(color, 0.7));
        doc.setLineWidth(1.2);
        doc.roundedRect(box.x + 0.6, box.y + 0.6, box.w - 1.2, box.h - 1.2, 2.6, 2.6, "S");
      }

      /*
       * What fits, from the top down, as in the app: the name, the hours, the room, the
       * group and CRN, the teacher — who covered it, for a covered class, which outranks
       * the group — and then the note, which the app keeps for its tooltip and a page has
       * nowhere else to put. A line that does not fit is dropped rather than cut in half.
       */
      const lines: BoxLine[] = [
        { text: classLabel(entry, oneCourse), size: 8.5, bold: true, ink: [255, 255, 255] as Rgb, strike: cancelled, keep: 0 },
        { text: `${entry.startsAt}–${entry.endsAt}`, size: 8, ink: ink(0.9), keep: 1 },
        { text: formatRoom(entry.room), size: 8, icon: "pin" as const, ink: ink(0.85), keep: 2 },
        { text: [entry.group, `CRN ${entry.crn}`].filter(Boolean).join(" · "), size: 7, ink: ink(0.8), keep: 4 },
        covered
          ? { text: entry.cover || "somebody else", size: 8, bold: true, icon: "cover" as const, ink: [255, 255, 255] as Rgb, keep: 3 }
          : { text: entry.teacher, size: 8, icon: "person" as const, ink: ink(0.85), keep: 5 },
        { text: entry.note, size: 7, ink: ink(0.85), keep: 6 },
      ].filter((line) => line.text);
      const kept = new Set<BoxLine>();
      let used = 0;
      for (const line of [...lines].sort((a, b) => a.keep - b.keep)) {
        if (kept.size && used + line.size + 3 > box.h - 7) break;
        kept.add(line);
        used += line.size + 3;
      }

      // The top line carries its word on the right: CANCELLED or COVERED, or the hour when it stands alone.
      const flag = cancelled ? "CANCELLED" : covered ? "COVERED" : kept.size === 1 ? entry.startsAt : "";
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      const flagWidth = flag ? doc.getTextWidth(flag) + (entry.state ? 5 : 0) : 0;
      let y = box.y + 4;
      for (const line of lines.filter((held) => kept.has(held))) {
        y += line.size;
        const indent = line.icon ? line.size + 2.5 : 0;
        const width = box.w - 9 - indent - (line.keep === 0 && flag ? flagWidth + 4 : 0);
        doc.setFont("helvetica", line.bold ? "bold" : "normal");
        doc.setFontSize(line.size);
        doc.setTextColor(...line.ink);
        const text = fitted(doc, line.text, Math.max(8, width));
        if (line.icon) drawIcon(doc, line.icon, box.x + 4.5, y - line.size * 0.82, line.size * 0.9, line.ink);
        doc.text(text, box.x + 4.5 + indent, y);
        if (line.strike) {
          doc.setDrawColor(...line.ink);
          doc.setLineWidth(0.7);
          doc.line(box.x + 4.5, y - line.size * 0.3, box.x + 4.5 + doc.getTextWidth(text), y - line.size * 0.3);
        }
        if (line.keep === 0 && flag) {
          if (entry.state) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(6);
            doc.setFillColor(...towardsWhite(fill, 0.28));
            doc.roundedRect(box.x + box.w - 4.5 - flagWidth, y - 6.5, flagWidth, 8, 1.5, 1.5, "F");
            doc.setTextColor(255);
            doc.text(flag, box.x + box.w - 4.5 - flagWidth / 2, y - 0.6, { align: "center" });
          } else {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(7.5);
            doc.setTextColor(...ink(0.85));
            doc.text(flag, box.x + box.w - 4.5, y, { align: "right" });
          }
        }
        y += 3;
      }
    }
  });

  const pages = doc.getNumberOfPages();
  const swept = input.sweptAt ? `, as the portal's timetable stood on ${dayWords(input.sweptAt.slice(0, 10))}` : "";
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Exported ${dayWords(toIsoDate(today))} from Academic Coordinator Tools${swept}.`, left, pageHeight - 22);
    doc.text(`Page ${page} of ${pages}`, right, pageHeight - 22, { align: "right" });
  }
  return doc.output("arraybuffer");
}

/** Build it and hand it to the browser as a download. */
export async function downloadSchedulePdf(input: ScheduleInput): Promise<void> {
  const blob = new Blob([await buildSchedulePdf(input)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = scheduleFilename(input);
  link.click();
  URL.revokeObjectURL(url);
}
