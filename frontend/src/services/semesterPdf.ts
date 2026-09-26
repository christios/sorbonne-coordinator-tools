/**
 * A whole semester's timetable as a PDF, drawn the way the Timetable and Rooms pages draw it.
 *
 * Hours across the page, and down the side the days of each week — or the rooms. Classes
 * that overlap stack downwards, so a busy day is a taller day and nothing is narrowed by a
 * neighbour. Every week of the semester gets its pages, from the first class to the last;
 * a week with none keeps its page, drawn empty, as the CRN schedules do.
 *
 * How large it is drawn is the reader's choice, as on screen: how many pages wide a week
 * is, and how tall a class is. Wider or taller means more pages, and the export says how
 * many before it makes them — the same layout drives the preview and the file, so what the
 * preview shows is what prints.
 *
 * Built in the browser from the portal's dated meetings and the department's notes on
 * them. It holds no student names.
 */

import type { jsPDF as JsPdf } from "jspdf";

import { drawIcon, fitted, rgbOf, towardsWhite, type Rgb, type ScheduleSection } from "@/services/crnSchedulePdf";
import {
  DAY_NAMES,
  MONTH_NAMES,
  assignColors,
  formatRoom,
  laneOut,
  minutesOf,
  mondayOf,
  parseIsoDate,
  toIsoDate,
  weekNumber,
} from "@/services/weekSchedule";

/** Days down the side (the Timetable page), or rooms: a week along each row, or one day. */
export type SemesterLayout = "days" | "rooms-week" | "rooms-day";
export type PaperSize = "a4" | "a3";
/** The two zooms: how many pages wide a week is, and how tall one class is, in points. */
export type ExportZoom = { paper: PaperSize; across: number; classHeight: number };

export const PAPER: Record<PaperSize, { width: number; height: number; name: string }> = {
  a4: { width: 841.89, height: 595.28, name: "A4" },
  a3: { width: 1190.55, height: 841.89, name: "A3" },
};
export const ACROSS = { min: 1, max: 4 };
export const CLASS_HEIGHT = { min: 10, max: 40, start: 16 };

export type SemesterExportInput = {
  semester: string;
  layout: SemesterLayout;
  /** In the order the page lists them, so each course keeps the colour it has on screen. */
  sections: ScheduleSection[];
  weekOne?: string;
  sweptAt?: string;
};

/** One class, as the export draws it. */
type Klass = {
  crn: string;
  courseCode: string;
  group: string;
  teacher: string;
  date: string;
  start: string;
  end: string;
  room: string;
  state: "" | "cancelled" | "covered";
  cover: string;
};

/** A stretch of the semester that is drawn as a unit: a week, or one day of rooms. */
type Unit = {
  /** "Week 5 · 28 Sep – 2 Oct 2026". */
  title: string;
  /** The days across the page, when a room's week runs along its row; one entry otherwise. */
  bands: (string | null)[];
  rows: { label: string; sub: string; boxes: { klass: Klass; lane: number; band: number }[]; lanes: number }[];
};

/** A class's box on one page, in points from the page's corner. */
export type PageBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  klass: Klass;
  /** Cut by the page's edge: the class runs on over the page before or after. */
  cutLeft: boolean;
  cutRight: boolean;
};

/** One page, laid out: everything either renderer needs, in points. */
export type SemesterPage = {
  /** Which unit it belongs to, and where it sits among that unit's pages. */
  unit: number;
  title: string;
  /** "Mon – Wed · 08:00–13:00", or "" for a unit on a single page. */
  part: string;
  column: number;
  line: number;
  gridTop: number;
  gridBottom: number;
  /** Where the day names go, over their stretch of this page, when a room's week is drawn. */
  days: { x: number; w: number; label: string }[];
  ticks: { x: number; weight: "hour" | "half" | "quarter" }[];
  hours: { x: number; label: string }[];
  /** Where one day of the week ends and the next begins. */
  seams: number[];
  rows: { y: number; h: number; label: string; sub: string }[];
  boxes: PageBox[];
};

