import { MapPin, Repeat, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

/** A room as the grid names it, or "" for a class the portal has put in none. */
const roomOf = (session: { room: string }) => formatRoom(session.room).trim();

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
   * How tall one class is at least: the height zoom. A filling grid grows its classes past
   * it until the rows take the whole screen.
   */
  rowHeight: number;
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
  rowHeight,
  atLeast,
  onPick,
  fills = false,
  rowsBy = "day",
  day,
}: WeekTimelineProps) {
  const days = weekDays(weekStart, sessions);
  const inWeek = sessionsInRange(sessions, days[0], days[days.length - 1]);
  // The whole semester's hours, so the scale holds still as the weeks go by.
  const { startMinute, endMinute } = hourBounds(sessions, atLeast);
  const byRoom = rowsBy === "room";
  const { width: LABEL_WIDTH, height: LABEL_HEIGHT } = LABEL[rowsBy];
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
    ? [...new Set(sessions.map(roomOf))]
        .sort((a, b) => (a ? (b ? a.localeCompare(b, undefined, { numeric: true }) : -1) : 1))
        .map((room) => ({
          key: room || "none",
          title: room || "No room",
          today: false,
          sessions: drawn.filter((session) => roomOf(session) === room),
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
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = () => setRoom({ width: element.clientWidth, height: element.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const minutes = Math.max(1, endMinute - startMinute);
  // Unmeasured — the first paint, or a test — gets a workable scale rather than none.
  const screenFit = room.width > 0 ? (room.width - LABEL_WIDTH) / (minutes * bands.length) : 1.6;
  const perMinute = screenFit * Math.max(1, widthZoom);
  const bandWidth = minutes * perMinute;
  const width = bandWidth * bands.length;
  const headerHeight = HOURS_HEIGHT + (bands.length > 1 ? DAYS_HEIGHT : 0);
  const lane = fills
    ? fittedRowHeight(room.height - headerHeight - 1, laid.map(({ rows }) => rows), rowHeight, LABEL_HEIGHT)
    : rowHeight;

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
  const nothing = byRoom && day ? "No classes this day." : "No classes this week.";

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
                          className="absolute top-0 -translate-x-1/2 px-1 py-1 text-[10px] tabular-nums text-[#c8d0da]"
                          style={{ left: leftOf(minute, index) }}
                        >
                          {time(minute)}
                        </span>
                      ))
                  : null}
                {labelled.map((minute) => (
                  <span
                    key={minute}
                    className="absolute top-0 -translate-x-1/2 px-1 py-1 text-[11px] font-semibold tabular-nums text-[#667085]"
                    style={{ left: leftOf(minute, index) }}
                  >
                    {time(minute)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {laid.map(({ line, boxes, rows }) => (
          <div key={line.key} className={`flex border-b border-[#e4e8ef] last:border-0 ${line.today ? "bg-[#fbfdff]" : ""}`}>
            <div
              className={`sticky left-0 z-10 shrink-0 border-r border-[#e4e8ef] px-2 py-1.5 text-xs font-semibold leading-4 text-[#344054] ${
                line.today ? "bg-[#fbfdff]" : "bg-white"
              } ${byRoom ? "flex items-start justify-between gap-1.5" : ""}`}
              style={{ width: LABEL_WIDTH }}
            >
              <span className="block min-w-0 truncate" title={line.title}>
                {line.title}
              </span>
              <span
                className="block shrink-0 text-[11px] font-normal leading-4 tabular-nums text-[#98a2b3]"
                title={byRoom ? `${line.sessions.length} class${line.sessions.length === 1 ? "" : "es"}` : undefined}
              >
                {line.sessions.length === 0
                  ? "—"
                  : byRoom
                    ? line.sessions.length
                    : `${line.sessions.length} class${line.sessions.length === 1 ? "" : "es"}`}
              </span>
            </div>
            <div className="relative" style={{ width, height: Math.max(LABEL_HEIGHT, rows * lane + 6) }}>
              {bands.map((band, index) => (
                <div key={band ?? "grid"}>
                  {quarters.map((minute) => (
                    <div key={`q${minute}`} className="absolute inset-y-0 border-l border-[#e9edf2]" style={{ left: leftOf(minute, index) }} />
                  ))}
                  {halves.map((minute) => (
                    <div key={`h${minute}`} className="absolute inset-y-0 border-l border-[#d5dbe4]" style={{ left: leftOf(minute, index) }} />
                  ))}
                  {hours.map((minute) => (
                    <div key={minute} className="absolute inset-y-0 border-l border-[#aeb8c6]" style={{ left: leftOf(minute, index) }} />
                  ))}
                  {/* Where one day of the week ends and the next begins. */}
                  {index > 0 ? (
                    <div className="absolute inset-y-0 border-l-2 border-[#8a96a8]" style={{ left: index * bandWidth - 1 }} />
                  ) : null}
                </div>
              ))}
              {/*
                * And a line under each stacked class, so a row can be followed across a
                * wide week without drifting into the one above it.
                */}
              {Array.from({ length: rows - 1 }, (_, row) => (
                <div key={`r${row}`} className="absolute inset-x-0 border-t border-[#e4e8ef]" style={{ top: (row + 1) * lane + 3 }} />
              ))}
              {boxes.map(({ session, lane: at, lanes, band }) => (
                <Class
                  key={`${line.key}-${session.date}-${session.crn}-${session.start}-${at}`}
                  // On a room's row an overlap is two classes booked into one room at once.
                  session={byRoom ? { ...session, clashes: lanes > 1 } : session}
                  course={courses.get(session.crn)}
                  left={leftOf(minutesOf(session.start), band)}
                  boxWidth={Math.max(18, (minutesOf(session.end) - minutesOf(session.start)) * perMinute - 3)}
                  top={at * lane + 3}
                  height={lane - 3}
                  onPick={onPick}
                  clash={byRoom ? "booked into this room at the same time as another class" : "overlaps another class"}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {drawn.length === 0 ? <p className="py-3 text-center text-xs text-[#98a2b3]">{nothing}</p> : null}
    </div>
  );
}

/**
 * What a box can say at the width it has, decided rather than clipped.
 *
 * Letting the overflow rule it looked the same at a glance and read much worse: a box
 * clipped mid-field shows "5.1" for a room and half a surname, which is not less
 * information but wrong information. So the fields are ranked and a box takes as many as
 * it can hold whole.
 *
 * The order is the coordinator's, and the notable thing about it is what is NOT in it. The
 * HOUR is not a field here. On this grid the hour is the box's position — that is the whole
 * point of turning the week on its side — so printing it inside the box spends the scarcest
 * thing on the page to repeat what the page has already said. What you cannot read off the
 * position is which group of ours the class is, and that is second.
 *
 *   course · group · room · teacher
 *
 * The widths are what the fields actually take, added up: a course code runs about 62px, a
 * group label 56, a room 52, a name 90, with a 6px gap between each and 12px of padding
 * round the lot. A first attempt guessed them low, and the box admitted fields it had no
 * space for and paid for them out of the course code, which came out as "MATH-…".
 */
function fieldsFor(width: number, height: number): { group: boolean; room: boolean; staff: boolean; tall: boolean } {
  /*
   * Height buys a second line, and a second line is a fresh width to spend.
   *
   * Without it the height slider bought nothing but white space: the box grew and went on
   * saying the same one field, so dragging it did not answer the question it looked like
   * it was answering. Tall enough for two lines, the course and the group take the first
   * and the room and the teacher take the second.
   */
  const tall = height >= 30;
  if (tall) return { group: width >= 124, room: width >= 70, staff: width >= 128, tall };
  return { group: width >= 124, room: width >= 182, staff: width >= 278, tall };
}

/**
 * One class, on its side. The whole sentence is on the tooltip whatever the width, as it
 * is everywhere else here.
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
}) {
  const color = course?.color ?? "#1f4e79";
  const outline = course?.tone === "outline";
  const label = course?.label || course?.code || session.crn;
  const cancelled = session.change?.kind === "cancelled";
  const covered = session.change?.kind === "covered" ? session.change : null;
  const details = [
    ...new Set(
      [
        label,
        course?.title,
        `CRN ${session.crn}`,
        `${session.start}–${session.end}`,
        formatRoom(session.room),
        course?.staff,
        course?.group,
        cancelled ? "CANCELLED" : "",
        covered ? `covered by ${covered.coverTeacherName}` : "",
        session.change?.note ?? "",
        session.clashes ? clash : "",
      ].filter(Boolean),
    ),
  ].join(" · ");
  const opens = Boolean(onPick && course?.openable);
  const Box = opens ? "button" : "article";
  const room = formatRoom(session.room);
  const fits = fieldsFor(boxWidth, height);

  return (
    <Box
      type={opens ? "button" : undefined}
      onClick={opens ? () => onPick?.(session) : undefined}
      title={details}
      aria-label={opens ? `Open CRN ${session.crn}: ${details}` : details}
      className={`absolute flex overflow-hidden rounded-md px-1.5 text-left text-[11px] leading-none ${
        fits.tall ? "flex-col justify-center gap-0.5 py-0.5" : "items-center gap-1.5"
      } ${
        outline ? "border-2 border-dashed bg-white" : "text-white"
      } ${cancelled ? "opacity-55" : ""} ${session.clashes ? "outline-2 -outline-offset-2 outline-[#d9a441]" : ""} ${
        opens ? "cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f4e79]" : ""
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
      <span className={`flex min-w-0 items-center gap-1.5 ${fits.tall ? "w-full" : ""}`}>
        {covered ? <Repeat size={9} className="shrink-0" aria-hidden="true" /> : null}
        {/* Never dropped: a box with no name on it says nothing at all. */}
        <b className={`min-w-0 shrink-0 truncate font-semibold ${cancelled ? "line-through" : ""}`}>{label}</b>
        {fits.group && course?.group ? (
          <span className="shrink-0 rounded bg-white/25 px-1 font-medium">{course.group}</span>
        ) : null}
        {!fits.tall && fits.room && room ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 opacity-85">
            <MapPin size={9} aria-hidden="true" />
            {room}
          </span>
        ) : null}
        {!fits.tall && fits.staff && course?.staff ? (
          <span className="inline-flex min-w-0 items-center gap-0.5 opacity-85">
            <User size={9} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{course.staff}</span>
          </span>
        ) : null}
      </span>
      {fits.tall && ((fits.room && room) || (fits.staff && course?.staff)) ? (
        <span className="flex w-full min-w-0 items-center gap-1.5 opacity-85">
          {fits.room && room ? (
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <MapPin size={9} aria-hidden="true" />
              {room}
            </span>
          ) : null}
          {fits.staff && course?.staff ? (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <User size={9} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{course.staff}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </Box>
  );
}
