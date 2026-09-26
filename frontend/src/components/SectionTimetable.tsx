import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { WeekCalendar } from "@/components/WeekCalendar";
import { WeekTimeline } from "@/components/WeekTimeline";
import { fetchFacilitySections, fetchTermLinks, type FacilitySection } from "@/services/portalLists";
import { fetchTermWeeks } from "@/services/termWeeks";
import { fetchSessionChanges, slotKey, type SessionChange } from "@/services/sessionChanges";
import {
  DAY_NAMES,
  MONTH_NAMES,
  assignColors,
  defaultWeekStart,
  isoToday,
  mondayOf,
  parseIsoDate,
  placeSessions,
  preferredDay,
  shiftWeek,
  toIsoDate,
  weekDays,
  weekLabel,
  weekNumber,
  weekStartOf,
  type CalendarCourse,
  type PlacedSession,
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
  /** The group of ours the section stands for — "TD 3" — printed with the CRN in the box. */
  group?: string;
  staff?: string;
  tone?: "solid" | "outline";
  /**
   * Draw only these dates of the section, rather than every meeting of it.
   *
   * For a class somebody stood in for: they were in that room one Tuesday, not every
   * Tuesday, and adding the CRN outright would put them there all semester.
   */
  onlyOn?: string[];
  /**
   * This section is on the calendar because its owner's week is not the one being read —
   * somebody stood in. Every drawn meeting is marked as cover from the stand-in's side,
   * naming whose class it was.
   */
  standingIn?: boolean;
  /** What shares a colour. The course code when left out; a course's own calendar passes the CRN. */
  colorKey?: string;
};

