import { useEffect, useRef, useState } from "react";

import {
  DAY_NAMES,
  formatDayAndMonth,
  formatLongDate,
  formatRoom,
  hourBounds,
  laneOut,
  minutesOf,
  parseIsoDate,
  preferredDay,
  sessionsInRange,
  sessionsOnDay,
  weekDays,
  type CalendarCourse,
  type HourBounds,
  type PlacedSession,
} from "@/services/weekSchedule";

/** Narrower than this, the week is shown one day at a time behind a row of day buttons. */
const ONE_DAY_BELOW = 520;
/** The least a day column may be before the week scrolls sideways instead of squeezing. */
const NARROWEST_DAY = 88;
const TOP_PADDING = 10;

type WeekCalendarProps = {
  weekStart: Date;
  sessions: PlacedSession[];
  courses: Map<string, CalendarCourse>;
  today: string;
  /** Pixels per hour. 44 reads well in a card; a full page can take more. */
  hourHeight?: number;
  /** The hours always drawn, whatever the week holds. */
  atLeast?: HourBounds;
};

/**
 * One week as a grid — the SCEN Student Hub's, made to fit wherever it is put.
 *
 * The Hub draws it once, full width, for one student on their own phone or laptop, and
 * decides between a week and a day from the screen. Here it sits inside a record's card,
 * beside other cards, in a dialog of whatever width the coordinator gave the window — so
 * it measures the box it was put in rather than the screen, and takes its hours from the
 * sessions rather than from a fixed teaching day. Everything overlapping is drawn side by
 * side, since a course's calendar holds every group's tutorial at once and on top of each
 * other they would read as one class.
 */