/** Where things go on a sheet: the margins, the heading and the column of labels. */
export function frameOf(paper: PaperSize, layout: SemesterLayout) {
  const { width, height } = PAPER[paper];
  const left = 28;
  const right = width - 28;
  const rooms = layout !== "days";
  const gridTop = 58;
  const daysHeight = layout === "rooms-week" ? 14 : 0;
  const hoursHeight = 15;
  const labelWidth = rooms ? 78 : 56;
  return {
    width,
    height,
    left,
    right,
    gridTop,
    daysHeight,
    hoursHeight,
    contentTop: gridTop + daysHeight + hoursHeight,
    bottom: height - 30,
    labelWidth,
    // A row is never shorter than its label: two lines for a day, one for a room.
    labelHeight: rooms ? 13 : 24,
  };
}

function plusDays(iso: string, days: number): string {
  const day = parseIsoDate(iso);
  return toIsoDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days));
}

function shortDay(iso: string): string {
  const day = parseIsoDate(iso);
  return `${day.getDate()} ${MONTH_NAMES[day.getMonth()]}`;
}

/** "Mon 28". */
function dayName(iso: string): string {
  const day = parseIsoDate(iso);
  return `${DAY_NAMES[day.getDay()]} ${day.getDate()}`;
}

const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const roomOf = (klass: { room: string }) => formatRoom(klass.room).trim();
const count = (classes: number) => (classes === 0 ? "—" : `${classes} class${classes === 1 ? "" : "es"}`);

/** Every class of the semester, with what the department has said about it. */
function classesOf(input: SemesterExportInput): Klass[] {
  return input.sections.flatMap((section) => {
    const noteOn = new Map(section.notes.map((note) => [`${note.meetsOn}|${note.startsAt.slice(0, 5)}`, note]));
    return section.meetings.map((meeting) => {
      const note = noteOn.get(`${meeting.meetsOn}|${meeting.startsAt.slice(0, 5)}`);
      return {
        crn: section.crn,
        courseCode: section.courseCode,
        group: section.group?.trim() ?? "",
        teacher: section.teacher,
        date: meeting.meetsOn,
        start: meeting.startsAt.slice(0, 5),
        end: meeting.endsAt.slice(0, 5),
        room: meeting.room,
        state: note?.kind ?? "",
        cover: note?.kind === "covered" ? note.coverTeacherName.trim() : "",
      };
    });
  });
}

/** The hours every page shows: 08:00 to 18:00 at least, the same all semester. */
function hoursOf(classes: Klass[]): [number, number] {
  let first = 8 * 60;
  let last = 18 * 60;
  for (const klass of classes) {
    first = Math.min(first, Math.floor(minutesOf(klass.start) / 60) * 60);
    last = Math.max(last, Math.ceil(minutesOf(klass.end) / 60) * 60);
  }
  return [first, Math.max(first + 60, last)];
}

/** Stack a row's classes, band by band, as the page does. */
function stacked(classes: Klass[], bands: (string | null)[]) {
  const boxes = bands.flatMap((band, index) =>
    laneOut(
      (band === null ? classes : classes.filter((klass) => klass.date === band)).map((klass) => ({ ...klass, klass })),
    ).map(({ session, lane }) => ({ klass: session.klass, lane, band: index })),
  );
  return { boxes, lanes: Math.max(1, boxes.reduce((most, { lane }) => Math.max(most, lane + 1), 0)) };
}

