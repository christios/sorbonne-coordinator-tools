import { Flag } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { ClassFacts } from "@/components/ClassFacts";
import { Tip, TipWishes } from "@/components/InfoTip";
import { heightNeeded, linesIn } from "@/services/boxFit";
import { fittedRowHeight } from "@/services/timelineFit";
import {
  DAY_NAMES,
  type CalendarCourse,
  type PlacedSession,
  formatRoom,
  hourBounds,
  laneOut,
  minutesOf,
  parseIsoDate,
  sessionsInRange,
  sessionsOnDay,
  weekDays,
} from "@/services/weekSchedule";

/**
 * The column of labels, and how short a row may be: never shorter than its label. Said in
 * pixels, with the label's lines set to match, so the grid can work out how tall its rows
 * may grow before it has drawn them.
 *
 * A day's label is two short lines — "Tue 29", "14 classes". A room's name runs longer
 * ("7.119 (Research)") and there are sixty of them, so a room takes one wider line, and a
 * quiet room is one class high rather than two lines of label high.
 */
const LABEL = { day: { width: 92, height: 44 }, room: { width: 136, height: 28 } };
/**
 * The same, squeezed: one short line ("Tue 29 · 54"), so a quiet row is never held taller
 * than its classes need when the whole week has to fit the screen. A row shorter than its
 * full label says this one, at whatever height the zoom has it.
 */
const SQUEEZED_LABEL = { day: { width: 76, height: 14 }, room: { width: 96, height: 10 } };
/** How tall a class is drawn before the grid has been measured: a first paint, or a test. */
const UNMEASURED_LANE = 22;
/** Half the width of an hour's label across the top, "18:00" at its size. */
const HALF_A_TIME = 21;
/**
 * How wide the shortest class is drawn, at least. Every box says everything (see
 * ClassFacts) and wraps it to its width; narrower than this, on a phone or a room's whole
 * week, it wrapped a letter a line. Past it the week scrolls sideways, as it does zoomed.
 */
const NARROWEST_CLASS = 96;
/** The hours across the top, and the days above them when the week is side by side. */
const HOURS_HEIGHT = 26;
const DAYS_HEIGHT = 20;
/** Every `every` minutes across the span, or none of them when they would be too close. */
function ticks(from: number, to: number, every: number, worth: boolean): number[] {
  if (!worth) return [];
  const found: number[] = [];
  for (let minute = Math.ceil(from / every) * every; minute <= to; minute += every) found.push(minute);
  return found;
}

/** A quarter of an hour: what a class snaps to while it is drawn or dragged. */
const SNAP = 15;
/** A press that moves less than this is a click, not a drag. */
const STILL = 4;
/** What a click on an empty stretch of a day makes: the department's usual block. */
const USUAL = 90;

/** A stretch of one day on the grid: where a class is, or is to go. */
export type GridSlot = { date: string; start: string; end: string };

/** What the semester plan does with the grid's gestures. See `editing` below. */
export type GridEditing = {
  onDraw: (slot: GridSlot) => void;
  onMove: (session: PlacedSession, slot: GridSlot) => void;
  onOpen: (session: PlacedSession) => void;
  /** A drag from elsewhere on the page, carrying data of this type, dropped on a day. */
  dropType?: string;
  onDrop?: (data: string, slot: GridSlot) => void;
  /** A class picked up to move or stretch, from the press to the release: null once let go. */
  onHold?: (session: PlacedSession | null) => void;
  /**
   * Where a class dragged in from the page would land, as long as it really is: the slot under
   * the pointer, given back at the class's own length. Null while nothing of ours is dragged.
   */
  dropSlot?: (slot: GridSlot) => GridSlot | null;
  /**
   * What would go wrong if a class sat at a slot — the one being moved, or (null) the one
   * dragged in — so the box that shows where it would land can say so: red for a clash or a
   * Must broken, amber for a Would like.
   */
  judge?: (slot: GridSlot, session: PlacedSession | null) => GhostJudgement | null;
};

/** What the box under the pointer says about where it is: how bad, and in a word or two. */
export type GhostJudgement = { worst: "must" | "would" | null; label: string; said: string };

// See-through where it collides: the class it would clash with shows under it.
const GHOST_TONES = {
  none: "border-[#1f4e79] bg-[#e8edf3]/80 text-[#1f4e79]",
  must: "border-[#a6292f] bg-[#fdf3f3]/55 text-[#a6292f]",
  would: "border-[#d99b1c] bg-[#fdf6e3]/55 text-[#8a6116]",
} as const;

type Gesture =
  | { kind: "draw"; date: string; from: number; to: number; x: number; y: number; moved: boolean }
  | { kind: "move"; session: PlacedSession; date: string; start: number; offset: number; x: number; y: number; moved: boolean }
  | { kind: "stretch"; session: PlacedSession; end: number; x: number; y: number; moved: boolean };

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const snapped = (minute: number) => Math.round(minute / SNAP) * SNAP;

/** A room as the grid names it, or "" for a class the portal has put in none. */
const roomNameOf = (session: { room: string }) => formatRoom(session.room).trim();