export function WeekCalendar({ weekStart, sessions, courses, today, hourHeight = 44, atLeast }: WeekCalendarProps) {
  const days = weekDays(weekStart, sessions);
  const inWeek = sessionsInRange(sessions, days[0], days[days.length - 1]);
  const { startMinute, endMinute } = hourBounds(sessions, atLeast);
  const pixelsPerMinute = hourHeight / 60;
  const height = (endMinute - startMinute) * pixelsPerMinute + TOP_PADDING * 2;
  const hours: number[] = [];
  for (let minute = startMinute; minute <= endMinute; minute += 60) hours.push(minute);
  const topOf = (minute: number) => (minute - startMinute) * pixelsPerMinute + TOP_PADDING;

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const read = () => setWidth(element.getBoundingClientRect().width);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Unmeasured — the first paint, or a test — is drawn as a week, which is the honest default.
  const oneDayAtATime = width > 0 && width < ONE_DAY_BELOW;

  const [focusedDay, setFocusedDay] = useState(() => preferredDay(days, sessions, today));
  const weekKey = days[0];
  useEffect(() => {
    setFocusedDay((current) => (days.includes(current) ? current : preferredDay(days, sessions, today)));
    // Only re-aim when the displayed week changes; `days` is derived from weekStart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);
  const shownDay = days.includes(focusedDay) ? focusedDay : preferredDay(days, sessions, today);
  const visibleDays = oneDayAtATime ? [shownDay] : days;

  return (
    <div ref={box}>
      {oneDayAtATime ? (
        <div className="mb-2 flex gap-1" role="group" aria-label="Day of the week">
          {days.map((day) => {
            const count = sessionsOnDay(inWeek, day).length;
            const selected = day === shownDay;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={selected}
                onClick={() => setFocusedDay(day)}
                className={`flex-1 rounded-md border px-1 py-1 text-center text-xs font-semibold ${
                  selected ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#667085]"
                }`}
              >
                {DAY_NAMES[parseIsoDate(day).getDay()]}
                <span className="block text-[11px] font-normal tabular-nums opacity-80">{parseIsoDate(day).getDate()}</span>
                <span
                  aria-hidden
                  className={`mx-auto mt-1 block size-1 rounded-full ${count === 0 ? "bg-transparent" : selected ? "bg-white" : "bg-[#1f4e79]"}`}
                />
                <span className="sr-only">{count === 0 ? "no classes" : `${count} session${count > 1 ? "s" : ""}`}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={oneDayAtATime ? "" : "overflow-x-auto pb-1"}>
        <div
          className="grid overflow-hidden rounded-lg border border-[#d9dee7] bg-white"
          style={{
            gridTemplateColumns: `44px repeat(${visibleDays.length}, minmax(0, 1fr))`,
            minWidth: oneDayAtATime ? undefined : 44 + visibleDays.length * NARROWEST_DAY,
          }}
        >
          <div className="border-b border-[#e4e8ef] bg-[#fbfcfe]" />
          {visibleDays.map((day) => (
            <div
              key={day}
              className={`border-b border-l border-[#e4e8ef] bg-[#fbfcfe] px-1 py-1.5 text-center text-xs font-semibold ${
                day === today ? "text-[#1f4e79]" : "text-[#344054]"
              }`}
            >
              {DAY_NAMES[parseIsoDate(day).getDay()]}
              <span className="block text-[11px] font-normal text-[#98a2b3]">{formatDayAndMonth(day)}</span>
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((minute) => (
              <span
                key={minute}
                className="absolute right-1.5 -translate-y-1/2 text-[10.5px] tabular-nums text-[#98a2b3]"
                style={{ top: topOf(minute) }}
              >
                {`${minute / 60}`.padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {visibleDays.map((day) => (
            <DayColumn
              key={day}
              day={day}
              sessions={sessionsOnDay(inWeek, day)}
              courses={courses}
              height={height}
              hours={hours}
              topOf={topOf}
              pixelsPerMinute={pixelsPerMinute}
              roomy={oneDayAtATime}
            />
          ))}
        </div>
      </div>

      {oneDayAtATime && sessionsOnDay(inWeek, shownDay).length === 0 ? (
        <p className="mt-2 text-center text-xs text-[#98a2b3]">No classes on {formatLongDate(shownDay)}.</p>
      ) : null}
      {!oneDayAtATime && inWeek.length === 0 ? (
        <p className="mt-2 text-center text-xs text-[#98a2b3]">No classes this week.</p>
      ) : null}
    </div>
  );
}

type DayColumnProps = {
  day: string;
  sessions: PlacedSession[];
  courses: Map<string, CalendarCourse>;
  height: number;
  hours: number[];
  topOf: (minute: number) => number;
  pixelsPerMinute: number;
  roomy: boolean;
};

function DayColumn({ day, sessions, courses, height, hours, topOf, pixelsPerMinute, roomy }: DayColumnProps) {
  return (
    <div className="relative border-l border-[#e4e8ef]" style={{ height }}>
      {hours.slice(1, -1).map((minute) => (
        <div key={minute} className="absolute inset-x-0 border-t border-[#eef1f5]" style={{ top: topOf(minute) }} />
      ))}
      {laneOut(sessions).map(({ session, lane, lanes }) => {
        const course = courses.get(session.crn);
        const minutes = minutesOf(session.end) - minutesOf(session.start);
        const boxHeight = Math.max(22, minutes * pixelsPerMinute - 2);
        const oneLine = boxHeight < 36;
        const color = course?.color ?? "#1f4e79";
        const outline = course?.tone === "outline";
        const details = [
          ...new Set(
            [
              course?.label,
              course?.title,
              course?.code,
              `CRN ${session.crn}`,
              `${session.start}–${session.end}`,
              formatRoom(session.room),
              course?.staff,
              outline ? "in their group, not registered" : "",
              session.clashes ? "overlaps another class" : "",
            ].filter(Boolean),
          ),
        ].join(" · ");
        const widthPercent = 100 / lanes;

        return (
          <article
            key={`${day}-${session.crn}-${session.start}-${lane}`}
            title={details}
            aria-label={details}
            className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 leading-tight ${
              roomy ? "text-xs" : "text-[11px]"
            } ${outline ? "border-2 border-dashed bg-white" : "text-white"} ${
              session.clashes ? "outline-2 -outline-offset-2 outline-[#d9a441]" : ""
            }`}
            style={{
              top: topOf(minutesOf(session.start)),
              height: boxHeight,
              left: `calc(${lane * widthPercent}% + 2px)`,
              width: `calc(${widthPercent}% - 4px)`,
              backgroundColor: outline ? undefined : color,
              borderColor: outline ? color : undefined,
              color: outline ? color : undefined,
            }}
          >
            <b className="block truncate font-semibold">
              {course?.label || course?.code || session.crn}
              {oneLine ? <span className="ml-1 font-normal opacity-85">{session.start}</span> : null}
            </b>
            {oneLine ? null : (
              <>
                <span className="block truncate opacity-90">
                  {session.start}–{session.end}
                </span>
                {boxHeight >= 52 && session.room ? (
                  <span className="block truncate opacity-80">{formatRoom(session.room)}</span>
                ) : null}
                {roomy && course?.staff && boxHeight >= 68 ? (
                  <span className="block truncate opacity-80">{course.staff}</span>
                ) : null}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