/** The weeks — or the days, for a room's day — from the first class to the last, empty ones kept. */
export function semesterUnits(input: SemesterExportInput): Unit[] {
  const classes = classesOf(input);
  if (!classes.length) return [];
  const dates = classes.map((klass) => klass.date).sort();
  const firstMonday = toIsoDate(mondayOf(parseIsoDate(dates[0])));
  const lastDate = dates[dates.length - 1];
  const rooms = [...new Set(classes.map(roomOf))].sort((a, b) =>
    a ? (b ? a.localeCompare(b, undefined, { numeric: true }) : -1) : 1,
  );
  const units: Unit[] = [];
  for (let monday = firstMonday; monday <= lastDate; monday = plusDays(monday, 7)) {
    const all = Array.from({ length: 6 }, (_, offset) => plusDays(monday, offset));
    const inWeek = classes.filter((klass) => klass.date >= all[0] && klass.date <= all[5]);
    const days = inWeek.some((klass) => klass.date === all[5]) ? all : all.slice(0, 5);
    const counted = input.weekOne ? weekNumber(parseIsoDate(monday), input.weekOne) : 0;
    const week = `${counted >= 1 ? `Week ${counted} · ` : ""}${shortDay(days[0])} – ${shortDay(days[days.length - 1])} ${parseIsoDate(days[days.length - 1]).getFullYear()}`;
    const roomRow = (room: string, among: Klass[], bands: (string | null)[]) => {
      const here = among.filter((klass) => roomOf(klass) === room);
      return { label: room || "No room", sub: here.length ? String(here.length) : "—", ...stacked(here, bands) };
    };
    if (input.layout === "days") {
      units.push({
        title: week,
        bands: [null],
        rows: days.map((day) => {
          const here = inWeek.filter((klass) => klass.date === day);
          return { label: dayName(day), sub: count(here.length), ...stacked(here, [null]) };
        }),
      });
    } else if (input.layout === "rooms-week") {
      units.push({ title: week, bands: days, rows: rooms.map((room) => roomRow(room, inWeek, days)) });
    } else {
      for (const day of days) {
        if (day > lastDate) break;
        const onDay = inWeek.filter((klass) => klass.date === day);
        const when = parseIsoDate(day);
        units.push({
          title: `${counted >= 1 ? `Week ${counted} · ` : ""}${DAY_NAMES[when.getDay()]} ${shortDay(day)} ${when.getFullYear()}`,
          bands: [day],
          rows: rooms.map((room) => roomRow(room, onDay, [day])),
        });
      }
    }
  }
  return units;
}

/**
 * Every page of the export, laid out.
 *
 * A unit is cut both ways. Across, into `across` pages that each carry a stretch of the
 * hours, the labels repeated on each so a page can be read on its own. Down, as its rows
 * run past the foot of the sheet: a row moves whole to the next page when it can, and only
 * one taller than a whole page is cut, between two of its stacked classes.
 */
