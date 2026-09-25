/**
 * One CRN's schedule as a PDF: the record's week grid, one page per teaching week.
 *
 * Asked for from a CRN's record, to hand to a teacher or pin up. Drawn like the record's
 * calendar — days across, hours down, the class where it sits — because that is the shape
 * people read a timetable in; a list of dates had to be turned back into a week in the
 * reader's head. A cancelled class is faded and struck through, a covered one striped
 * and says who covered it, as on screen.
 *
 * Built in the browser from what the record has already read: the portal's dated meetings
 * and the department's notes on them. It holds no student names.
 */

import { MONTH_NAMES, minutesOf, mondayOf, parseIsoDate, toIsoDate, weekNumber } from "@/services/weekSchedule";

export type ScheduleMeeting = { meetsOn: string; startsAt: string; endsAt: string; room: string };
export type ScheduleNote = { meetsOn: string; startsAt: string; kind: "cancelled" | "covered"; coverTeacherName: string; note: string };

export type ScheduleInput = {
  crn: string;
  courseCode: string;
  title: string;
  semester: string;
  teacher: string;
  meetings: ScheduleMeeting[];
  notes: ScheduleNote[];
  /** Any day of the semester's first teaching week, when Settings → Semesters has one. */
  weekOne?: string;
  /** When the portal's timetable was last swept, ISO. */
  sweptAt?: string;
};

/** One class on the page, and what happened to it. */
export type ScheduleClass = {
  day: string;
  startsAt: string;
  endsAt: string;
  room: string;
  state: "" | "cancelled" | "covered";
  /** Who covered it, for a covered class. */
  cover: string;
  note: string;
};

/** One page: a week that has a class in it. */
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

/**
 * The pages: every week with a class in it, in order. A week with none — a break — has no
 * page; its number is simply missing from the headings, which is how the gap reads.
 */
export function scheduleWeeks(input: ScheduleInput): ScheduleWeek[] {
  const noteOn = new Map(input.notes.map((note) => [`${note.meetsOn}|${note.startsAt}`, note]));
  const byWeek = new Map<string, ScheduleClass[]>();
  for (const meeting of input.meetings) {
    const monday = toIsoDate(mondayOf(parseIsoDate(meeting.meetsOn)));
    const note = noteOn.get(`${meeting.meetsOn}|${meeting.startsAt}`);
    const held = byWeek.get(monday) ?? [];
    held.push({
      day: meeting.meetsOn,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      room: meeting.room,
      state: note?.kind ?? "",
      cover: note?.kind === "covered" ? note.coverTeacherName.trim() : "",
      note: note?.note.trim() ?? "",
    });
    byWeek.set(monday, held);
  }
  return [...byWeek.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monday, classes]) => {
      const start = parseIsoDate(monday);
      const days = Array.from({ length: 6 }, (_, offset) => toIsoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)));
      const counted = input.weekOne ? weekNumber(start, input.weekOne) : 0;
      return {
        monday,
        week: counted >= 1 ? counted : null,
        days: classes.some((entry) => entry.day === days[5]) ? days : days.slice(0, 5),
        classes: classes.sort((left, right) => `${left.day}${left.startsAt}`.localeCompare(`${right.day}${right.startsAt}`)),
      };
    });
}

/** The hours every page shows, the same on each so the weeks can be laid side by side. */
export function hourRange(input: ScheduleInput): [number, number] {
  if (!input.meetings.length) return [8, 17];
  const first = Math.min(...input.meetings.map((meeting) => minutesOf(meeting.startsAt)));
  const last = Math.max(...input.meetings.map((meeting) => minutesOf(meeting.endsAt)));
  return [Math.floor(first / 60), Math.max(Math.floor(first / 60) + 1, Math.ceil(last / 60))];
}

/** "MATH-351-23436-schedule.pdf". */
export function scheduleFilename(input: Pick<ScheduleInput, "crn" | "courseCode">): string {
  return `${[input.courseCode, input.crn].filter(Boolean).join("-").replace(/[^A-Za-z0-9-]+/g, "-")}-schedule.pdf`;
}

type Rgb = [number, number, number];
const NAVY: Rgb = [31, 78, 121];
const FADED: Rgb = [165, 184, 201];
const LINE: Rgb = [228, 232, 239];
const SOFT: Rgb = [102, 112, 133];

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

