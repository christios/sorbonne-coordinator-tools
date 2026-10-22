import { MapPin, Repeat, User } from "lucide-react";
import type { ReactNode } from "react";

import { formatRoom, type CalendarCourse, type PlacedSession } from "@/services/weekSchedule";

/**
 * What a class's box says, the same on every calendar of the app.
 *
 * Each calendar used to decide for itself what fitted: the week grid gave a box as many
 * lines as its height allowed, the small one on a record printed the course code and
 * nothing else, and the Semester Timetable ranked its fields by width. A one-hour class on
 * a phone said its course and its hour, and which group it was, where, and who taught it
 * were on a hover a phone does not have.
 *
 *   course · group   [mark]   hours   room   teacher   CRN
 *
 * Every field is always printed, in that order, as text that wraps: a wide box says it in
 * a line or two, a narrow one in more. The calendars measure what this takes and make
 * their hours (or rows) tall enough for it — `data-facts` is what they measure.
 */
export function ClassFacts({
  session,
  course,
  small = false,
  aside,
}: {
  session: PlacedSession;
  course?: CalendarCourse;
  /** The small calendar on a record, a quarter of the size. */
  small?: boolean;
  /** Said beside the name and never dropped: a room too small for its class, on the Semester Timetable. */
  aside?: ReactNode;
}) {
  const label = course?.label || course?.code || session.crn;
  const outline = course?.tone === "outline";
  const cancelled = session.change?.kind === "cancelled";
  const covered = session.change?.kind === "covered" ? session.change : null;
  const room = formatRoom(session.room);
  const icon = small ? 7 : 9;
  const mark = `shrink-0 rounded px-1 font-bold uppercase tracking-wide ${small ? "text-[7px]" : "text-[9px]"} ${
    outline ? "bg-current/15" : "bg-white/30"
  }`;
  return (
    <div
      data-facts
      className={`flex shrink-0 flex-wrap content-start items-center gap-x-1.5 ${
        small ? "gap-y-0 text-[8.5px] leading-[1.25]" : "gap-y-px text-[11px] leading-tight"
      }`}
    >
      <b className={`font-semibold ${cancelled ? "line-through" : ""}`}>{[label, course?.group].filter(Boolean).join(" · ")}</b>
      {cancelled ? (
        <span className={mark}>Cancelled</span>
      ) : covered ? (
        // Whose class it is decides the word: they are standing in, or theirs was taken.
        <span className={mark}>{covered.standingIn ? "Standing in" : "Covered"}</span>
      ) : null}
      {aside}
      <span className="whitespace-nowrap tabular-nums opacity-90">
        {session.start}–{session.end}
      </span>
      {room ? (
        <span className="inline-flex items-center gap-0.5 opacity-90">
          <MapPin size={icon} className="shrink-0" aria-hidden="true" />
          <span>{room}</span>
        </span>
      ) : null}
      {/* On a stand-in's week the section's own teacher IS the "for" line below; once is enough. */}
      {course?.staff && !covered?.standingIn ? (
        <span className="inline-flex items-center gap-0.5 opacity-90">
          <User size={icon} className="shrink-0" aria-hidden="true" />
          <span>{course.staff}</span>
        </span>
      ) : null}
      {covered ? (
        <span className="inline-flex items-center gap-0.5 font-semibold">
          <Repeat size={icon} className="shrink-0" aria-hidden="true" />
          <span>{covered.standingIn ? `for ${covered.coverTeacherName}` : `by ${covered.coverTeacherName}`}</span>
        </span>
      ) : null}
      <span className="whitespace-nowrap tabular-nums opacity-80">CRN {session.crn}</span>
    </div>
  );
}