export function semesterPages(input: SemesterExportInput, zoom: ExportZoom, units = semesterUnits(input)): SemesterPage[] {
  const frame = frameOf(zoom.paper, input.layout);
  const classes = units.flatMap((unit) => unit.rows.flatMap((row) => row.boxes.map((box) => box.klass)));
  const [startMinute, endMinute] = hoursOf(classes);
  const colors = assignColors(input.sections.map((section) => section.courseCode));
  const across = Math.min(ACROSS.max, Math.max(ACROSS.min, Math.round(zoom.across)));
  const classHeight = zoom.classHeight;
  const sliceWidth = frame.right - frame.left - frame.labelWidth;
  const available = frame.bottom - frame.contentTop;
  const pages: SemesterPage[] = [];

  units.forEach((unit, unitIndex) => {
    /*
     * Where the pages cut, chosen so each page starts somewhere you can name: on the hour
     * when the hours run across, at midnight when the days of a room's week do. A cut at
     * 13:30 is a page nobody can find the afternoon on.
     *
     * So the last page can run past the day's last hour, or hold fewer days than the
     * others, and a room's week asked to be four pages wide may take three: five days fall
     * two to a page. The preview counts the pages as they are, not as they were asked for.
     */
    const dayCount = unit.bands.length;
    const perPage = dayCount > 1 ? Math.ceil(dayCount / across) : Math.ceil((endMinute - startMinute) / across / 60) * 60;
    const columns = dayCount > 1 ? Math.ceil(dayCount / perPage) : across;
    const shownEnd = dayCount > 1 ? endMinute : Math.min(24 * 60, startMinute + across * perPage);
    const minutes = endMinute - startMinute;
    const perMinute = dayCount > 1 ? sliceWidth / (perPage * minutes) : sliceWidth / perPage;
    const bandWidth = minutes * perMinute;
    const xOf = (minute: number, band: number) => band * bandWidth + (minute - startMinute) * perMinute;

    // The rows as pieces no taller than a page, then gathered into pages down.
    const lanesPerPage = Math.max(1, Math.floor((available - 4) / classHeight));
    const pieces = unit.rows.flatMap((row) => {
      const whole = Math.max(frame.labelHeight, row.lanes * classHeight + 4);
      if (whole <= available) return [{ row, from: 0, to: row.lanes, h: whole }];
      const cut: { row: typeof row; from: number; to: number; h: number }[] = [];
      for (let from = 0; from < row.lanes; from += lanesPerPage) {
        const to = Math.min(row.lanes, from + lanesPerPage);
        cut.push({ row, from, to, h: Math.max(frame.labelHeight, (to - from) * classHeight + 4) });
      }
      return cut;
    });
    const downs: (typeof pieces)[] = [[]];
    let used = 0;
    for (const piece of pieces) {
      if (used + piece.h > available && downs[downs.length - 1].length) {
        downs.push([]);
        used = 0;
      }
      downs[downs.length - 1].push(piece);
      used += piece.h;
    }

    downs.forEach((down, line) => {
      for (let column = 0; column < columns; column += 1) {
        const from = column * sliceWidth;
        const to = from + sliceWidth;
        const onPage = (x: number) => frame.left + frame.labelWidth + (x - from);
        const within = (x: number) => x >= from - 0.01 && x <= to + 0.01;

        const ticks: SemesterPage["ticks"] = [];
        const hours: SemesterPage["hours"] = [];
        const days: SemesterPage["days"] = [];
        const seams: number[] = [];
        const step = [1, 2, 3, 4, 6].find((apart) => perMinute * 60 * apart >= 26) ?? 6;
        unit.bands.forEach((band, index) => {
          for (let minute = Math.ceil(startMinute / 15) * 15; minute <= shownEnd; minute += 15) {
            const x = xOf(minute, index);
            if (!within(x)) continue;
            const weight = minute % 60 === 0 ? "hour" : minute % 30 === 0 ? "half" : "quarter";
            const spacing = weight === "half" ? perMinute * 30 : perMinute * 15;
            if (weight !== "hour" && spacing < 7) continue;
            ticks.push({ x: onPage(x), weight });
            const edge = minute === startMinute || minute === endMinute || x === from || x === to;
            if (weight === "hour" && (minute / 60) % step === 0 && (unit.bands.length === 1 || !edge)) {
              hours.push({ x: onPage(x), label: time(minute) });
            }
          }
          if (index > 0 && within(index * bandWidth)) seams.push(onPage(index * bandWidth));
          if (band && unit.bands.length > 1) {
            const start = Math.max(from, index * bandWidth);
            const end = Math.min(to, (index + 1) * bandWidth);
            if (end - start > 1) days.push({ x: onPage(start), w: end - start, label: dayName(band) });
          }
        });

        const rows: SemesterPage["rows"] = [];
        const boxes: PageBox[] = [];
        let y = frame.contentTop;
        for (const piece of down) {
          rows.push({
            y,
            h: piece.h,
            label: piece.row.label,
            sub: piece.from > 0 ? "continued" : piece.row.sub,
          });
          for (const { klass, lane, band } of piece.row.boxes) {
            if (lane < piece.from || lane >= piece.to) continue;
            const x0 = xOf(minutesOf(klass.start), band);
            const x1 = xOf(minutesOf(klass.end), band);
            if (x1 <= from || x0 >= to) continue;
            const left = Math.max(x0, from);
            const right = Math.min(x1, to);
            boxes.push({
              x: onPage(left) + (left === x0 ? 1 : 0),
              y: y + 2 + (lane - piece.from) * classHeight,
              w: Math.max(2, right - left - (left === x0 ? 1 : 0) - (right === x1 ? 1 : 0)),
              h: classHeight - 2,
              color: colors.get(klass.courseCode) ?? "#1f4e79",
              klass,
              cutLeft: x0 < from,
              cutRight: x1 > to,
            });
          }
          y += piece.h;
        }

        const labels = down.map((piece) => piece.row.label);
        const partRows =
          downs.length > 1 && labels.length
            ? labels.length === 1
              ? labels[0]
              : `${labels[0]} – ${labels[labels.length - 1]}`
            : "";
        const partHours =
          columns > 1 ? `${time(Math.round(startMinute + from / perMinute))}–${time(Math.min(24 * 60, Math.round(startMinute + to / perMinute)))}` : "";
        pages.push({
          unit: unitIndex,
          title: unit.title,
          // Side by side, a page's stretch of hours crosses days; its day names say which.
          part: [partRows, unit.bands.length > 1 ? "" : partHours].filter(Boolean).join(" · "),
          column,
          line,
          gridTop: frame.gridTop,
          gridBottom: y,
          days,
          ticks,
          hours,
          seams,
          rows,
          boxes,
        });
      }
    });
  });
  return pages;
}

