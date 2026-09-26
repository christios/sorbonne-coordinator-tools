/**
 * A whole semester's timetable as a PDF, drawn the way the Timetable and Rooms pages draw it.
 *
 * Hours across the page, and down the side the days of each week — or the rooms. Classes
 * that overlap stack downwards, so a busy day is a taller day and nothing is narrowed by a
 * neighbour. Every week of the semester gets its pages, from the first class to the last;
 * a week with none keeps its page, drawn empty, as the CRN schedules do.
 *
 * One page shape, A4 landscape, and the week always spans its full width. The only thing
 * chosen is at most how many pages one week may take: a week is drawn at a comfortable
 * size on as few pages as that needs, smaller only when it would run past the ceiling, and
 * then every page's classes grow until the page is full, so no sheet ends in white. The same layout drives the preview and the file, so what the preview
 * shows is what prints.
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
/**
 * At most how many pages one week may take; `null` is no ceiling. A week that would need
 * more at a comfortable size is drawn smaller until it fits.
 */
export type ExportZoom = { maxPages: number | null };

export const MAX_PAGES = [1, 2, 3, 4] as const;
/**
 * How tall a class is when nothing squeezes it: two lines of a box read without leaning in.
 * It decides how many pages a week takes when the ceiling allows more; the page then grows
 * the classes to fill itself either way.
 */
const COMFORTABLE_CLASS = 18;

/**
 * A4 landscape, and only that. A PDF prints to whatever paper is in the tray, scaled; a
 * second page size only changed how many rows fit a page, which the class height already
 * decides. One shape means the page breaks are the same whoever prints it.
 */
const PAGE = { width: 841.89, height: 595.28 };
/** The smallest a class is drawn to keep a week inside its page ceiling, and the tallest a page stretches one. */
const SMALLEST_CLASS = 6;
const TALLEST_CLASS = 160;
/** Room above and below the classes stacked in a row. */
const ROW_PAD = 2;

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
  note: string;
};

type Row = { label: string; sub: string; boxes: { klass: Klass; lane: number; band: number }[]; lanes: number };

/** A stretch of the semester that is drawn as a unit: a week, or one day of rooms. */
type Unit = {
  /** "Week 5 · 28 Sep – 2 Oct 2026". */
  title: string;
  /** The days across the page, when a room's week runs along its row; one entry otherwise. */
  bands: (string | null)[];
  rows: Row[];
};

/** A class's box on one page, in points from the page's corner. */
export type PageBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  klass: Klass;
};

/** One page, laid out: everything either renderer needs, in points. */
export type SemesterPage = {
  /** Which unit it belongs to, and where it sits among that unit's pages. */
  unit: number;
  title: string;
  /** "Mon 7 – Wed 9 · page 1 of 2", where a unit takes more than one page; "" otherwise. */
  part: string;
  line: number;
  gridTop: number;
  gridBottom: number;
  /** Where the day names go, when a room's week is drawn. */
  days: { x: number; w: number; label: string }[];
  ticks: { x: number; weight: "hour" | "half" | "quarter" }[];
  hours: { x: number; label: string }[];
  /** Where one day of the week ends and the next begins. */
  seams: number[];
  rows: { y: number; h: number; label: string; sub: string }[];
  boxes: PageBox[];
};