type WeekTimelineProps = {
  weekStart: Date;
  sessions: PlacedSession[];
  courses: Map<string, CalendarCourse>;
  today: string;
  /**
   * How many screens wide the week is drawn: 1 fills the screen exactly, 3 is three
   * screens and scrolls. A multiplier and not a pixel count, because the pixel count that
   * fills a screen depends on the screen, and a slider whose bottom half did nothing on a
   * wide monitor is a slider with a bottom half that does nothing.
   */
  widthZoom: number;
  /**
   * The height zoom, from 0 to 1: how far each row goes from the whole week on the screen
   * towards its classes saying everything (see ClassFacts). A filling grid grows its classes
   * past that until the rows take the whole screen; a grid that does not fill is always at 1.
   *
   * It was a class's height in pixels, and a row grew past that to say everything. Below
   * what the words needed — on a narrow week, nearly all of the slider — a notch changed
   * nothing; and from the lowest notch, the week on one screen, the next one jumped
   * straight to every row at full height. A share of the way moves every notch.
   */
  heightZoom: number;
  atLeast?: { startMinute: number; endMinute: number };
  onPick?: (session: PlacedSession) => void;
  /** Take the height given and scroll inside it, rather than growing to fit the week. */
  fills?: boolean;
  /**
   * What the rows are: the week's days (the default), or the rooms its classes are in.
   *
   * By room, `day` narrows the picture to that one day and its hours run across the page.
   * Without it the week's days sit side by side, each with its own hours, so a room's
   * whole week reads along one line.
   */
  rowsBy?: "day" | "room";
  day?: string;
  /** How many a room seats, by the name the portal gives it; null where nobody has said. */
  seatsOf?: (room: string) => number | null;
  /** How many the registrar has in a section, for a class too big for its room. */
  registeredOf?: (crn: string) => number | null;
  /**
   * The lowest notch of the width zoom: the whole week across the box, however narrow it takes.
   *
   * Everywhere else the shortest class is never narrower than a readable box, so at the
   * lowest zoom a busy semester still scrolled sideways, and the lowest notch of a slider
   * did not do what a lowest notch is for. Squeezed, the week is exactly as wide as the
   * screen, and what a box has no room to say is on the hover, as it always is. The height
   * zoom's lowest notch, 0, does the same down the page.
   */
  squeeze?: { width: boolean };
  /**
   * The semester plan's gestures, on a week with its days down the side. Drag along an
   * empty stretch of a day to draw a class there, or click it for ninety minutes; drag a
   * class to move it to another day or hour, or its right-hand end to make it longer or
   * shorter; click it to open it. Something dragged in from the page — a class from the
   * plan's list — dropped on a day lands at that hour. Nothing is saved here: each gesture
   * is handed up as a slot. Left out, the grid is the registrar's, and nothing on it moves.
   */
  editing?: GridEditing;
  /**
   * Stretches of a day to shade behind its classes, on a week with its days down the side:
   * a teacher's hours they can't teach (red) or would rather (green), and a period binding
   * everybody (amber, named) — Ramadan's hours without classes.
   */
  shading?: (date: string) => Shade[];
};

/** A stretch of one day shaded behind the classes, with what it is for the hover. */
export type Shade = { from: string; to: string; tone: "cant" | "prefer" | "period"; title: string };

const SHADES: Record<Shade["tone"], string> = {
  cant: "bg-[#a6292f]/[0.12] border-x border-[#a6292f]/30",
  prefer: "bg-[#2e7d55]/[0.12] border-x border-[#2e7d55]/30",
  period: "bg-[#d99b1c]/[0.14] border-x border-[#d99b1c]/40",
};

/** One row of the grid: a day, or a room, and the classes on it. */
type Line = { key: string; title: string; today: boolean; sessions: PlacedSession[] };

/**
 * A week with the DAYS down the side and the HOURS across the page.
 *
 * The ordinary calendar puts hours down the side, which is right when a day holds four or
 * five classes: the column is tall, the boxes are tall, and overlaps sit side by side.
 * The department's whole week is a different shape of problem. Sixteen sections share its
 * worst hour, and in a column laid out that way they are sixteen slivers however hard you
 * zoom, because the only room to divide is the width of one day.
 *
 * Turned on its side the scarce dimension becomes the plentiful one. A class is as wide as
 * it is long — two hours is a wide box, with room on ONE line for the course, the hour, the
 * room and who teaches it — and the classes that overlap it stack downwards into a day row
 * that simply grows to hold them. Nothing is ever narrowed by a neighbour; a busy day is a
 * taller day.
 *
 * The two zooms are the two axes, and they do different jobs: the width decides how much
 * of the sentence fits in a box, the height decides how many classes you can see at once.
 *
 * The same picture answers the room question with ROOMS down the side: which rooms are
 * taken when, and where two classes have been booked into one room at once — which, on a
 * room's own row, is the only thing an overlap can mean.
 */