/** "Semester-1-timetable.pdf", "Semester-1-rooms.pdf". */
export function semesterFilename(input: Pick<SemesterExportInput, "semester" | "layout">): string {
  const what = input.layout === "days" ? "timetable" : "rooms";
  return `${[input.semester, what].filter(Boolean).join(" ").replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

const LINE: Rgb = [228, 232, 239];
const HEADER: Rgb = [248, 250, 252];
const SOFT: Rgb = [102, 112, 133];
const FAINT: Rgb = [152, 162, 179];

/** "Mon 28 Sep 2026". */
function dayWords(iso: string): string {
  const day = parseIsoDate(iso);
  return `${DAY_NAMES[day.getDay()]} ${day.getDate()} ${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}`;
}

export async function buildSemesterPdf(input: SemesterExportInput, zoom: ExportZoom, today = new Date()): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const frame = frameOf(zoom.paper, input.layout);
  const doc = new jsPDF({ unit: "pt", format: zoom.paper, orientation: "landscape" });
  const pages = semesterPages(input, zoom);
  const heading = `${input.semester} · ${input.layout === "days" ? "Timetable" : "Rooms"}`;

  if (!pages.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(heading, frame.left, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...SOFT);
    doc.text("The portal has booked no classes for these sections.", frame.left, 52);
  }

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage(zoom.paper, "landscape");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(23);
    doc.text(heading, frame.left, 30);
    doc.setFontSize(10);
    doc.setTextColor(31, 78, 121);
    doc.text(page.title, frame.left, 46);
    if (page.part) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...SOFT);
      doc.text(page.part, frame.right, 46, { align: "right" });
    }

    const gridLeft = frame.left + frame.labelWidth;
    // The heading band, the frame, and the column of labels.
    doc.setFillColor(...HEADER);
    doc.rect(frame.left, page.gridTop, frame.right - frame.left, frame.contentTop - page.gridTop, "F");
    for (const tick of page.ticks) {
      doc.setDrawColor(...(tick.weight === "hour" ? ([174, 184, 198] as Rgb) : tick.weight === "half" ? ([213, 219, 228] as Rgb) : ([233, 237, 242] as Rgb)));
      doc.setLineWidth(tick.weight === "hour" ? 0.5 : 0.35);
      doc.line(tick.x, frame.contentTop, tick.x, page.gridBottom);
    }
    doc.setDrawColor(138, 150, 168);
    doc.setLineWidth(1.2);
    for (const seam of page.seams) doc.line(seam, page.gridTop, seam, page.gridBottom);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(52, 64, 84);
    for (const day of page.days) {
      doc.text(fitted(doc, day.label, Math.max(6, day.w - 6)), day.x + 4, page.gridTop + 10);
    }
    doc.setFontSize(7);
    doc.setTextColor(...SOFT);
    for (const hour of page.hours) {
      doc.text(hour.label, hour.x, frame.contentTop - 4.5, { align: "center" });
    }

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    for (const row of page.rows) {
      doc.line(frame.left, row.y, frame.right, row.y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(52, 64, 84);
      if (input.layout === "days") {
        doc.text(row.label, frame.left + 4, row.y + 10);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...FAINT);
        doc.text(row.sub, frame.left + 4, row.y + 18);
      } else {
        doc.text(fitted(doc, row.label, frame.labelWidth - 22), frame.left + 4, row.y + 9);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...FAINT);
        doc.text(row.sub, gridLeft - 4, row.y + 9, { align: "right" });
      }
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(frame.left, frame.contentTop, frame.right, frame.contentTop);
    doc.line(gridLeft, page.gridTop, gridLeft, page.gridBottom);
    doc.roundedRect(frame.left, page.gridTop, frame.right - frame.left, page.gridBottom - page.gridTop, 3, 3, "S");

    for (const box of page.boxes) drawBox(doc, box, input.layout);
  });

  const total = doc.getNumberOfPages();
  const swept = input.sweptAt ? `, as the portal's timetable stood on ${dayWords(input.sweptAt.slice(0, 10))}` : "";
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.text(`Exported ${dayWords(toIsoDate(today))} from Academic Coordinator Tools${swept}.`, frame.left, frame.height - 14);
    doc.text(`Page ${page} of ${total}`, frame.right, frame.height - 14, { align: "right" });
  }
  return doc.output("arraybuffer");
}

