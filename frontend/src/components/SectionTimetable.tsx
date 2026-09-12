import { useQueries } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { WeekCalendar } from "@/components/WeekCalendar";
import { fetchFacilitySections, type FacilitySection } from "@/services/portalLists";
import {
  assignColors,
  defaultWeekStart,
  isoToday,
  placeSessions,
  shiftWeek,
  weekLabel,
  type CalendarCourse,
  type Session,
} from "@/services/weekSchedule";

/** One section a calendar should show, and how to name and paint it. */
export type TimetableEntry = {
  /** The portal term the sweep is filed under. Empty when no semester is linked to one. */
  termCode: string;
  crn: string;
  code: string;
  title: string;
  /** The words in the box; the course code when left out. */
  label?: string;
  staff?: string;
  tone?: "solid" | "outline";
  /** What shares a colour. The course code when left out; a course's own calendar passes the CRN. */
  colorKey?: string;
};

/**
 * The registrar's timetable for a handful of sections: a student's, a teacher's, a
 * course's, one CRN's.
 *
 * Asked of the sweep, never of anything we planned: what this shows is when the registrar
 * has actually booked a room, which is the only thing a person can turn up to. The sweep
 * is honest about what it does not know, and so is this — a section nobody has asked the
 * registrar about is named under the grid rather than left off it, because a calendar is
 * read for its gaps as much as for its classes.
 */