/** Where things go on the sheet: thin margins, one line of heading, the column of labels. */
export function frameOf(layout: SemesterLayout) {
  const { width, height } = PAGE;
  const rooms = layout !== "days";
  const gridTop = 30;
  const daysHeight = layout === "rooms-week" ? 12 : 0;
  const hoursHeight = 12;
  return {
    width,
    height,
    left: 16,
    right: width - 16,
    titleY: 20,
    gridTop,
    daysHeight,
    hoursHeight,
    contentTop: gridTop + daysHeight + hoursHeight,
    bottom: height - 18,
    footerY: height - 7,
    labelWidth: rooms ? 64 : 46,
    // A row is never shorter than its label: two lines for a day, one for a room.
    labelHeight: rooms ? 11 : 22,
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
        note: note?.note.trim() ?? "",
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
    const roomRow = (room: string, among: Klass[], bands: (string | null)[]): Row => {
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

/** A row, or the part of one that fits a page: lanes `from` up to `to`. */
type Piece = { row: Row; from: number; to: number };

/**
 * The rows gathered into pages at one class height. A row moves whole to the next page
 * when it can; only a row taller than a whole page is cut, between two stacked classes.
 */
function packed(rows: Row[], classHeight: number, available: number, labelHeight: number): Piece[][] {
  const tall = (lanes: number) => Math.max(labelHeight, lanes * classHeight + ROW_PAD * 2);
  const perPage = Math.max(1, Math.floor((available - ROW_PAD * 2) / classHeight));
  const pieces = rows.flatMap((row) => {
    if (tall(row.lanes) <= available) return [{ row, from: 0, to: row.lanes }];
    const cut: Piece[] = [];
    for (let from = 0; from < row.lanes; from += perPage) cut.push({ row, from, to: Math.min(row.lanes, from + perPage) });
    return cut;
  });
  const pages: Piece[][] = [[]];
  let used = 0;
  for (const piece of pieces) {
    const height = tall(piece.to - piece.from);
    if (used + height > available && pages[pages.length - 1].length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(piece);
    used += height;
  }
  return pages;
}

/** The largest height in [low, high] that `fits` accepts, to a quarter of a point; `low` if none does. */
function largest(low: number, high: number, fits: (height: number) => boolean): number {
  if (!fits(low)) return low;
  let lo = low;
  let hi = high;
  while (hi - lo > 0.25) {
    const middle = (lo + hi) / 2;
    if (fits(middle)) lo = middle;
    else hi = middle;
  }
  return lo;
}

/**
 * How tall a unit's classes are drawn, and on how many pages.
 *
 * Three steps. At a comfortable size the week needs some number of pages. Past the
 * ceiling, the classes shrink until the week fits it. Then they grow again as far as they
 * can without needing another page, so the pages are as full as their number allows.
 * What is left at the foot of each page after that is shared out among its own rows.
 */
function unitHeight(rows: Row[], zoom: ExportZoom, available: number, labelHeight: number): { classHeight: number; pages: Piece[][] } {
  const pagesAt = (height: number) => packed(rows, height, available, labelHeight).length;
  let height = COMFORTABLE_CLASS;
  const ceiling = zoom.maxPages;
  if (ceiling && pagesAt(height) > ceiling) {
    height = largest(SMALLEST_CLASS, height, (candidate) => pagesAt(candidate) <= ceiling);
  }
  const pages = pagesAt(height);
  height = largest(height, TALLEST_CLASS, (candidate) => pagesAt(candidate) <= pages);
  return { classHeight: height, pages: packed(rows, height, available, labelHeight) };
}

/** Every page of the export, laid out. */
export function semesterPages(input: SemesterExportInput, zoom: ExportZoom, units = semesterUnits(input)): SemesterPage[] {
  const frame = frameOf(input.layout);
  const classes = units.flatMap((unit) => unit.rows.flatMap((row) => row.boxes.map((box) => box.klass)));
  const [startMinute, endMinute] = hoursOf(classes);
  const colors = assignColors(input.sections.map((section) => section.courseCode));
  const width = frame.right - frame.left - frame.labelWidth;
  const available = frame.bottom - frame.contentTop;
  const gridLeft = frame.left + frame.labelWidth;
  const pages: SemesterPage[] = [];

  units.forEach((unit, unitIndex) => {
    // The whole week across the whole width, whatever the height: the hours are never cut.
    const minutes = endMinute - startMinute;
    const perMinute = width / (minutes * unit.bands.length);
    const bandWidth = minutes * perMinute;
    const xOf = (minute: number, band: number) => gridLeft + band * bandWidth + (minute - startMinute) * perMinute;

    const ticks: SemesterPage["ticks"] = [];
    const hours: SemesterPage["hours"] = [];
    const days: SemesterPage["days"] = [];
    const seams: number[] = [];
    const step = [1, 2, 3, 4, 6].find((apart) => perMinute * 60 * apart >= 26) ?? 6;
    unit.bands.forEach((band, index) => {
      for (let minute = Math.ceil(startMinute / 15) * 15; minute <= endMinute; minute += 15) {
        const weight = minute % 60 === 0 ? "hour" : minute % 30 === 0 ? "half" : "quarter";
        const spacing = weight === "half" ? perMinute * 30 : perMinute * 15;
        if (weight !== "hour" && spacing < 7) continue;
        ticks.push({ x: xOf(minute, index), weight });
        const edge = minute === startMinute || minute === endMinute;
        if (weight === "hour" && (minute / 60) % step === 0 && (unit.bands.length === 1 || !edge)) {
          hours.push({ x: xOf(minute, index), label: time(minute) });
        }
      }
      if (index > 0) seams.push(gridLeft + index * bandWidth);
      if (band && unit.bands.length > 1) days.push({ x: gridLeft + index * bandWidth, w: bandWidth, label: dayName(band) });
    });

    const { classHeight, pages: downs } = unitHeight(unit.rows, zoom, available, frame.labelHeight);
    downs.forEach((down, line) => {
      // The foot of this page shared out among its own rows, so it ends where the sheet does.
      const lanes = down.map((piece) => piece.to - piece.from);
      const needs = (height: number) =>
        lanes.reduce((total, rows) => total + Math.max(frame.labelHeight, rows * height + ROW_PAD * 2), 0);
      const lane = largest(classHeight, TALLEST_CLASS, (height) => needs(height) <= available);
      const spare = down.length ? Math.max(0, available - needs(lane)) / down.length : 0;

      const rows: SemesterPage["rows"] = [];
      const boxes: PageBox[] = [];
      let y = frame.contentTop;
      for (const piece of down) {
        const tall = Math.max(frame.labelHeight, (piece.to - piece.from) * lane + ROW_PAD * 2) + spare;
        rows.push({ y, h: tall, label: piece.row.label, sub: piece.from > 0 ? "continued" : piece.row.sub });
        // A row taller than its classes — a label's height, or its share of the foot — centres them.
        const top = y + (tall - (piece.to - piece.from) * lane) / 2;
        for (const { klass, lane: at, band } of piece.row.boxes) {
          if (at < piece.from || at >= piece.to) continue;
          const x0 = xOf(minutesOf(klass.start), band);
          const x1 = xOf(minutesOf(klass.end), band);
          boxes.push({
            x: x0 + 0.75,
            y: top + (at - piece.from) * lane + 0.75,
            w: Math.max(2, x1 - x0 - 1.5),
            h: Math.max(2, lane - 1.5),
            color: colors.get(klass.courseCode) ?? "#1f4e79",
            klass,
          });
        }
        y += tall;
      }
      const labels = down.map((piece) => piece.row.label);
      pages.push({
        unit: unitIndex,
        title: unit.title,
        part:
          downs.length > 1 && labels.length
            ? `${labels[0]}${labels.length > 1 && labels[labels.length - 1] !== labels[0] ? ` – ${labels[labels.length - 1]}` : ""} · page ${line + 1} of ${downs.length}`
            : "",
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


export async function buildSemesterPdf(input: SemesterExportInput, zoom: ExportZoom): Promise<ArrayBuffer> {
  const { jsPDF } = await import("jspdf");
  const frame = frameOf(input.layout);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const pages = semesterPages(input, zoom);
  const heading = `${input.semester} · ${input.layout === "days" ? "Semester Timetable" : "Rooms"}`;

  if (!pages.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(heading, frame.left, frame.titleY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SOFT);
    doc.text("The portal has booked no classes for these sections.", frame.left, frame.titleY + 16);
  }

  pages.forEach((page, index) => {
    if (index > 0) doc.addPage("a4", "landscape");
    // One line of heading: the semester, the week, and which part of the week this is.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(23);
    doc.text(heading, frame.left, frame.titleY);
    const headingWidth = doc.getTextWidth(heading);
    doc.setTextColor(31, 78, 121);
    doc.text(page.title, frame.left + headingWidth + 14, frame.titleY);
    if (page.part) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...SOFT);
      doc.text(page.part, frame.right, frame.titleY, { align: "right" });
    }

    const gridLeft = frame.left + frame.labelWidth;
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
    for (const day of page.days) doc.text(fitted(doc, day.label, Math.max(6, day.w - 6)), day.x + 4, page.gridTop + 9);
    doc.setFontSize(6.5);
    doc.setTextColor(...SOFT);
    for (const hour of page.hours) doc.text(hour.label, hour.x, frame.contentTop - 3.5, { align: "center" });

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    for (const row of page.rows) {
      doc.line(frame.left, row.y, frame.right, row.y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(52, 64, 84);
      if (input.layout === "days") {
        doc.text(row.label, frame.left + 3, row.y + 9);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...FAINT);
        doc.text(row.sub, frame.left + 3, row.y + 17);
      } else {
        doc.text(fitted(doc, row.label, frame.labelWidth - 16), frame.left + 3, row.y + 8.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...FAINT);
        doc.text(row.sub, gridLeft - 3, row.y + 8.5, { align: "right" });
      }
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.6);
    doc.line(frame.left, frame.contentTop, frame.right, frame.contentTop);
    doc.line(gridLeft, page.gridTop, gridLeft, page.gridBottom);
    doc.roundedRect(frame.left, page.gridTop, frame.right - frame.left, page.gridBottom - page.gridTop, 3, 3, "S");

    for (const box of page.boxes) drawBox(doc, box);
  });

  // Page numbers and nothing else: a timetable handed out is not a report of where it came from.
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(140);
    doc.text(`Page ${page} of ${total}`, frame.right, frame.footerY, { align: "right" });
  }
  return doc.output("arraybuffer");
}

/** A piece of what a box says: one word, and how it is drawn. */
type Word = { text: string; bold: boolean; ink: Rgb; icon?: "pin" | "person" | "cover"; strike?: boolean; opens: boolean };

/**
 * Everything the box on screen says, and what its tooltip adds, in the order the screen
 * gives it: the course and its group, the hours, the room, who teaches it, the CRN — and
 * what happened to it, where something did. Split into words so a narrow box can wrap it.
 */
function wordsOf(klass: Klass, fill: Rgb): Word[] {
  const white: Rgb = [255, 255, 255];
  const soft = towardsWhite(fill, 0.85);
  const cancelled = klass.state === "cancelled";
  const fields: { text: string; bold?: boolean; ink: Rgb; icon?: Word["icon"]; strike?: boolean }[] = [
    { text: klass.courseCode || klass.crn, bold: true, ink: white, strike: cancelled },
    { text: klass.group, bold: true, ink: soft },
    { text: cancelled ? "CANCELLED" : "", bold: true, ink: white },
    { text: `${klass.start}–${klass.end}`, ink: soft },
    { text: formatRoom(klass.room), ink: soft, icon: "pin" },
    { text: klass.teacher, ink: soft, icon: "person" },
    { text: klass.state === "covered" ? `covered by ${klass.cover || "somebody else"}` : "", bold: true, ink: white, icon: "cover" },
    { text: `CRN ${klass.crn}`, ink: soft },
    { text: klass.note, ink: soft },
  ];
  return fields
    .filter((field) => field.text.trim())
    .flatMap((field) =>
      field.text
        .trim()
        .split(/\s+/)
        .map((text, index) => ({
          text,
          bold: Boolean(field.bold),
          ink: field.ink,
          icon: index === 0 ? field.icon : undefined,
          strike: field.strike,
          opens: index === 0,
        })),
    );
}

type Placed = { word: Word; x: number; line: number };

/**
 * The words flowed into the box at one size: where each goes, or null when they do not
 * all fit. A field starts with a wider gap than the words inside it, so "5.101" and
 * "Grace Younes" still read as two things when they share a line.
 */
function flow(doc: JsPdf, words: Word[], size: number, width: number, height: number, force = false): Placed[] | null {
  const lineHeight = size * 1.18;
  const lines = Math.max(1, Math.floor((height + size * 0.18) / lineHeight));
  const icon = size * 1.05;
  const placed: Placed[] = [];
  let x = 0;
  let line = 0;
  doc.setFontSize(size);
  for (const word of words) {
    doc.setFont("helvetica", word.bold ? "bold" : "normal");
    const gap = x === 0 ? 0 : word.opens ? size * 0.7 : doc.getTextWidth(" ");
    let wide = (word.icon ? icon : 0) + doc.getTextWidth(word.text);
    if (x > 0 && x + gap + wide > width) {
      line += 1;
      x = 0;
    }
    if (wide > width) {
      if (!force) return null;
      wide = width;
    }
    if (line >= lines) {
      if (!force) return null;
      break;
    }
    const at = x === 0 ? 0 : x + gap;
    placed.push({ word, x: at, line });
    x = at + wide;
  }
  return placed;
}

/**
 * One class: its colour, and every word it has, as large as the box allows. The size is
 * the box's own — the largest from 8 points down that fits everything — so a long class
 * reads at a glance and a short one still says all of it, smaller.
 */
function drawBox(doc: JsPdf, box: PageBox) {
  const color = rgbOf(box.color);
  const cancelled = box.klass.state === "cancelled";
  const covered = box.klass.state === "covered";
  const fill = cancelled ? towardsWhite(color, 0.45) : color;
  doc.setFillColor(...fill);
  doc.roundedRect(box.x, box.y, box.w, box.h, 1.5, 1.5, "F");
  if (covered) {
    doc.setDrawColor(...towardsWhite(color, 0.7));
    doc.setLineWidth(0.8);
    doc.roundedRect(box.x + 0.6, box.y + 0.6, box.w - 1.2, box.h - 1.2, 1.2, 1.2, "S");
  }
  const padX = 2;
  const padY = 1.2;
  const width = box.w - padX * 2;
  const height = box.h - padY * 2;
  if (width < 4 || height < 3) return;
  const words = wordsOf(box.klass, fill);
  let size = 8;
  let placed: Placed[] | null = null;
  for (; size >= 3.5; size -= 0.25) {
    placed = flow(doc, words, size, width, height);
    if (placed) break;
  }
  if (!placed) {
    size = 3.5;
    placed = flow(doc, words, size, width, height, true) ?? [];
  }
  const lineHeight = size * 1.18;
  const used = (placed.reduce((most, entry) => Math.max(most, entry.line), 0) + 1) * lineHeight;
  const top = box.y + padY + Math.max(0, (height - used) / 2) + size * 0.86;
  doc.setFontSize(size);
  for (const { word, x, line } of placed) {
    const left = box.x + padX + x;
    const baseline = top + line * lineHeight;
    doc.setFont("helvetica", word.bold ? "bold" : "normal");
    doc.setTextColor(...word.ink);
    let at = left;
    if (word.icon) {
      drawIcon(doc, word.icon, left, baseline - size * 0.8, size * 0.85, word.ink);
      at += size * 1.05;
    }
    const room = box.x + box.w - padX - at;
    const text = doc.getTextWidth(word.text) > room ? fitted(doc, word.text, Math.max(2, room)) : word.text;
    doc.text(text, at, baseline);
    if (word.strike) {
      doc.setDrawColor(...word.ink);
      doc.setLineWidth(0.5);
      doc.line(at, baseline - size * 0.3, at + doc.getTextWidth(text), baseline - size * 0.3);
    }
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