/**
 * One class, as its box on screen says it: the course and its group on the first line;
 * the room and the teacher on a second when the box is tall enough for one. On the Rooms
 * pages the room is the row, so the second line keeps the teacher alone.
 */
function drawBox(doc: JsPdf, box: PageBox, layout: SemesterLayout) {
  const color = rgbOf(box.color);
  const cancelled = box.klass.state === "cancelled";
  const covered = box.klass.state === "covered";
  const fill = cancelled ? towardsWhite(color, 0.45) : color;
  doc.setFillColor(...fill);
  if (box.cutLeft || box.cutRight) doc.rect(box.x, box.y, box.w, box.h, "F");
  else doc.roundedRect(box.x, box.y, box.w, box.h, 2, 2, "F");
  if (covered) {
    doc.setDrawColor(...towardsWhite(color, 0.7));
    doc.setLineWidth(1);
    doc.rect(box.x + 0.8, box.y + 0.8, box.w - 1.6, box.h - 1.6, "S");
  }
  if (box.w < 10 || box.h < 7) return;
  const size = Math.min(7, Math.max(5, box.h - 4));
  const two = box.h >= size * 2 + 5;
  const top = two ? box.y + (box.h - (size * 2 + 2)) / 2 + size * 0.85 : box.y + box.h / 2 + size * 0.35;
  const words = [box.klass.courseCode || box.klass.crn, box.klass.group].filter(Boolean).join("  ");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(size);
  doc.setTextColor(255);
  const first = fitted(doc, words, box.w - 5);
  doc.text(first, box.x + 2.5, top);
  if (cancelled) {
    doc.setDrawColor(255);
    doc.setLineWidth(0.5);
    doc.line(box.x + 2.5, top - size * 0.3, box.x + 2.5 + doc.getTextWidth(first), top - size * 0.3);
  }
  if (!two) return;
  const ink = towardsWhite(fill, 0.85);
  const y = top + size + 2;
  let x = box.x + 2.5;
  const room = layout === "days" ? formatRoom(box.klass.room) : "";
  const who = covered ? box.klass.cover || "somebody else" : box.klass.teacher;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size - 0.5);
  doc.setTextColor(...ink);
  for (const [icon, text] of [
    ["pin", room],
    [covered ? "cover" : "person", who],
  ] as const) {
    if (!text) continue;
    const space = box.x + box.w - 2.5 - x;
    if (space < size * 2) break;
    drawIcon(doc, icon, x, y - size * 0.8, size * 0.85, ink);
    const said = fitted(doc, text, space - size - 1);
    doc.text(said, x + size + 1, y);
    x += size + 1 + doc.getTextWidth(said) + 5;
  }
}

/** Build it and hand it to the browser as a download. */
export async function downloadSemesterPdf(input: SemesterExportInput, zoom: ExportZoom): Promise<void> {
  const blob = new Blob([await buildSemesterPdf(input, zoom)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = semesterFilename(input);
  link.click();
  URL.revokeObjectURL(url);
}