type TimetableProps = {
  entries: TimetableEntry[];
  emptyMessage?: string;
  /**
   * Drawn small — a quarter of the size — with a button that opens it full size in a
   * dialog. For a record, where the week is one card among several.
   */
  compact?: boolean;
  /** What the full-size dialog is called: whose week this is. */
  title?: string;
  /** Pressing a box opens that CRN's record, where `openable` says there is one to open. */
  onOpenCrn?: (crn: string) => void;
  openable?: (crn: string) => boolean;
  /**
   * Days down the side and hours across the page, instead of the other way round.
   *
   * For the department's whole week, where the ordinary way round has nothing left to
   * divide — see `WeekTimeline`. `widthZoom` and `rowHeight` are its two zooms and are
   * ignored by the ordinary calendar.
   */
  daysDown?: boolean;
  /**
   * Rooms down the side instead of days: the whole week side by side, or one day at a
   * time with its hours across the page. Only with `daysDown` — see `WeekTimeline`.
   */
  byRoom?: "week" | "day";
  /** How many screens wide the week is drawn; 1 fills it exactly. */
  widthZoom?: number;
  rowHeight?: number;
  /** Take the height given and scroll the grid inside it, rather than growing the page. */
  fills?: boolean;
  /**
   * Somewhere else to put the week's arrows and dates.
   *
   * Its own row costs a screen-high grid an hour of the afternoon for four words and two
   * arrows. Given a slot, the navigation goes and sits in the caller's header instead —
   * the same trick the pages here use to put their controls beside the page title.
   */
  navInto?: HTMLElement | null;

  /**
   * How much of the week the sweep could not draw, for a caller that is filling and has
   * therefore hidden the sentences that usually say so. Silence about it would read as a
   * complete week, and the whole value of this grid is that you can trust what is not in it.
   *
   * The CRNs themselves rather than three totals: a caller that knows some of them are not
   * classes at all — a course-level row that never holds hours of its own — can only leave
   * those out of the tally if it is told which they are.
   */
  onCoverage?: (coverage: { unasked: string[]; gone: string[]; unbooked: string[] }) => void;
  /** An hour's height in pixels, for the ordinary calendar. */
  hourHeight?: number;
  /**
   * Pressing a box says what happened to that class instead — cancelled, covered. Every
   * box is pressable then; a CRN's own record is where this is offered.
   */
  onPickSession?: (session: PlacedSession) => void;
  /**
   * Draw only the classes this says yes to. For a filter on the classes themselves — a
   * room, a weekday — where the sections are already chosen: a section that meets in
   * 5.111 on Monday and 4.124 on Wednesday shows its Monday alone when 5.111 is asked for.
   */
  sessionFilter?: (session: { crn: string; date: string; start: string; end: string; room: string }) => boolean;
  /**
   * Any day of the semester's first teaching week, from Settings → Semesters. Given it,
   * the week says which teaching week it is — "Week 5" — and that label is a picker that
   * jumps straight to any week of the semester.
   */
  weekOne?: string;
  /**
   * A name to keep the week being looked at under, for this browser tab. Coming back to
   * the page lands on the week you left rather than on this one; a new tab starts on this.
   */
  keepWeekAs?: string;
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
export function SectionTimetable(props: TimetableProps) {
  const [expanded, setExpanded] = useState(false);
  if (!props.compact) return <Timetable {...props} />;
  return (
    <>
      <Timetable {...props} onExpand={() => setExpanded(true)} />
      <Modal open={expanded} size="wide" title={props.title ?? "Timetable"} description="As the portal has booked it." onClose={() => setExpanded(false)}>
        <Timetable {...props} compact={false} />
      </Modal>
    </>
  );
}

function Timetable({
  entries,
  emptyMessage = "Nothing to show a timetable for.",
  compact = false,
  onOpenCrn,
  openable,
  daysDown = false,
  byRoom,
  widthZoom = 1,
  rowHeight = 22,
  fills = false,
  onCoverage,
  navInto,
  hourHeight,
  onPickSession,
  weekOne: weekOneGiven,
  keepWeekAs,
  sessionFilter,
  onExpand,
}: TimetableProps & { onExpand?: () => void }) {
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

  /*
   * The semester's Week 1, where the caller did not give it: found from the portal term the
   * sections are filed under, so every record's calendar — a CRN's, a teacher's, a
   * student's — says "Week 5" as the semester's own week does. Only where the sections are
   * all of one term; a calendar across two semesters has no one week to count from.
   */
  const soleTerm = byTerm.length === 1 ? byTerm[0].termCode : "";
  const links = useQuery({
    queryKey: ["term-links"],
    queryFn: fetchTermLinks,
    enabled: weekOneGiven === undefined && Boolean(soleTerm),
    retry: false,
    staleTime: 60_000,
  });
  const weeks = useQuery({
    queryKey: ["term-weeks"],
    queryFn: fetchTermWeeks,
    enabled: weekOneGiven === undefined && Boolean(soleTerm),
    retry: false,
    staleTime: 60_000,
  });
  const weekOne =
    weekOneGiven ??
    (() => {
      const termId = Object.entries(links.data ?? {}).find(([, code]) => code === soleTerm)?.[0];
      return termId ? weeks.data?.[termId] : undefined;
    })();

  // What the coordinators have said about the term's classes, by slot.
  const { notes } = useQueries({
    queries: byTerm.map(({ termCode }) => ({
      queryKey: ["session-changes", termCode],
      queryFn: () => fetchSessionChanges(termCode),
      retry: false,
    })),
    combine: (reads) => ({ notes: reads.flatMap((read) => read.data ?? []) }),
  });

  const { sessions, courses, unasked, gone, unbooked, unlinked } = useMemo(
    () => assemble(entries, sections, notes, onPickSession ? () => true : openable, sessionFilter),
    [entries, sections, notes, openable, onPickSession, sessionFilter],
  );

  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const firstSession = sessions[0] ? `${sessions[0].date}|${sessions.length}` : "";
  // The week this tab was last looking at, when the caller asked for one to be kept.
  const keptWeek = (): Date | null => {
    if (!keepWeekAs) return null;
    try {
      const held = window.sessionStorage.getItem(`scen-week:${keepWeekAs}`);
      return held ? mondayOf(parseIsoDate(held)) : null;
    } catch {
      return null;
    }
  };
  const goTo = (week: Date) => {
    setWeekStart(week);
    if (!keepWeekAs) return;
    try {
      window.sessionStorage.setItem(`scen-week:${keepWeekAs}`, toIsoDate(week));
    } catch {
      // A tab that cannot keep it simply opens on this week next time.
    }
  };
  /*
   * The day shown, when the rooms are drawn a day at a time. Any day outside the week on
   * screen gives way to that week's own best day — today, or its first day with a class —
   * so stepping a week along lands on a day of the new week rather than on nothing.
   */
  const [day, setDay] = useState("");
  useEffect(() => {
    setWeekStart(sessions.length ? (keptWeek() ?? defaultWeekStart(sessions, today)) : null);
    // Re-aim when the sessions change, which the first date and the count stand for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstSession]);

  // Said up the way rather than printed, for a caller that has hidden the sentences. Keyed
  // on the CRNs and not on how many there are, since which ones they are is now the point.
  const coverage = `${unasked.join(",")}|${gone.join(",")}|${unbooked.join(",")}`;
  useEffect(() => {
    onCoverage?.({ unasked, gone, unbooked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  if (entries.length === 0) return <Empty>{emptyMessage}</Empty>;
  if (loading && sessions.length === 0) return <Empty>Reading the portal's timetable…</Empty>;
  if (failed && sessions.length === 0) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {failed.message}
      </p>
    );
  }

  const legend = [...new Map([...courses.values()].map((course) => [course.colorKey, course])).values()];
  const shown = weekStart ?? defaultWeekStart(sessions, today);
  const small = compact ? "text-[10px]" : "text-xs";
  const oneDay = daysDown && byRoom === "day";
  const days = weekDays(shown, sessions);
  const shownDay = days.includes(day) ? day : preferredDay(days, sessions, today);
  /** The next teaching day either way: Sunday never, Saturday only when something is on it. */
  const stepDay = (by: number) => {
    const next = parseIsoDate(shownDay);
    do next.setDate(next.getDate() + by);
    while (next.getDay() === 0 || (next.getDay() === 6 && !sessions.some((session) => session.date === toIsoDate(next))));
    setDay(toIsoDate(next));
    goTo(mondayOf(next));
  };
  const back = oneDay ? () => stepDay(-1) : () => goTo(shiftWeek(shown, -1));
  const onward = oneDay ? () => stepDay(1) : () => goTo(shiftWeek(shown, 1));

  const weekNav = (
    <div className={`flex flex-wrap items-center gap-1.5 ${navInto ? "" : compact ? "mb-1.5" : "mb-2"} ${fills && !navInto ? "shrink-0" : ""}`}>

            <button type="button" aria-label={oneDay ? "Previous day" : "Previous week"} onClick={back} className={nav(compact)}>
              <ChevronLeft size={compact ? 12 : 14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                setDay("");
                goTo(defaultWeekStart(sessions, today));
              }}
              className={`${nav(compact)} px-2 font-semibold ${small}`}
            >
              {oneDay ? "Today" : "Current week"}
            </button>
            <button type="button" aria-label={oneDay ? "Next day" : "Next week"} onClick={onward} className={nav(compact)}>
              <ChevronRight size={compact ? 12 : 14} aria-hidden="true" />
            </button>
            {weekOne ? (
              compact ? (
                // A card has no room for the picker; it says the week, and the full-size view picks.
                weekNumber(shown, weekOne) >= 1 ? (
                  <span className={`rounded bg-[#eaf1f8] px-1.5 py-0.5 font-semibold text-[#1f4e79] ${small}`}>
                    Week {weekNumber(shown, weekOne)}
                  </span>
                ) : null
              ) : (
                <TeachingWeek shown={shown} weekOne={weekOne} sessions={sessions} onGo={goTo} />
              )
            ) : null}
            {oneDay ? (
              // The week's days as one control, so any of them is a press away.
              <span role="group" aria-label="Day" className="inline-flex overflow-hidden rounded-md border border-[#d9dee7]">
                {days.map((date) => {
                  const when = parseIsoDate(date);
                  const on = date === shownDay;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDay(date)}
                      className={`h-7 border-l border-[#d9dee7] px-2 font-semibold first:border-l-0 ${small} ${
                        on ? "bg-[#1f4e79] text-white" : date === today ? "bg-white text-[#1f4e79]" : "bg-white text-[#344054] hover:bg-[#f8fafc]"
                      }`}
                    >
                      {DAY_NAMES[when.getDay()]} {when.getDate()}
                    </button>
                  );
                })}
              </span>
            ) : (
              <span className={`font-semibold text-[#344054] ${small}`}>{weekLabel(shown, sessions)}</span>
            )}
            {onExpand ? (
              <button
                type="button"
                aria-label="Open the timetable full size"
                title="Open full size"
                onClick={onExpand}
                className={`${nav(compact)} ml-auto`}
              >
                <Maximize2 size={12} aria-hidden="true" />
              </button>
            ) : null}
    </div>
  );

  return (
    <div className={`${compact ? "max-w-[32rem]" : ""} ${fills ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      {sessions.length === 0 ? (
        <Empty>The portal's sweep holds no meetings for {entries.length === 1 ? "this section" : "these sections"}.</Empty>
      ) : (
        <>
          {navInto ? createPortal(weekNav, navInto) : weekNav}
          {daysDown ? (
            <WeekTimeline
              fills={fills}
              weekStart={shown}
              sessions={sessions}
              courses={courses}
              today={today}
              widthZoom={widthZoom}
              rowHeight={rowHeight}
              rowsBy={byRoom ? "room" : "day"}
              day={oneDay ? shownDay : undefined}
              onPick={onPickSession ?? (onOpenCrn ? (session) => onOpenCrn(session.crn) : undefined)}
            />
          ) : (
            <WeekCalendar
              weekStart={shown}
              sessions={sessions}
              courses={courses}
              today={today}
              compact={compact}
              hourHeight={hourHeight ?? (compact ? 24 : 48)}
              onPick={onPickSession ?? (onOpenCrn ? (session) => onOpenCrn(session.crn) : undefined)}
            />
          )}
          {legend.length > 1 && !fills ? (
            <ul className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[#667085] ${small}`} aria-label="Legend">
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
          {/*
            * The standing notes are worth their two lines beside a record's small week and
            * cost too much beside a screen-high one: three lines of grey under the grid is
            * an hour of Friday afternoon. Filling, they go, and what they said is in the
            * count above instead.
            */}
          {!fills && [...courses.values()].some((course) => course.tone === "outline") ? (
            <p className={`mt-1 text-[#98a2b3] ${small}`}>Dashed: in a group of theirs and not registered for it, or registered for a course they are exempt from.</p>
          ) : null}
          {/* Only where there is one to read. A key to a mark nobody can see is clutter. */}
          {!fills && sessions.some((session) => session.change?.kind === "covered") ? (
            <p className={`mt-1 text-[#98a2b3] ${small}`}>Striped: somebody other than the usual teacher was in the room.</p>
          ) : null}
          {fills ? null : onPickSession ? (
            <p className={`mt-1 text-[#98a2b3] ${small}`}>Press a class to say it was cancelled or covered by somebody else.</p>
          ) : onOpenCrn && [...courses.values()].some((course) => course.openable) ? (
            <p className={`mt-1 text-[#98a2b3] ${small}`}>Press a class to open its CRN.</p>
          ) : null}
        </>
      )}
      {fills ? null : <Coverage unasked={unasked} gone={gone} unbooked={unbooked} unlinked={unlinked} compact={compact} />}
    </div>
  );
}

