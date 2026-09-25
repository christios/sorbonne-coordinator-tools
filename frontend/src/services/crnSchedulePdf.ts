/**
 * CRN schedules as a PDF: the record's week grid, one page per teaching week.
 *
 * One CRN from its record, or several ticked on Active CRNs and drawn on the same grid — a
 * group's week, or a teacher's. Drawn like the record's calendar — days across, hours down,
 * the class where it sits — because that is the shape people read a timetable in. Each CRN
 * has its colour and a line in the legend; two that meet at the same hour sit side by side.
 * A cancelled class is faded and struck through, a covered one striped and says who
 * covered it, as on screen.
 *
 * Built in the browser from the portal's dated meetings and the department's notes on
 * them. It holds no student names.
 */

import { COURSE_COLORS, MONTH_NAMES, minutesOf, mondayOf, parseIsoDate, toIsoDate, weekNumber } from "@/services/weekSchedule";

export type ScheduleMeeting = { meetsOn: string; startsAt: string; endsAt: string; room: string };
export type ScheduleNote = { meetsOn: string; startsAt: string; kind: "cancelled" | "covered"; coverTeacherName: string; note: string };

/** One CRN: what it is, who teaches it, and every meeting the portal has for it. */
export type ScheduleSection = {
  crn: string;
  courseCode: string;
  title: string;
  teacher: string;
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
 * The pages: every week with a class in it, in order. A week with none — a break — has no
 * page; its number is simply missing from the headings, which is how the gap reads.
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
  return [...byWeek.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monday, classes]) => {
      const start = parseIsoDate(monday);
      const days = Array.from({ length: 6 }, (_, offset) =>
        toIsoDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset)),
      );
      const counted = input.weekOne ? weekNumber(start, input.weekOne) : 0;
      return {
        monday,
        week: counted >= 1 ? counted : null,
        days: classes.some((entry) => entry.day === days[5]) ? days : days.slice(0, 5),
        classes: laidSideBySide(classes),
      };
    });
}

/** The hours every page shows, the same on each so the weeks can be laid side by side. */
export function hourRange(input: ScheduleInput): [number, number] {
  const meetings = input.sections.flatMap((section) => section.meetings);
  if (!meetings.length) return [8, 17];
  const first = Math.min(...meetings.map((meeting) => minutesOf(meeting.startsAt)));
  const last = Math.max(...meetings.map((meeting) => minutesOf(meeting.endsAt)));
  return [Math.floor(first / 60), Math.max(Math.floor(first / 60) + 1, Math.ceil(last / 60))];
}

/** "MATH-351-23436-schedule.pdf" for one; "schedule-4-CRNs.pdf" for several. */
export function scheduleFilename(input: Pick<ScheduleInput, "sections">): string {
  const [only] = input.sections;
  if (input.sections.length !== 1) return `schedule-${input.sections.length}-CRNs.pdf`;
  return `${[only.courseCode, only.crn].filter(Boolean).join("-").replace(/[^A-Za-z0-9-]+/g, "-")}-schedule.pdf`;
}

type Rgb = [number, number, number];
const LINE: Rgb = [228, 232, 239];
const SOFT: Rgb = [102, 112, 133];

function rgbOf(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

/** A colour moved towards white by `amount` — how the calendar fades and stripes. */
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

export async function buildSchedulePdf(input: ScheduleInput, today = new Date()): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 40;
  const right = pageWidth - 40;
  const gutter = 36;
  const bottom = pageHeight - 52;
  const one = input.sections.length === 1 ? input.sections[0] : null;
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
  const top = subtitleY + 28;
  const [firstHour, lastHour] = hourRange(input);
  const hourHeight = Math.min(80, (bottom - top) / (lastHour - firstHour));
  const yOf = (time: string) => top + ((minutesOf(time) - firstHour * 60) / 60) * hourHeight;
  const weeks = scheduleWeeks(input);

  const heading = (subtitle: string) => {
    doc.setTextColor(23);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(
      one ? `${one.courseCode}${one.title ? ` · ${one.title}` : ""}` : `${input.sections.length} CRNs`,
      left,
      50,
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...SOFT);
    doc.text(
      (one ? [`CRN ${one.crn}`, input.semester, one.teacher] : [input.semester]).filter(Boolean).join("   ·   "),
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
        const words = [`${section.courseCode} · ${section.crn}`, section.teacher, section.title].filter(Boolean).join(" · ");
        doc.text(doc.splitTextToSize(words, columnWidth - 18)[0] ?? "", x + 14, y);
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

    // The hours down the side, and a rule across for each.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setLineWidth(0.5);
    for (let hour = firstHour; hour <= lastHour; hour += 1) {
      const y = top + (hour - firstHour) * hourHeight;
      doc.setDrawColor(...LINE);
      doc.line(left + gutter, y, right, y);
      doc.setTextColor(...SOFT);
      doc.text(`${String(hour).padStart(2, "0")}:00`, left + gutter - 6, y + 3, { align: "right" });
    }
    // A column per day, headed with its date.
    week.days.forEach((day, column) => {
      const x = columnX(column);
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.5);
      doc.line(x, top, x, gridBottom);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(52, 64, 84);
      doc.text(`${DAYS[parseIsoDate(day).getDay()]} ${shortDay(day)}`, x + columnWidth / 2, top - 8, { align: "center" });
    });
    doc.line(right, top, right, gridBottom);

    for (const entry of week.classes) {
      const column = week.days.indexOf(entry.day);
      if (column < 0) continue;
      const laneWidth = columnWidth / entry.lanes;
      const box = {
        x: columnX(column) + entry.lane * laneWidth + 2,
        y: yOf(entry.startsAt) + 1,
        w: laneWidth - 4,
        h: Math.max(14, yOf(entry.endsAt) - yOf(entry.startsAt) - 2),
      };
      const color = colorOf.get(entry.crn) ?? rgbOf(COURSE_COLORS[0]);
      const cancelled = entry.state === "cancelled";
      doc.setFillColor(...(cancelled ? towardsWhite(color, 0.55) : color));
      doc.roundedRect(box.x, box.y, box.w, box.h, 3, 3, "F");
      if (entry.state === "covered") {
        // Stripes, as on screen: the class is still the class, and plainly not the usual one.
        doc.setDrawColor(...towardsWhite(color, 0.25));
        doc.setLineWidth(1.4);
        for (let offset = -box.h; offset < box.w; offset += 9) {
          const part = clipped(box.x + offset, box.y + box.h, box.x + offset + box.h, box.y, box);
          if (part) doc.line(...part);
        }
      }
      const lines = [
        { text: one ? entry.courseCode : `${entry.courseCode} · ${entry.crn}`, bold: true },
        { text: `${entry.startsAt}–${entry.endsAt}`, bold: false },
        { text: entry.room, bold: false },
        {
          text: cancelled ? "CANCELLED" : entry.state === "covered" ? `Covered by ${entry.cover || "somebody else"}` : entry.teacher,
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
        const text = doc.splitTextToSize(line.text, Math.max(8, box.w - 8))[0] ?? "";
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
