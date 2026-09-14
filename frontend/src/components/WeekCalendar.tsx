import { MapPin, Repeat, User } from "lucide-react";
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
const TOP_PADDING = 10;

type WeekCalendarProps = {
  weekStart: Date;
  sessions: PlacedSession[];
  courses: Map<string, CalendarCourse>;
  today: string;
  /** Pixels per hour. 48 reads well full size; a card's preview takes half. */
  hourHeight?: number;
  /** The hours always drawn, whatever the week holds. */
  atLeast?: HourBounds;
  /**
   * A preview: a quarter of the size, boxes carrying their name and nothing else, and
   * always the whole week — the one-day view is for a phone, not for a thumbnail.
   */
  compact?: boolean;
  /** Pressing a box. Only boxes whose course says `openable` are buttons. */
  onPick?: (session: PlacedSession) => void;
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
export function WeekCalendar({
  weekStart,
  sessions,
  courses,
  today,
  hourHeight = 48,
  atLeast,
  compact = false,
  onPick,
}: WeekCalendarProps) {
  const days = weekDays(weekStart, sessions);
  const inWeek = sessionsInRange(sessions, days[0], days[days.length - 1]);
  const { startMinute, endMinute } = hourBounds(sessions, atLeast);
  const pixelsPerMinute = hourHeight / 60;
  const height = (endMinute - startMinute) * pixelsPerMinute + TOP_PADDING * 2;
  const hours: number[] = [];
  for (let minute = startMinute; minute <= endMinute; minute += 60) hours.push(minute);
  const topOf = (minute: number) => (minute - startMinute) * pixelsPerMinute + TOP_PADDING;
  const gutter = compact ? 30 : 44;
  const narrowestDay = compact ? 56 : 88;

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
  const oneDayAtATime = !compact && width > 0 && width < ONE_DAY_BELOW;

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
            gridTemplateColumns: `${gutter}px repeat(${visibleDays.length}, minmax(0, 1fr))`,
            minWidth: oneDayAtATime ? undefined : gutter + visibleDays.length * narrowestDay,
          }}
        >
          <div className="border-b border-[#e4e8ef] bg-[#fbfcfe]" />
          {visibleDays.map((day) => (
            <div
              key={day}
              className={`border-b border-l border-[#e4e8ef] bg-[#fbfcfe] text-center font-semibold ${
                compact ? "px-0.5 py-0.5 text-[9.5px]" : "px-1 py-1.5 text-xs"
              } ${day === today ? "text-[#1f4e79]" : "text-[#344054]"}`}
            >
              {DAY_NAMES[parseIsoDate(day).getDay()]}
              <span className={`block font-normal text-[#98a2b3] ${compact ? "text-[8.5px]" : "text-[11px]"}`}>
                {formatDayAndMonth(day)}
              </span>
            </div>
          ))}

          <div className="relative" style={{ height }}>
            {hours.map((minute) => (
              <span
                key={minute}
                className={`absolute right-1 -translate-y-1/2 tabular-nums text-[#98a2b3] ${compact ? "text-[8px]" : "text-[10.5px]"}`}
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
              compact={compact}
              onPick={onPick}
            />
          ))}
        </div>
      </div>

      {oneDayAtATime && sessionsOnDay(inWeek, shownDay).length === 0 ? (
        <p className="mt-2 text-center text-xs text-[#98a2b3]">No classes on {formatLongDate(shownDay)}.</p>
      ) : null}
      {!oneDayAtATime && inWeek.length === 0 ? (
        <p className={`mt-1.5 text-center text-[#98a2b3] ${compact ? "text-[10px]" : "text-xs"}`}>No classes this week.</p>
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
  compact: boolean;
  onPick?: (session: PlacedSession) => void;
};

function DayColumn({ day, sessions, courses, height, hours, topOf, pixelsPerMinute, compact, onPick }: DayColumnProps) {
  return (
    <div className="relative border-l border-[#e4e8ef]" style={{ height }}>
      {hours.slice(1, -1).map((minute) => (
        <div key={minute} className="absolute inset-x-0 border-t border-[#eef1f5]" style={{ top: topOf(minute) }} />
      ))}
      {laneOut(sessions).map(({ session, lane, lanes }) => {
        const course = courses.get(session.crn);
        const minutes = minutesOf(session.end) - minutesOf(session.start);
        const boxHeight = Math.max(compact ? 12 : 22, minutes * pixelsPerMinute - 2);
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
              course?.code,
              `CRN ${session.crn}`,
              `${session.start}–${session.end}`,
              formatRoom(session.room),
              course?.staff,
              cancelled ? "CANCELLED" : "",
              covered ? `covered by ${covered.coverTeacherName}` : "",
              session.change?.note ?? "",
              outline ? "in their group, not registered" : "",
              session.clashes ? "overlaps another class" : "",
            ].filter(Boolean),
          ),
        ].join(" · ");
        const widthPercent = 100 / lanes;
        const opens = Boolean(onPick && course?.openable);
        const Box = opens ? "button" : "article";

        /*
         * What fits, by height, from the top down: the name, the hour, the room, the
         * teacher. A box too short for a line drops the line rather than clipping it
         * halfway, and the whole story is always in the tooltip.
         */
        const lines = compact ? 0 : boxHeight >= 66 ? 4 : boxHeight >= 50 ? 3 : boxHeight >= 34 ? 2 : 1;

        return (
          <Box
            key={`${day}-${session.crn}-${session.start}-${lane}`}
            type={opens ? "button" : undefined}
            onClick={opens ? () => onPick?.(session) : undefined}
            title={details}
            aria-label={opens ? `Open CRN ${session.crn}: ${details}` : details}
            className={`absolute flex flex-col overflow-hidden rounded-md text-left leading-tight ${
              compact ? "px-1 py-px text-[8.5px]" : "px-1.5 py-1 text-[11px]"
            } ${outline ? "border-2 border-dashed bg-white" : "text-white"} ${cancelled ? "opacity-55" : ""} ${
              session.clashes ? "outline-2 -outline-offset-2 outline-[#d9a441]" : ""
            } ${opens ? "cursor-pointer hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1f4e79]" : ""}`}
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
            {compact ? (
              <b className={`flex items-center gap-0.5 font-semibold ${cancelled ? "line-through" : ""}`}>
                {covered ? <Repeat size={8} className="shrink-0" aria-hidden="true" /> : null}
                <span className="truncate">{label}</span>
              </b>
            ) : (
              <>
                <b className="flex items-baseline justify-between gap-1 font-semibold">
                  <span className={`truncate ${cancelled ? "line-through" : ""}`}>{label}</span>
                  {cancelled ? (
                    <span className="shrink-0 rounded bg-white/25 px-1 text-[9px] font-bold uppercase tracking-wide">Cancelled</span>
                  ) : lines === 1 ? (
                    <span className="shrink-0 text-[10px] font-normal tabular-nums opacity-85">{session.start}</span>
                  ) : null}
                </b>
                {lines >= 2 ? (
                  <span className="block tabular-nums opacity-90">
                    {session.start}–{session.end}
                  </span>
                ) : null}
                {lines >= 3 && session.room ? (
                  <span className="mt-0.5 flex items-center gap-1 truncate opacity-85">
                    <MapPin size={9} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{formatRoom(session.room)}</span>
                  </span>
                ) : null}
                {/* Cover outranks the planned teacher for the line: it is who was in the room. */}
                {covered && lines >= 3 ? (
                  <span className="flex items-center gap-1 truncate font-semibold">
                    <Repeat size={9} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{covered.coverTeacherName}</span>
                  </span>
                ) : lines >= 4 && course?.staff ? (
                  <span className="flex items-center gap-1 truncate opacity-85">
                    <User size={9} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{course.staff}</span>
                  </span>
                ) : null}
              </>
            )}
          </Box>
        );
      })}
    </div>
  );
}