function nav(compact: boolean): string {
  return `inline-flex items-center justify-center rounded-md border border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc] ${
    compact ? "h-6 px-1" : "h-7 px-1.5"
  }`;
}

type Assembled = {
  sessions: ReturnType<typeof placeSessions>;
  courses: Map<string, CalendarCourse & { colorKey: string }>;
  unasked: string[];
  gone: string[];
  unbooked: string[];
  unlinked: string[];
};

/** The sweep's answer against what was asked: sessions to draw, and what could not be drawn. */
function assemble(
  entries: TimetableEntry[],
  sections: (FacilitySection & { termCode: string })[],
  notes: SessionChange[],
  openable?: (crn: string) => boolean,
  sessionFilter?: TimetableProps["sessionFilter"],
): Assembled {
  const said = new Map(notes.map((note) => [slotKey(note), note]));
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
      group: entry.group ?? "",
      // The sweep names the teacher for every section it answered about, so a box has
      // one even where the caller only knew the CRN.
      staff: entry.staff || section.teacherName,
      tone: entry.tone ?? "solid",
      color: colors.get(colorKey) ?? "#1f4e79",
      colorKey,
      openable: openable ? openable(section.crn) : false,
    });
    if (section.state === "unchecked") unasked.push(section.crn);
    else if (section.state === "gone") gone.push(section.crn);
    else if (section.meetings.length === 0) unbooked.push(section.crn);
    for (const meeting of section.meetings) {
      // A section the caller asked for by date is drawn on those days and no others.
      if (entry.onlyOn && !entry.onlyOn.includes(meeting.meetsOn)) continue;
      if (
        sessionFilter &&
        !sessionFilter({
          crn: section.crn,
          date: meeting.meetsOn,
          start: meeting.startsAt.slice(0, 5),
          end: meeting.endsAt.slice(0, 5),
          room: meeting.room,
        })
      ) {
        continue;
      }
      const note = said.get(slotKey({ termCode: section.termCode, crn: section.crn, meetsOn: meeting.meetsOn, startsAt: meeting.startsAt }));
      sessions.push({
        crn: section.crn,
        termCode: section.termCode,
        date: meeting.meetsOn,
        start: meeting.startsAt.slice(0, 5),
        end: meeting.endsAt.slice(0, 5),
        room: meeting.room,
        /*
         * On a stand-in's week the same note reads the other way round: the box says whose
         * class it was, not who took it, since who took it is the person reading.
         */
        change: entry.standingIn
          ? {
              kind: "covered" as const,
              coverTeacherName: entry.staff || section.teacherName,
              note: note?.note ?? "",
              standingIn: true,
            }
          : note
            ? { kind: note.kind, coverTeacherName: note.coverTeacherName, note: note.note }
            : undefined,
      });
    }
  }
  return { sessions: placeSessions(sessions), courses, unasked, gone, unbooked, unlinked };
}

