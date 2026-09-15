import { MapPin, Repeat, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

const LABEL_WIDTH = 92;

/** Every `every` minutes across the span, or none of them when they would be too close. */
function ticks(from: number, to: number, every: number, worth: boolean): number[] {
  if (!worth) return [];
  const found: number[] = [];
  for (let minute = Math.ceil(from / every) * every; minute <= to; minute += every) found.push(minute);
  return found;
}

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
  /** How tall one class is, and so how tall a day grows when its classes stack: the height zoom. */
  rowHeight: number;
  atLeast?: { startMinute: number; endMinute: number };
  onPick?: (session: PlacedSession) => void;
  /** Take the height given and scroll inside it, rather than growing to fit the week. */
  fills?: boolean;
};

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
}: WeekTimelineProps) {
  const days = weekDays(weekStart, sessions);
  const inWeek = sessionsInRange(sessions, days[0], days[days.length - 1]);
  const { startMinute, endMinute } = hourBounds(sessions, atLeast);

  /*
   * The week is always at least as wide as the screen, and the zoom is a multiple of that.
   *
   * A teaching day is about ten hours. Asked for in pixels per minute it was narrower than
   * the screen at the low end, which left the week stopping two thirds of the way across
   * and a third of the page blank — and made the bottom of the slider do nothing, since
   * anything below screen-fill looks the same. Measured instead, one turn of the slider
   * means the same thing on every monitor. The scale stays honest either way: every minute
   * is the same number of pixels, whatever that number works out to be.
   */
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = () => setRoom(element.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const minutes = Math.max(1, endMinute - startMinute);
  // Unmeasured — the first paint, or a test — gets a workable scale rather than none.
  const screenFit = room > 0 ? (room - LABEL_WIDTH) / minutes : 1.6;
  const perMinute = screenFit * Math.max(1, widthZoom);
  const width = minutes * perMinute;
  const hours: number[] = [];
  for (let minute = Math.ceil(startMinute / 60) * 60; minute <= endMinute; minute += 60) hours.push(minute);
  /*
   * Three weights of line, so the eye can judge a start time without running back to the
   * header: the hour, the half, the quarter. Each tier is dropped once its lines are
   * closer together than the width at which they stop being a scale and become hatching.
   */
  const halves = ticks(startMinute, endMinute, 30, perMinute * 30 >= 18).filter((minute) => minute % 60 !== 0);
  const quarters = ticks(startMinute, endMinute, 15, perMinute * 15 >= 13).filter((minute) => minute % 30 !== 0);
  const leftOf = (minute: number) => (minute - startMinute) * perMinute;

  return (
    <div
      ref={box}
      className={`rounded-lg border border-[#d9dee7] bg-white ${
        fills ? "min-h-0 flex-1 overflow-auto" : "overflow-x-auto"
      }`}
    >
      <div style={{ minWidth: LABEL_WIDTH + width }}>
        {/* The hours, once, across the top. */}
        <div className="sticky top-0 z-20 flex border-b border-[#e4e8ef] bg-[#fbfcfe]">
          <div className="sticky left-0 z-10 shrink-0 border-r border-[#e4e8ef] bg-[#fbfcfe]" style={{ width: LABEL_WIDTH }} />
          <div className="relative" style={{ width }}>
            {halves
              .filter(() => perMinute * 30 >= 40)
              .map((minute) => (
                <span
                  key={`h${minute}`}
                  className="absolute top-0 -translate-x-1/2 px-1 py-1 text-[10px] tabular-nums text-[#c8d0da]"
                  style={{ left: leftOf(minute) }}
                >
                  {String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}
                </span>
              ))}
            {hours.map((minute) => (
              <span
                key={minute}
                className="absolute top-0 -translate-x-1/2 px-1 py-1 text-[11px] font-semibold tabular-nums text-[#667085]"
                style={{ left: leftOf(minute) }}
              >
                {String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}
              </span>
            ))}
            <span className="invisible block py-1 text-[11px]">0</span>
          </div>
        </div>

        {days.map((day) => {
          const onThisDay = sessionsOnDay(inWeek, day);
          const laned = laneOut(onThisDay);
          const deep = laned.reduce((most, { lane }) => Math.max(most, lane + 1), 0);
          const rows = Math.max(1, deep);
          const date = parseIsoDate(day);
          return (
            <div key={day} className={`flex border-b border-[#e4e8ef] last:border-0 ${day === today ? "bg-[#fbfdff]" : ""}`}>
              <div
                className={`sticky left-0 z-10 shrink-0 border-r border-[#e4e8ef] px-2 py-2 text-xs font-semibold text-[#344054] ${
                  day === today ? "bg-[#fbfdff]" : "bg-white"
                }`}
                style={{ width: LABEL_WIDTH }}
              >
                {DAY_NAMES[date.getDay()]} {date.getDate()}
                <span className="block text-[11px] font-normal tabular-nums text-[#98a2b3]">
                  {onThisDay.length === 0 ? "—" : `${onThisDay.length} class${onThisDay.length === 1 ? "" : "es"}`}
                </span>
              </div>
              <div className="relative" style={{ width, height: rows * rowHeight + 6 }}>
                {quarters.map((minute) => (
                  <div key={`q${minute}`} className="absolute inset-y-0 border-l border-[#e9edf2]" style={{ left: leftOf(minute) }} />
                ))}
                {halves.map((minute) => (
                  <div key={`h${minute}`} className="absolute inset-y-0 border-l border-[#d5dbe4]" style={{ left: leftOf(minute) }} />
                ))}
                {hours.map((minute) => (
                  <div key={minute} className="absolute inset-y-0 border-l border-[#aeb8c6]" style={{ left: leftOf(minute) }} />
                ))}
                {/*
                  * And a line under each stacked class, so a row can be followed across a
                  * wide week without drifting into the one above it.
                  */}
                {Array.from({ length: rows - 1 }, (_, row) => (
                  <div
                    key={`r${row}`}
                    className="absolute inset-x-0 border-t border-[#e4e8ef]"
                    style={{ top: (row + 1) * rowHeight + 3 }}
                  />
                ))}
                {laned.map(({ session, lane }) => (
                  <Class
                    key={`${day}-${session.crn}-${session.start}-${lane}`}
                    session={session}
                    course={courses.get(session.crn)}
                    left={leftOf(minutesOf(session.start))}
                    boxWidth={Math.max(18, (minutesOf(session.end) - minutesOf(session.start)) * perMinute - 3)}
                    top={lane * rowHeight + 3}
                    height={rowHeight - 3}
                    onPick={onPick}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {inWeek.length === 0 ? <p className="py-3 text-center text-xs text-[#98a2b3]">No classes this week.</p> : null}
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
}: {
  session: PlacedSession;
  course?: CalendarCourse;
  left: number;
  boxWidth: number;
  top: number;
  height: number;
  onPick?: (session: PlacedSession) => void;
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
        session.clashes ? "overlaps another class" : "",
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