export function SectionTimetable({
  entries,
  emptyMessage = "Nothing to show a timetable for.",
  hourHeight,
}: {
  entries: TimetableEntry[];
  emptyMessage?: string;
  hourHeight?: number;
}) {
  const today = isoToday();
  const byTerm = useMemo(() => {
    const held = new Map<string, string[]>();
    for (const entry of entries) {
      if (!entry.termCode || !entry.crn) continue;
      const crns = held.get(entry.termCode) ?? [];
      if (!crns.includes(entry.crn)) crns.push(entry.crn);
      held.set(entry.termCode, crns);
    }
    return [...held.entries()].map(([termCode, crns]) => ({ termCode, crns: [...crns].sort() }));
  }, [entries]);

  // One read per portal term, since the sweep is filed by term; structurally shared, so the
  // sections keep their identity between renders and the assembly below is not redone.
  const { loading, failed, sections } = useQueries({
    queries: byTerm.map(({ termCode, crns }) => ({
      queryKey: ["facility-sections", termCode, crns.join(",")],
      queryFn: () => fetchFacilitySections(termCode, crns),
      retry: false,
    })),
    combine: (reads) => ({
      loading: reads.some((read) => read.isLoading),
      failed: reads.find((read) => read.error)?.error as Error | undefined,
      sections: reads.flatMap((read) =>
        (read.data?.sections ?? []).map((section) => ({ ...section, termCode: read.data?.termCode ?? "" })),
      ),
    }),
  });

  const { sessions, courses, unasked, gone, unbooked, unlinked } = useMemo(
    () => assemble(entries, sections),
    [entries, sections],
  );

  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const firstSession = sessions[0] ? `${sessions[0].date}|${sessions.length}` : "";
  useEffect(() => {
    setWeekStart(sessions.length ? defaultWeekStart(sessions, today) : null);
    // Re-aim when the sessions change, which the first date and the count stand for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSession]);

  if (entries.length === 0) return <Empty>{emptyMessage}</Empty>;
  if (loading && sessions.length === 0) return <Empty>Reading the registrar's timetable…</Empty>;
  if (failed && sessions.length === 0) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {failed.message}
      </p>
    );
  }

  const legend = [...new Map([...courses.values()].map((course) => [course.colorKey, course])).values()];
  const shown = weekStart ?? defaultWeekStart(sessions, today);

  return (
    <div>
      {sessions.length === 0 ? (
        <Empty>The registrar's sweep holds no meetings for {entries.length === 1 ? "this section" : "these sections"}.</Empty>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Previous week" onClick={() => setWeekStart(shiftWeek(shown, -1))} className={NAV}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setWeekStart(defaultWeekStart(sessions, today))} className={`${NAV} px-2.5 text-xs font-semibold`}>
              Current week
            </button>
            <button type="button" aria-label="Next week" onClick={() => setWeekStart(shiftWeek(shown, 1))} className={NAV}>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <span className="text-xs font-semibold text-[#344054]">{weekLabel(shown, sessions)}</span>
          </div>
          <WeekCalendar weekStart={shown} sessions={sessions} courses={courses} today={today} hourHeight={hourHeight} />
          {legend.length > 1 ? (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#667085]" aria-label="Legend">
              {legend.map((course) => (
                <li key={course.colorKey} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`inline-block size-2.5 rounded-sm ${course.tone === "outline" ? "border-2 border-dashed" : ""}`}
                    style={course.tone === "outline" ? { borderColor: course.color } : { backgroundColor: course.color }}
                  />
                  <span className="font-medium text-[#344054]">{course.label || course.code}</span>
                  {course.title && course.title !== course.label ? <span className="truncate">{course.title}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {courses.size > 0 && [...courses.values()].some((course) => course.tone === "outline") ? (
            <p className="mt-1.5 text-xs text-[#98a2b3]">Dashed: in a group of theirs, and the registrar has not registered them for it.</p>
          ) : null}
        </>
      )}
      <Coverage unasked={unasked} gone={gone} unbooked={unbooked} unlinked={unlinked} />
    </div>
  );
}

const NAV =
  "inline-flex h-7 items-center justify-center rounded-md border border-[#d9dee7] bg-white px-1.5 text-[#344054] hover:bg-[#f8fafc]";

type Assembled = {
  sessions: ReturnType<typeof placeSessions>;
  courses: Map<string, CalendarCourse & { colorKey: string }>;
  unasked: string[];
  gone: string[];
  unbooked: string[];
  unlinked: string[];
};

/** The sweep's answer against what was asked: sessions to draw, and what could not be drawn. */
function assemble(entries: TimetableEntry[], sections: (FacilitySection & { termCode: string })[]): Assembled {
  const wanted = new Map<string, TimetableEntry>();
  for (const entry of entries) if (entry.crn) wanted.set(`${entry.termCode}|${entry.crn}`, entry);
  const colors = assignColors([...wanted.values()].map(keyOf));
  const sessions: Session[] = [];
  const courses = new Map<string, CalendarCourse & { colorKey: string }>();
  const unasked: string[] = [];
  const gone: string[] = [];
  const unbooked: string[] = [];
  const unlinked = [...new Set(entries.filter((entry) => entry.crn && !entry.termCode).map((entry) => entry.crn))];
  for (const section of sections) {
    const entry = wanted.get(`${section.termCode}|${section.crn}`);
    if (!entry) continue;
    const colorKey = keyOf(entry);
    courses.set(section.crn, {
      crn: section.crn,
      code: entry.code || section.courseCode,
      title: entry.title || section.title,
      label: entry.label || entry.code || section.courseCode,
      staff: entry.staff || section.teacherName,
      tone: entry.tone ?? "solid",
      color: colors.get(colorKey) ?? "#1f4e79",
      colorKey,
    });
    if (section.state === "unchecked") unasked.push(section.crn);
    else if (section.state === "gone") gone.push(section.crn);
    else if (section.meetings.length === 0) unbooked.push(section.crn);
    for (const meeting of section.meetings) {
      sessions.push({ crn: section.crn, date: meeting.meetsOn, start: meeting.startsAt.slice(0, 5), end: meeting.endsAt.slice(0, 5), room: meeting.room });
    }
  }
  return { sessions: placeSessions(sessions), courses, unasked, gone, unbooked, unlinked };
}

/** What shares a colour: what the caller said, else the course, else the section itself. */
function keyOf(entry: TimetableEntry): string {
  return entry.colorKey ?? (entry.code || entry.crn);
}

/** What the grid could not show, said rather than left as an empty afternoon. */
function Coverage({ unasked, gone, unbooked, unlinked }: Pick<Assembled, "unasked" | "gone" | "unbooked" | "unlinked">) {
  const lines = [
    unasked.length ? `Nobody has asked the registrar about ${list(unasked)} — run a portal sync.` : "",
    unbooked.length ? `Asked, and the registrar has booked no room for ${list(unbooked)}.` : "",
    gone.length ? `The registrar has stopped answering for ${list(gone)}; ${gone.length === 1 ? "its" : "their"} classes are not drawn.` : "",
    unlinked.length ? `${list(unlinked)} ${unlinked.length === 1 ? "is" : "are"} in a semester linked to no portal term.` : "",
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-[#8a6116]" aria-label="What the timetable cannot show">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function list(crns: string[]): string {
  const shown = crns.slice(0, 6).join(", ");
  return crns.length > 6 ? `${shown} and ${crns.length - 6} more` : shown;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#667085]">{children}</p>;
}