/** What shares a colour: what the caller said, else the course, else the section itself. */
function keyOf(entry: TimetableEntry): string {
  return entry.colorKey ?? (entry.code || entry.crn);
}

/** What the grid could not show, said rather than left as an empty afternoon. */
function Coverage({ unasked, gone, unbooked, unlinked, compact }: Pick<Assembled, "unasked" | "gone" | "unbooked" | "unlinked"> & { compact: boolean }) {
  const lines = [
    unasked.length ? `Nobody has asked the portal about ${list(unasked)} — run a portal sync.` : "",
    unbooked.length ? `Asked, and the portal has booked no room for ${list(unbooked)}.` : "",
    gone.length ? `The portal has stopped answering for ${list(gone)}; ${gone.length === 1 ? "its" : "their"} classes are not drawn.` : "",
    unlinked.length ? `${list(unlinked)} ${unlinked.length === 1 ? "is" : "are"} in a semester linked to no portal term.` : "",
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <ul className={`mt-1.5 space-y-0.5 text-[#8a6116] ${compact ? "text-[10px]" : "text-xs"}`} aria-label="What the timetable cannot show">
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

/**
 * Which teaching week this is, as a picker: it reads "Week 5" and jumps to any week.
 *
 * Counted from the semester's Week 1 in Settings. The department talks in week numbers —
 * "the Week 5 tutorial", "from Week 8" — and finding one used to mean pressing the arrow
 * and doing the arithmetic from the dates.
 */
function TeachingWeek({
  shown,
  weekOne,
  sessions,
  onGo,
}: {
  shown: Date;
  weekOne: string;
  sessions: Session[];
  onGo: (week: Date) => void;
}) {
  const current = weekNumber(shown, weekOne);
  const lastDay = sessions.reduce((last, session) => (session.date > last ? session.date : last), "");
  const last = Math.max(1, current, lastDay ? weekNumber(parseIsoDate(lastDay), weekOne) : 1);
  const options = Array.from({ length: last }, (_, index) => {
    const monday = weekStartOf(index + 1, weekOne);
    return {
      value: String(index + 1),
      label: `Week ${index + 1}`,
      // Its Monday, in the list only: the closed picker has room for "Week 4" and no more.
      detail: `${monday.getDate()} ${MONTH_NAMES[monday.getMonth()]}`,
    };
  });
  return (
    <div className="w-32">
      <SelectMenu
        label="Teaching week"
        value={current >= 1 ? String(current) : ""}
        placeholder="Before Week 1"
        searchable={options.length > 12}
        onChange={(week) => week && onGo(weekStartOf(Number(week), weekOne))}
        options={options}
      />
    </div>
  );
}