export function WeekTimeline({
  weekStart,
  sessions,
  courses,
  today,
  widthZoom,
  heightZoom,
  atLeast,
  onPick,
  fills = false,
  rowsBy = "day",
  day,
  seatsOf,
  registeredOf,
  squeeze,
  editing: editingGiven,
  shading,
}: WeekTimelineProps) {
  const days = weekDays(weekStart, sessions);
  const inWeek = sessionsInRange(sessions, days[0], days[days.length - 1]);
  // The whole semester's hours, so the scale holds still as the weeks go by.
  const { startMinute, endMinute } = hourBounds(sessions, atLeast);
  const byRoom = rowsBy === "room";
  const narrow = Boolean(squeeze?.width);
  // Height can only be squeezed into a height the grid is given.
  const detail = fills ? Math.min(1, Math.max(0, heightZoom)) : 1;
  // From the squeezed size to the full one with the zoom, so that no notch is a jump.
  const between = (squeezed: number, full: number) => squeezed + (full - squeezed) * detail;
  const LABEL_WIDTH = (narrow ? SQUEEZED_LABEL : LABEL)[rowsBy].width;
  const LABEL_HEIGHT = between(SQUEEZED_LABEL[rowsBy].height, LABEL[rowsBy].height);
  // Between one stacked class and the next, and at a row's top and foot.
  const GAP = between(1, 3);
  // The stretches of time across the page: one span of hours, or one per day of the week.
  const bands: (string | null)[] = byRoom ? (day ? [day] : days) : [null];
  const drawn = byRoom && day ? sessionsOnDay(inWeek, day) : inWeek;

  /*
   * By room, every room the semester's classes are in, busy this week or not.
   *
   * A room with nothing on it is the answer to "where is there a free room", so it keeps
   * its row; and rows that came and went with the week would move every room up and down
   * the page as you stepped through it.
   */
  const lines: Line[] = byRoom
    ? [...new Set(sessions.map(roomNameOf))]
        .sort((a, b) => (a ? (b ? a.localeCompare(b, undefined, { numeric: true }) : -1) : 1))
        .map((room) => ({
          key: room || "none",
          title: room || "No room",
          today: false,
          sessions: drawn.filter((session) => roomNameOf(session) === room),
        }))
    : days.map((date) => {
        const when = parseIsoDate(date);
        return {
          key: date,
          title: `${DAY_NAMES[when.getDay()]} ${when.getDate()}`,
          today: date === today,
          sessions: sessionsOnDay(inWeek, date),
        };
      });
  const laid = lines.map((line) => {
    const boxes = bands.flatMap((band, index) =>
      laneOut(band === null ? line.sessions : line.sessions.filter((session) => session.date === band)).map((placed) => ({
        ...placed,
        band: index,
      })),
    );
    return { line, boxes, rows: Math.max(1, boxes.reduce((most, { lane }) => Math.max(most, lane + 1), 0)) };
  });

  /*
   * The week is always at least as wide as the screen, and the zoom is a multiple of that.
   *
   * A teaching day is about ten hours. Asked for in pixels per minute it was narrower than
   * the screen at the low end, which left the week stopping two thirds of the way across
   * and a third of the page blank — and made the bottom of the slider do nothing, since
   * anything below screen-fill looks the same. Measured instead, one turn of the slider
   * means the same thing on every monitor. The scale stays honest either way: every minute
   * is the same number of pixels, whatever that number works out to be.
   *
   * The height is measured for the same reason, when the grid fills: see `fittedRowHeight`.
   */
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 0, height: 0 });
  /*
   * Measured before the first paint, again whenever the box changes size, and again
   * whenever the week or day on screen changes. The last is belt and braces: a week that
   * opened on a stale measurement kept its thin rows until something happened to resize
   * the box — stepping to another week did, which is how it showed.
   */
  const shownKey = `${weekStart.getTime()}|${day ?? ""}|${rowsBy}`;
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const read = () => {
      const next = { width: element.clientWidth || 0, height: element.clientHeight || 0 };
      setRoom((held) => (held.width === next.width && held.height === next.height ? held : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shownKey]);
  const minutes = Math.max(1, endMinute - startMinute);
  // Unmeasured — the first paint, or a test — gets a workable scale rather than none.
  const screenFit = room.width > 0 ? (room.width - LABEL_WIDTH) / (minutes * bands.length) : 1.6;
  // The semester's shortest class, as the hours are the semester's: the scale holds still week to week.
  const shortest = Math.max(30, Math.min(120, ...sessions.map((session) => minutesOf(session.end) - minutesOf(session.start))));
  const perMinute =
    narrow && room.width > 0 ? screenFit : Math.max(screenFit * Math.max(1, widthZoom), NARROWEST_CLASS / shortest);
  const bandWidth = minutes * perMinute;
  const width = bandWidth * bands.length;
  const headerHeight = HOURS_HEIGHT + (bands.length > 1 ? DAYS_HEIGHT : 0);
  // The header's own border is inside its height; each row but the last has one line under it.
  const available = room.height - headerHeight;
  const stacked = laid.map(({ rows }) => rows);
  // Not an empty week, whose rows would push its "No classes" line off the screen.
  const stretch = fills && drawn.length > 0;
  /*
   * The tallest a class can be with the whole week on the screen, squeezed: where the zoom
   * starts. Always the squeezed one, even as the labels and edges grow with the zoom — fitted
   * to those instead, it shrank as they grew, and a notch up made the classes shorter.
   */
  const lane = !stretch
    ? 0
    : room.height > 0
      ? fittedRowHeight(available, stacked, 2, SQUEEZED_LABEL[rowsBy].height, 2)
      : UNMEASURED_LANE;
  /*
   * And from there, the zoom's share of the way to what a row's classes need to say
   * everything (see ClassFacts): all of it at the top of the slider. Row by row, so one
   * half-hour class on a Thursday makes Thursday taller and not the week: a box's facts
   * wrap to its width, which is its length in time, so the short ones decide. Measured
   * after each layout and before it is painted, whatever the box has room to show.
   */
  const [needs, setNeeds] = useState<number[]>([]);
  // And each box's own, by its key: a box with room for all of it says all of it.
  const [wholes, setWholes] = useState<Record<string, number>>({});
  // Plus the gap between one stacked class and the next.
  const laneOf = (index: number) => Math.round(lane + Math.max(0, (needs[index] ?? 0) + GAP - lane) * detail);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const rows = laid.length;
    const measure = () => {
      const found: number[] = [];
      const each: Record<string, number> = {};
      for (const drawn of element.querySelectorAll<HTMLElement>("[data-line]")) {
        const at = Number(drawn.dataset.line);
        const need = Math.ceil(heightNeeded(drawn));
        found[at] = Math.max(found[at] ?? 0, need);
        each[drawn.dataset.box ?? ""] = need;
      }
      const next = Array.from({ length: rows }, (_, index) => found[index] ?? 0);
      setNeeds((held) => (held.length === next.length && held.every((value, index) => value === next[index]) ? held : next));
      setWholes((held) => {
        const keys = Object.keys(each);
        return keys.length === Object.keys(held).length && keys.every((key) => held[key] === each[key]) ? held : each;
      });
    };
    measure();
    // And again whenever the words change size on their own, as when the page's font arrives.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const facts of element.querySelectorAll("[data-facts]")) observer.observe(facts);
    return () => observer.disconnect();
    // What the boxes say and how wide they are; their height is the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, room.width, widthZoom, sessions, courses]);
  /*
   * What a whole-pixel class height leaves at the foot, shared among the rows so the week
   * ends where the screen does. A few pixels a row, but thirty rows of rounding down was a
   * visible strip of white under Friday.
   */
  const heightOf = (index: number) => Math.max(LABEL_HEIGHT, laid[index].rows * laneOf(index) + 2 * GAP);
  const used = laid.reduce((total, _, index) => total + heightOf(index), 0) + Math.max(0, laid.length - 1);
  const spare = stretch && room.height > 0 && used < available && laid.length ? (available - used) / laid.length : 0;
  // A row too short for its label's two lines says it in one.
  const tight = (index: number) => heightOf(index) + spare < LABEL[rowsBy].height;

  const hours: number[] = [];
  for (let minute = Math.ceil(startMinute / 60) * 60; minute <= endMinute; minute += 60) hours.push(minute);
  /*
   * Three weights of line, so the eye can judge a start time without running back to the
   * header: the hour, the half, the quarter. Each tier is dropped once its lines are
   * closer together than the width at which they stop being a scale and become hatching.
   */
  const halves = ticks(startMinute, endMinute, 30, perMinute * 30 >= 18).filter((minute) => minute % 60 !== 0);
  const quarters = ticks(startMinute, endMinute, 15, perMinute * 15 >= 13).filter((minute) => minute % 30 !== 0);
  const leftOf = (minute: number, band = 0) => band * bandWidth + (minute - startMinute) * perMinute;
  /*
   * Which hours get a label. Every one when there is room; with a week side by side a day
   * can be too narrow for that, and every other hour, or every third, still gives the eye
   * something to count from. A day's first and last hour sit on the line between two days
   * and would print on top of each other, so side by side they go unlabelled.
   */
  const step = [1, 2, 3, 4, 6].find((hoursApart) => perMinute * 60 * hoursApart >= 36) ?? 6;
  const labelled = hours.filter(
    (minute) => (minute / 60) % step === 0 && (bands.length === 1 || (minute > startMinute && minute < endMinute)),
  );
  const time = (minute: number) =>
    `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  // Centred on its line, except near the two ends, where half of it would hang off the grid.
  const anchored = (at: number) =>
    at < HALF_A_TIME ? "" : at > width - HALF_A_TIME ? "-translate-x-full" : "-translate-x-1/2";
  const nothing = byRoom && day ? "No classes this day." : "No classes this week.";

  /*
   * The plan's gestures. Only on a week of days, which is what a class is placed on; a room's
   * row is a question about the rooms, not somewhere to put a class.
   *
   * The gesture is kept in a ref as well as in state: the window's listeners read the ref,
   * and the page is told what happened once, when the pointer is let go — never from inside
   * a state update, which React may run twice.
   */
  const editing = byRoom ? undefined : editingGiven;
  const rowsOf = useRef(new Map<string, HTMLDivElement>());
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const live = useRef<Gesture | null>(null);
  const said = useRef(editing);
  const scale = useRef({ perMinute, startMinute, endMinute });
  useEffect(() => {
    said.current = editing;
    scale.current = { perMinute, startMinute, endMinute };
  });
  // A drag that ends on the box it started on still clicks it; this says not to open it.
  const dragged = useRef(false);
  const follow = (next: Gesture | null) => {
    live.current = next;
    setGesture(next);
  };
  const minuteAt = (clientX: number, date: string) => {
    const row = rowsOf.current.get(date);
    const { perMinute: per, startMinute: from, endMinute: to } = scale.current;
    if (!row) return from;
    return Math.max(from, Math.min(to, from + (clientX - row.getBoundingClientRect().left) / per));
  };
  const dateAt = (clientY: number, fallback: string) => {
    let nearest = fallback;
    let distance = Infinity;
    for (const [date, row] of rowsOf.current) {
      const box = row.getBoundingClientRect();
      if (clientY >= box.top && clientY < box.bottom) return date;
      const away = Math.min(Math.abs(clientY - box.top), Math.abs(clientY - box.bottom));
      if (away < distance) {
        distance = away;
        nearest = date;
      }
    }
    return nearest;
  };
  const active = gesture !== null;
  useEffect(() => {
    if (!active) return;
    const moveTo = (event: PointerEvent) => {
      const current = live.current;
      if (!current) return;
      const { endMinute: to } = scale.current;
      const moved = current.moved || Math.abs(event.clientX - current.x) > STILL || Math.abs(event.clientY - current.y) > STILL;
      if (current.kind === "draw") {
        follow({ ...current, to: snapped(minuteAt(event.clientX, current.date)), moved });
      } else if (current.kind === "stretch") {
        const start = minutesOf(current.session.start);
        follow({ ...current, end: Math.max(start + SNAP, snapped(minuteAt(event.clientX, current.session.date))), moved });
      } else {
        const date = dateAt(event.clientY, current.date);
        const length = minutesOf(current.session.end) - minutesOf(current.session.start);
        const start = Math.min(to - length, snapped(minuteAt(event.clientX, date) - current.offset));
        follow({ ...current, date, start: Math.max(scale.current.startMinute, start), moved });
      }
    };
    const finish = () => {
      const current = live.current;
      follow(null);
      const handlers = said.current;
      if (!current || !handlers) return;
      const { endMinute: to } = scale.current;
      if (current.kind === "draw") {
        const from = Math.min(current.from, current.to);
        const until = Math.max(current.from, current.to);
        const [start, end] = current.moved && until - from >= SNAP ? [from, until] : [current.from, current.from + USUAL];
        handlers.onDraw({ date: current.date, start: clock(start), end: clock(Math.min(to, end)) });
        return;
      }
      if (!current.moved) return;
      dragged.current = true;
      if (current.kind === "stretch") {
        handlers.onMove(current.session, { date: current.session.date, start: current.session.start, end: clock(current.end) });
      } else {
        const length = minutesOf(current.session.end) - minutesOf(current.session.start);
        handlers.onMove(current.session, { date: current.date, start: clock(current.start), end: clock(current.start + length) });
      }
    };
    const cancel = () => follow(null);
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    // Bound once per gesture; everything they read is in refs.
  }, [active]);

  const startDraw = (event: ReactPointerEvent, date: string) => {
    if (!editing || event.button !== 0 || (event.target as HTMLElement).closest("[data-box]")) return;
    event.preventDefault();
    const from = Math.floor(minuteAt(event.clientX, date) / SNAP) * SNAP;
    follow({ kind: "draw", date, from, to: from, x: event.clientX, y: event.clientY, moved: false });
  };
  const startMove = (event: ReactPointerEvent, session: PlacedSession) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragged.current = false;
    const offset = minuteAt(event.clientX, session.date) - minutesOf(session.start);
    follow({
      kind: "move",
      session,
      date: session.date,
      start: minutesOf(session.start),
      offset,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  };
  const startStretch = (event: ReactPointerEvent, session: PlacedSession) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragged.current = false;
    follow({ kind: "stretch", session, end: minutesOf(session.end), x: event.clientX, y: event.clientY, moved: false });
  };
  /** Where the gesture under way would put a class on this row, if anywhere. */
  const ghostOn = (date: string): { start: number; end: number } | null => {
    if (!gesture || !gesture.moved) return null;
    if (gesture.kind === "draw") {
      return gesture.date === date ? { start: Math.min(gesture.from, gesture.to), end: Math.max(gesture.from, gesture.to) } : null;
    }
    if (gesture.kind === "stretch") {
      return gesture.session.date === date ? { start: minutesOf(gesture.session.start), end: gesture.end } : null;
    }
    const length = minutesOf(gesture.session.end) - minutesOf(gesture.session.start);
    return gesture.date === date ? { start: gesture.start, end: gesture.start + length } : null;
  };
  /*
   * A class dragged in from the list: where it would land, as it will — snapped to the
   * quarter hour under the pointer, at its own length — the same box as a class moved.
   */
  const [dropAt, setDropAt] = useState<{ date: string; start: number } | null>(null);
  const dropping = dropAt !== null;
  useEffect(() => {
    if (!dropping) return;
    const clear = () => setDropAt(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dropping]);
  const dropGhost = (date: string): GridSlot | null => {
    if (!dropAt || dropAt.date !== date || !editing?.dropSlot) return null;
    return editing.dropSlot({ date, start: clock(dropAt.start), end: clock(Math.min(endMinute, dropAt.start + USUAL)) });
  };
  // Judged once per place, not at every pixel the pointer moves.
  const judged = useRef<{ key: string; result: GhostJudgement | null }>({ key: "", result: null });
  const judgeAt = (slot: GridSlot, session: PlacedSession | null): GhostJudgement | null => {
    if (!editing?.judge) return null;
    const key = `${slot.date}|${slot.start}|${slot.end}|${session ? `${session.crn}|${session.date}|${session.start}` : "dropped"}`;
    if (judged.current.key !== key) judged.current = { key, result: editing.judge(slot, session) };
    return judged.current.result;
  };
  const moving = gesture && gesture.kind !== "draw" && gesture.moved ? gesture.session : null;
  // Said from the press, before it has moved: the plan shades where the class may go as it is picked up.
  const held = gesture && gesture.kind !== "draw" ? gesture.session : null;
  useEffect(() => {
    said.current?.onHold?.(held);
  }, [held]);
  const openUnlessDragged = (picked: PlacedSession) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    editing?.onOpen(picked);
  };

  return (
    <div
      ref={box}
      className={`rounded-lg border border-[#d9dee7] bg-white ${
        fills ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"
      }`}
    >
      <div style={{ minWidth: LABEL_WIDTH + width }}>
        {/* The hours, once, across the top — under the days, when the days are side by side. */}
        <div className="sticky top-0 z-20 flex border-b border-[#e4e8ef] bg-[#fbfcfe]" style={{ height: headerHeight }}>
          <div className="sticky left-0 z-10 shrink-0 border-r border-[#e4e8ef] bg-[#fbfcfe]" style={{ width: LABEL_WIDTH }} />
          <div className="relative" style={{ width }}>
            {bands.length > 1
              ? bands.map((band, index) => {
                  const when = parseIsoDate(band ?? "");
                  return (
                    <span
                      key={band}
                      className={`absolute top-0 truncate border-l border-[#8a96a8] px-2 text-[11px] font-semibold leading-5 ${
                        band === today ? "text-[#1f4e79]" : "text-[#344054]"
                      }`}
                      style={{ left: index * bandWidth, width: bandWidth, height: DAYS_HEIGHT }}
                    >
                      {DAY_NAMES[when.getDay()]} {when.getDate()}
                    </span>
                  );
                })
              : null}
            {bands.map((band, index) => (
              <div key={band ?? "hours"} className="absolute inset-x-0 bottom-0" style={{ height: HOURS_HEIGHT }}>
                {bands.length === 1
                  ? halves
                      .filter(() => perMinute * 30 >= 40)
                      .map((minute) => (
                        <span
                          key={`h${minute}`}
                          className={`absolute top-0 ${anchored(leftOf(minute, index))} px-1 py-1 text-[10px] tabular-nums text-[#c8d0da]`}
                          style={{ left: leftOf(minute, index) }}
                        >
                          {time(minute)}
                        </span>
                      ))
                  : null}
                {labelled.map((minute) => (
                  <span
                    key={minute}
                    className={`absolute top-0 ${anchored(leftOf(minute, index))} px-1 py-1 text-[11px] font-semibold tabular-nums text-[#667085]`}
                    style={{ left: leftOf(minute, index) }}
                  >
                    {time(minute)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {laid.map(({ line, boxes, rows }, index) => (
          <div key={line.key} className={`flex border-b border-[#e4e8ef] last:border-0 ${line.today ? "bg-[#fbfdff]" : ""}`}>
            <div
              className={`sticky left-0 z-10 shrink-0 border-r border-[#e4e8ef] font-semibold text-[#344054] ${
                tight(index) ? "px-1.5 py-0 text-[10px] leading-[12px]" : "px-2 py-1.5 text-xs leading-4"
              } ${line.today ? "bg-[#fbfdff]" : "bg-white"} ${
                byRoom || tight(index) ? "flex items-start justify-between gap-1.5" : ""
              }`}
              style={{ width: LABEL_WIDTH }}
            >
              <span className="block min-w-0 truncate" title={line.title}>
                {line.title}
              </span>
              {(() => {
                // By room, what the room seats: the question a room's row is asked. Its
                // count of classes this week is on the hover.
                const seats = byRoom && line.title && seatsOf ? seatsOf(line.title) : null;
                const classes = `${line.sessions.length} class${line.sessions.length === 1 ? "" : "es"} this week`;
                return (
                  <span
                    className={`block shrink-0 font-normal tabular-nums text-[#98a2b3] ${
                      tight(index) ? "text-[10px] leading-[12px]" : "text-[11px] leading-4"
                    }`}
                    title={byRoom ? (seats !== null ? `${seats} seats · ${classes}` : `Seats not known · ${classes}`) : undefined}
                  >
                    {byRoom
                      ? seats !== null
                        ? `${seats} seats`
                        : line.sessions.length || "—"
                      : line.sessions.length === 0
                        ? "—"
                        : tight(index) || narrow
                          ? line.sessions.length
                          : `${line.sessions.length} class${line.sessions.length === 1 ? "" : "es"}`}
                  </span>
                );
              })()}
            </div>
            <div
              ref={
                editing
                  ? (node) => {
                      if (node) rowsOf.current.set(line.key, node);
                      else rowsOf.current.delete(line.key);
                    }
                  : undefined
              }
              className={`relative ${editing ? "cursor-cell touch-none" : ""}`}
              style={{ width, height: heightOf(index) + spare }}
              aria-label={editing ? `${line.title}: drag along the hours to place a class` : undefined}
              onPointerDown={editing ? (event) => startDraw(event, line.key) : undefined}
              onDragOver={
                editing?.dropType
                  ? (event) => {
                      if (!event.dataTransfer.types.includes(editing.dropType ?? "")) return;
                      event.preventDefault();
                      const start = snapped(minuteAt(event.clientX, line.key));
                      if (!Number.isFinite(start)) return;
                      if (dropAt?.date !== line.key || dropAt.start !== start) setDropAt({ date: line.key, start });
                    }
                  : undefined
              }
              onDragLeave={
                editing?.dropType
                  ? (event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      setDropAt((current) => (current?.date === line.key ? null : current));
                    }
                  : undefined
              }
              onDrop={
                editing?.dropType && editing.onDrop
                  ? (event) => {
                      setDropAt(null);
                      const data = event.dataTransfer.getData(editing.dropType ?? "");
                      if (!data) return;
                      event.preventDefault();
                      const start = snapped(minuteAt(event.clientX, line.key));
                      editing.onDrop?.(data, { date: line.key, start: clock(start), end: clock(Math.min(endMinute, start + USUAL)) });
                    }
                  : undefined
              }
            >
              {bands.map((band, index) => (
                <div key={band ?? "grid"}>
                  {quarters.map((minute) => (
                    <div key={`q${minute}`} className="absolute inset-y-0 border-l border-[#e9edf2]" style={{ left: leftOf(minute, index) }} />
                  ))}
                  {halves.map((minute) => (
                    <div key={`h${minute}`} className="absolute inset-y-0 border-l border-[#d5dbe4]" style={{ left: leftOf(minute, index) }} />
                  ))}
                  {/* Not the closing hour: that line is the grid's edge, or the next day's first. */}
                  {hours
                    .filter((minute) => minute < endMinute)
                    .map((minute) => (
                      <div key={minute} className="absolute inset-y-0 border-l border-[#aeb8c6]" style={{ left: leftOf(minute, index) }} />
                    ))}
                  {/* Where one day of the week ends and the next begins. */}
                  {index > 0 ? (
                    <div className="absolute inset-y-0 border-l-2 border-[#8a96a8]" style={{ left: index * bandWidth - 1 }} />
                  ) : null}
                </div>
              ))}
              {/* What this day's hours are to somebody: drawn behind the classes, never in their way. */}
              {shading && !byRoom
                ? shading(line.key).map((shade, at) => {
                    const from = Math.max(startMinute, minutesOf(shade.from));
                    const to = Math.min(endMinute, minutesOf(shade.to));
                    if (to <= from) return null;
                    return (
                      <div
                        key={`shade-${at}`}
                        title={shade.title}
                        data-shade={shade.tone}
                        className={`pointer-events-none absolute inset-y-0 ${SHADES[shade.tone]}`}
                        style={{ left: leftOf(from), width: (to - from) * perMinute }}
                      >
                        {shade.tone === "period" && (to - from) * perMinute > 60 ? (
                          <span className="absolute inset-x-1 top-0.5 truncate text-[10px] font-semibold text-[#8a6116]">
                            {shade.title}
                          </span>
                        ) : null}
                      </div>
                    );
                  })
                : null}
              {/*
                * And a line under each stacked class, so a row can be followed across a
                * wide week without drifting into the one above it.
                */}
              {Array.from({ length: rows - 1 }, (_, row) => (
                <div key={`r${row}`} className="absolute inset-x-0 border-t border-[#e4e8ef]" style={{ top: (row + 1) * laneOf(index) + GAP + spare / 2 }} />
              ))}
              {(() => {
                /*
                 * Where a class being drawn, moved or dragged in would land, dashed, under the
                 * pointer — red where it would clash or break a Must, amber a Would like.
                 */
                const dropped = dropGhost(line.key);
                const ghost = dropped ? { start: minutesOf(dropped.start), end: minutesOf(dropped.end) } : ghostOn(line.key);
                if (!ghost) return null;
                const carried = dropped ? null : gesture && gesture.kind !== "draw" ? gesture.session : undefined;
                const verdict =
                  carried === undefined ? null : judgeAt({ date: line.key, start: clock(ghost.start), end: clock(ghost.end) }, carried);
                const tone = GHOST_TONES[verdict?.worst ?? "none"];
                // What is wrong there, in the ⓘ's bubble beside the box, for as long as it is held there.
                return (
                  <Tip
                    open={Boolean(verdict?.worst && verdict.said)}
                    follow
                    side="top"
                    wide={false}
                    delay={0}
                    title={verdict?.label}
                    icon={Flag}
                    iconClassName={verdict?.worst === "must" ? "text-[#a6292f]" : "text-[#d99b1c]"}
                    content={<TipWishes lines={(verdict?.said ?? "").split("\n").filter(Boolean)} />}
                  >
                  <div
                    data-ghost={verdict?.worst ?? "fine"}
                    className={`pointer-events-none absolute z-10 flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border-2 border-dashed px-1.5 text-[11px] font-semibold tabular-nums ${tone}`}
                    style={{
                      left: leftOf(ghost.start),
                      width: Math.max(18, (ghost.end - ghost.start) * perMinute - 3),
                      top: GAP + spare / 2,
                      height: Math.max(14, heightOf(index) + spare - 2 * GAP - spare),
                    }}
                  >
                    {clock(ghost.start)}–{clock(ghost.end)}
                    {verdict?.label ? <span className="truncate font-normal">· {verdict.label}</span> : null}
                  </div>
                  </Tip>
                );
              })()}
              {boxes.map(({ session, lane: at, lanes, band }) => {
                const name = `${line.key}-${session.date}-${session.crn}-${session.start}-${at}`;
                return (
                  <Class
                    key={name}
                    name={name}
                    whole={wholes[name] ?? 0}
                    // On a room's row an overlap is two classes booked into one room at once.
                    session={byRoom ? { ...session, clashes: lanes > 1 } : session}
                    course={courses.get(session.crn)}
                    left={leftOf(minutesOf(session.start), band)}
                    boxWidth={Math.max(18, (minutesOf(session.end) - minutesOf(session.start)) * perMinute - 3)}
                    top={at * laneOf(index) + GAP + spare / 2}
                    height={laneOf(index) - GAP}
                    line={index}
                    onPick={editing ? openUnlessDragged : onPick}
                    clash={byRoom ? "booked into this room at the same time as another class" : "overlaps another class"}
                    seats={session.room && seatsOf ? seatsOf(session.room) : null}
                    registered={registeredOf ? registeredOf(session.crn) : null}
                    {...(editing
                      ? {
                          onGrab: (event: ReactPointerEvent) => startMove(event, session),
                          onStretch: (event: ReactPointerEvent) => startStretch(event, session),
                          dimmed: moving === session,
                        }
                      : {})}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {drawn.length === 0 ? <p className="py-3 text-center text-xs text-[#98a2b3]">{nothing}</p> : null}
    </div>
  );
}

/**
 * One class, on its side, saying what every class's box says (see ClassFacts). At the top of
 * the height zoom its row is made tall enough for that; lower down it says the whole lines
 * it has room for, in the same order, and with room for less than two, all of it on one
 * line in type that fits, as far as the box is long. The sentence is on the tooltip, as
 * everywhere else.
 *
 * It used to rank its fields by width and leave out the hour, which the box's place on
 * the page already says. The department asked for one box everywhere instead, the same
 * on the Semester Timetable as on a teacher's week and on a phone, and the hour with it.
 */
function Class({
  session,
  course,
  left,
  boxWidth,
  top,
  height,
  onPick,
  clash = "overlaps another class",
  seats = null,
  registered = null,
  line,
  name,
  whole,
  onGrab,
  onStretch,
  dimmed = false,
}: {
  session: PlacedSession;
  course?: CalendarCourse;
  left: number;
  boxWidth: number;
  top: number;
  height: number;
  onPick?: (session: PlacedSession) => void;
  /** What an overlap means here, for the tooltip. */
  clash?: string;
  /** How many its room seats, and how many the registrar has in it, where known. */
  seats?: number | null;
  /** Which row it is on, for the row's height. */
  line: number;
  /** Which box it is, and how tall all of what it says is, measured: nought until it has been. */
  name: string;
  whole: number;
  registered?: number | null;
  /** On the plan: pressed to drag it somewhere else. */
  onGrab?: (event: ReactPointerEvent) => void;
  /** On the plan: its right-hand end, pressed to make it longer or shorter. */
  onStretch?: (event: ReactPointerEvent) => void;
  /** On the plan: drawn faint while it is being dragged, its new place dashed. */
  dimmed?: boolean;
}) {
  const color = course?.color ?? "#1f4e79";
  const outline = course?.tone === "outline";
  const label = course?.label || course?.code || session.crn;
  const cancelled = session.change?.kind === "cancelled";
  const covered = session.change?.kind === "covered" ? session.change : null;
  // More registered than the room seats: the students standing at the back.
  const crowded = seats !== null && registered !== null && registered > seats;
  const details = [
    ...new Set(
      [
        label,
        course?.title,
        `CRN ${session.crn}`,
        `${session.start}–${session.end}`,
        seats !== null && session.room ? `${formatRoom(session.room)} (${seats} seats)` : formatRoom(session.room),
        course?.staff,
        course?.group,
        crowded ? `${registered} registered for ${seats} seats` : "",
        cancelled ? "CANCELLED" : "",
        covered ? `covered by ${covered.coverTeacherName}` : "",
        session.change?.note ?? "",
        session.clashes ? (session.clashSaid ?? clash) : "",
      ].filter(Boolean),
    ),
  ].join(" · ");
  const opens = Boolean(onPick && (course?.openable || onGrab));
  const Box = opens ? "button" : "article";
  // Inside its border, and then its padding: what the facts have to be drawn in.
  const inside = height - (outline ? 4 : 0);
  const lines = linesIn(inside - 4);
  // One line, the course and group, rather than the first of several: unless one is all it says.
  const oneLine = lines < 2 && !(whole > 0 && whole <= height);
  /*
   * And after them on that line the rest, as far as the box is long: the room and the
   * teacher before the hours, which the box's place under the hours already says.
   */
  const rest = [
    cancelled ? "Cancelled" : covered ? (covered.standingIn ? "Standing in" : "Covered") : "",
    crowded ? `${registered}/${seats}` : "",
    formatRoom(session.room),
    covered?.standingIn ? "" : course?.staff,
    covered ? `${covered.standingIn ? "for" : "by"} ${covered.coverTeacherName}` : "",
    `${session.start}–${session.end}`,
    `CRN ${session.crn}`,
  ].filter(Boolean);

  return (
    <Box
      type={opens ? "button" : undefined}
      onClick={opens ? () => onPick?.(session) : undefined}
      // The class, on its hover; the wishes it breaks are the flag's own.
      title={details}
      aria-label={`${opens ? `Open CRN ${session.crn}: ` : ""}${details}${session.wish ? ` · Breaks: ${session.wish.said.split("\n").join("; ")}` : ""}`}
      data-line={line}
      data-box={name}
      onPointerDown={onGrab}
      className={`absolute flex flex-col justify-center overflow-hidden px-1.5 py-0.5 text-left ${
        oneLine ? "rounded-sm" : "rounded-md"
      } ${
        outline ? "border-2 border-dashed bg-white" : "text-white"
      } ${cancelled ? "opacity-55" : ""} ${session.clashes ? "outline-2 -outline-offset-2 outline-[#d9a441]" : ""} ${
        opens ? "cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f4e79]" : ""
      } ${onGrab ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${dimmed ? "opacity-40" : ""} ${
        session.tentative ? "outline-2 outline-dashed outline-offset-1 outline-[#1f4e79]" : ""
      }`}
      style={{
        left,
        top,
        width: boxWidth,
        height,
        backgroundColor: outline ? undefined : color,
        borderColor: outline ? color : undefined,
        color: outline ? color : undefined,
      }}
    >
      {/*
        * Drawn whole even when it is hidden, since what it would take is what the row is
        * measured for: the zoom's next notch up has to know.
        */}
      <div className={oneLine ? "invisible" : "contents"}>
        <ClassFacts
          session={session}
          course={course}
          // Spaced the same whether shown or not, so it measures the same.
          lines={lines}
          aside={
            // Never dropped: a room too small is the thing to see at a glance.
            crowded ? (
              <span className="shrink-0 rounded bg-[#a6292f] px-1 py-px text-[10px] font-semibold tabular-nums text-white">
                {registered}/{seats}
              </span>
            ) : null
          }
        />
      </div>
      {/* Below a readable size there are no words, only the colour; the hover still has them all. */}
      {oneLine && height >= 7 ? (
        <span className="absolute inset-x-1 top-0 block truncate" style={{ fontSize: Math.min(11, inside - 2), lineHeight: `${inside}px` }}>
          <b className={`font-semibold ${cancelled ? "line-through" : ""}`}>{[label, course?.group].filter(Boolean).join(" · ")}</b>
          {rest.map((part, index) => (
            <span key={index} className="ml-1.5 tabular-nums opacity-90">
              {part}
            </span>
          ))}
        </span>
      ) : null}
      {session.wish ? (
        /*
         * A wish broken, in the corner: apart from the clash outline, so neither reads as the
         * other. Its bubble — the ⓘ's — opens at once, and says only what is broken.
         */
        <Tip
          delay={0}
          wide={false}
          side="right"
          title={(() => {
            const count = session.wish.said.split("\n").length;
            return `Breaks ${count === 1 ? "a preference" : `${count} preferences`}`;
          })()}
          icon={Flag}
          iconClassName={session.wish.level === "must" ? "text-[#a6292f]" : "text-[#d99b1c]"}
          content={<TipWishes lines={session.wish.said.split("\n")} />}
        >
          <span
            data-flag={session.wish.level}
            className="absolute right-0.5 top-0.5 flex items-center justify-center rounded-full bg-white p-[3px] shadow-sm ring-1 ring-black/5"
          >
            <Flag
              size={11}
              aria-hidden="true"
              className={session.wish.level === "must" ? "text-[#a6292f]" : "text-[#d99b1c]"}
              fill="currentColor"
            />
          </span>
        </Tip>
      ) : null}
      {onStretch ? (
        <span aria-hidden="true" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={onStretch} />
      ) : null}
    </Box>
  );
}