export async function buildSchedulePdf(input: ScheduleInput, today = new Date()): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageWidth - 40;
  const gutter = 36;
  const top = 118;
  const bottom = pageHeight - 52;
  const [firstHour, lastHour] = hourRange(input);
  const hourHeight = Math.min(80, (bottom - top) / (lastHour - firstHour));
  const yOf = (time: string) => top + ((minutesOf(time) - firstHour * 60) / 60) * hourHeight;
  const weeks = scheduleWeeks(input);

  const heading = (subtitle: string) => {
    doc.setTextColor(23);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`${input.courseCode}${input.title ? ` · ${input.title}` : ""}`, left, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...SOFT);
    doc.text([`CRN ${input.crn}`, input.semester, input.teacher].filter(Boolean).join("   ·   "), left, 68);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text(subtitle, left, 90);
  };

  if (!weeks.length) {
    heading("The portal has booked no classes for this CRN.");
  }

  weeks.forEach((week, index) => {
    if (index > 0) doc.addPage();
    const last = week.days[week.days.length - 1];
    heading(`${week.week ? `Week ${week.week}   ·   ` : ""}${shortDay(week.monday)} – ${shortDay(last)} ${parseIsoDate(last).getFullYear()}`);

    const columnWidth = (right - left - gutter) / week.days.length;
    const columnX = (column: number) => left + gutter + column * columnWidth;

    // The hours down the side, and a rule across for each.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const y = top + (hour - firstHour) * hourHeight;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(left + gutter, y, right, y);
      doc.setTextColor(...SOFT);
      doc.text(`${String(hour).padStart(2, "0")}:00`, left + gutter - 6, y + 3, { align: "right" });
    }
    // A column per day, headed with its date.
    week.days.forEach((day, column) => {
      const x = columnX(column);
      doc.setDrawColor(...LINE);
      doc.line(x, top, x, top + (lastHour - firstHour) * hourHeight);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(52, 64, 84);
      doc.text(`${DAYS[parseIsoDate(day).getDay()]} ${shortDay(day)}`, x + columnWidth / 2, top - 8, { align: "center" });
    });
    doc.line(right, top, right, top + (lastHour - firstHour) * hourHeight);

    for (const entry of week.classes) {
      const column = week.days.indexOf(entry.day);
      if (column < 0) continue;
      const box = { x: columnX(column) + 2, y: yOf(entry.startsAt) + 1, w: columnWidth - 4, h: Math.max(14, yOf(entry.endsAt) - yOf(entry.startsAt) - 2) };
      const cancelled = entry.state === "cancelled";
      doc.setFillColor(...(cancelled ? FADED : NAVY));
      doc.roundedRect(box.x, box.y, box.w, box.h, 3, 3, "F");
      if (entry.state === "covered") {
        // Stripes, as on screen: the class is still the class, and plainly not the usual one.
        doc.setDrawColor(76, 112, 146);
        doc.setLineWidth(1.4);
        for (let offset = -box.h; offset < box.w; offset += 9) {
          const part = clipped(box.x + offset, box.y + box.h, box.x + offset + box.h, box.y, box);
          if (part) doc.line(...part);
        }
      }
      const lines = [
        { text: input.courseCode, bold: true },
        { text: `${entry.startsAt}–${entry.endsAt}`, bold: false },
        { text: entry.room || "", bold: false },
        {
          text: cancelled ? "CANCELLED" : entry.state === "covered" ? `Covered by ${entry.cover || "somebody else"}` : input.teacher,
          bold: entry.state !== "",
        },
        { text: entry.note, bold: false },
      ].filter((line) => line.text);
      doc.setTextColor(255);
      doc.setFontSize(8);
      let y = box.y + 10;
      for (const line of lines) {
        if (y > box.y + box.h - 3) break;
        doc.setFont("helvetica", line.bold ? "bold" : "normal");
        const text = doc.splitTextToSize(line.text, box.w - 8)[0] ?? "";
        doc.text(text, box.x + 4, y);
        if (cancelled && line === lines[0]) {
          doc.setDrawColor(255);
          doc.setLineWidth(0.7);
          doc.line(box.x + 4, y - 2.5, box.x + 4 + doc.getTextWidth(text), y - 2.5);
        }
        y += 10;
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
    doc.text(`Exported ${dayWords(toIsoDate(today))} from Academic Coordinator Tools${swept}.`, left, pageHeight - 24);
    doc.text(`Page ${page} of ${pages}`, right, pageHeight - 24, { align: "right" });
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
