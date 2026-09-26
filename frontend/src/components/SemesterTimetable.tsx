import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, DoorOpen, Download, Search, TriangleAlert } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SemesterExport } from "@/components/SemesterExport";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { TableFilterBar } from "@/components/TableFilterBar";
import { usePageState } from "@/components/usePageState";
import { useRemembered } from "@/components/useRemembered";
import { buildCards, rowsPerPart, subRowLabel, teaches } from "@/services/courseCards";
import { fetchActiveCrns, fetchFacilitySections, fetchTermCrns, type ActiveCrn } from "@/services/portalLists";
import { optionsFor, type GridColumn } from "@/services/studentColumns";
import { applyFilters, type FilterColumn, type FilterModel } from "@/services/tableFilter";
import { DAY_NAMES, formatRoom, parseIsoDate } from "@/services/weekSchedule";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTermWeeks } from "@/services/termWeeks";
import { fetchSessionChanges } from "@/services/sessionChanges";
import type { SemesterExportInput } from "@/services/semesterPdf";
import { fetchTimetableTerms, type TimetableTerm } from "@/services/timetables";

/*
 * The two zooms, as the range a slider runs over.
 *
 * Width is in SCREENS: at 1 the week is exactly as wide as the room it has, and every
 * notch above that is a wider week you scroll. Expressed in pixels per minute instead, the
 * bottom half of the slider did nothing on a wide monitor, because anything narrower than
 * the screen was drawn at screen width anyway. Height is one class's own height, which is
 * what decides how many of a busy day's classes you see without scrolling.
 */
const WIDTH = { min: 1, max: 6, step: 0.1, start: 1 };
const HEIGHT = { min: 14, max: 56, step: 1, start: 22 };

/** A section as the filters read it: the entry, and what its cohort, set and classes are. */
type SectionRow = TimetableEntry & { cohort: string; subject: string; set: string; rooms: string[]; days: string[] };

/** The subject is the code's first segment: MATH-222 and MATH-351 are one subject. */
const subjectOf = (code: string) => (code.split("-", 1)[0] || code).toUpperCase();
/** "Mon", for a class's date. */
const dayOf = (date: string) => DAY_NAMES[parseIsoDate(date).getDay()];

const column = (id: string, displayName: string, type: GridColumn<SectionRow>["type"], accessor: (row: SectionRow) => unknown): GridColumn<SectionRow> => ({
  id,
  displayName,
  type,
  accessor,
  defaultWidth: 120,
});
/** Everything a section can be filtered on, the way a table's columns can. */
const COLUMNS: GridColumn<SectionRow>[] = [
  column("cohort", "Cohort", "option", (row) => row.cohort),
  column("subject", "Subject", "option", (row) => row.subject),
  column("code", "Course", "option", (row) => row.code),
  column("title", "Title", "text", (row) => row.title),
  column("crn", "CRN", "text", (row) => row.crn),
  column("set", "Set", "option", (row) => row.set),
  column("group", "Group", "option", (row) => row.group ?? ""),
  column("staff", "Teacher", "option", (row) => row.staff ?? ""),
  column("rooms", "Room", "multiOption", (row) => row.rooms),
  column("days", "Day", "multiOption", (row) => row.days),
];
/** The two that are the classes' own, for keeping a kept section's matching classes only. */
const CLASS_COLUMNS: FilterColumn<{ rooms: string[]; days: string[] }>[] = [
  { id: "rooms", displayName: "Room", type: "multiOption", accessor: (row) => row.rooms },
  { id: "days", displayName: "Day", type: "multiOption", accessor: (row) => row.days },
];

/**
 * A whole semester's week, as a page rather than a card.
 *
 * Every other calendar here answers "when is this ONE thing taught" — a student's week, a
 * teacher's, a CRN's — and fits in a card beside other cards. None of them answers the
 * question a coordinator asks while moving a class: what else is in that hour. That
 * question is about the whole department at once, and the whole department does not fit in
 * a card, so this takes the page.
 *
 * Three things follow from the scale, and each was a correction to a first version that
 * treated this like the small calendars:
 *
 * - **Stacked, not side by side.** Sixteen sections share the worst hour of a real
 *   semester. Side by side that is sixteen coloured slivers; stacked, each keeps the full
 *   width of its day and gives up height, which the zoom gives back.
 * - **Zoom on both axes.** With stacking, height is the currency — an hour has to be able
 *   to grow until its classes are readable, and the week scrolls rather than shrinking to
 *   fit.
 * - **The boxes open.** A class on any other calendar here opens its CRN; there is no
 *   reason this one should be the exception, and it is the calendar you are most likely to
 *   be looking at when you want to know what a section actually is.
 */
export function SemesterTimetable({
  layout = "days",
  termId,
  onPickTerm,
}: {
  /** Days down the side — the Timetable page — or rooms, for the Rooms page. */
  layout?: Layout;
  /** The semester the address names; the published one when it names none we know. */
  termId: string;
  onPickTerm: (termId: string) => void;
}) {
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms });
  const all = terms.data ?? [];
  if (terms.isLoading) return <ScreenLoading label="Loading semesters…" />;
  if (terms.isError) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">
        {terms.error.message}
      </p>
    );
  }
  if (all.length === 0) return <p className="text-sm text-[#667085]">The Student Hub holds no semester yet.</p>;
  const term = all.find((candidate) => candidate.id === termId) ?? all.find((candidate) => candidate.isPublished) ?? all[0];
  const picker = (
    <div className="w-44">
      <SelectMenu
        label="Semester"
        value={term.id}
        onChange={(next) => next && onPickTerm(next)}
        options={all.map((candidate) => ({
          value: candidate.id,
          label: candidate.name,
          detail: candidate.isPublished ? "Published" : "Hidden",
        }))}
      />
    </div>
  );
  // Keyed on the semester, so one semester's week and coverage never carry into another's.
  return <SemesterWeek key={term.id} layout={layout} term={term} picker={picker} />;
}

type Layout = "days" | "rooms";

function SemesterWeek({ layout, term, picker }: { layout: Layout; term: TimetableTerm; picker: ReactNode }) {
  const client = useQueryClient();
  const rooms = layout === "rooms";
  /*
   * The filters and the zooms, kept by this browser.
   *
   * They were the page's alone, so a step to a CRN's record or another page and back put
   * every one of them to its default — the cohort, the teachers, the height an hour needs
   * to be readable, all chosen again. A preference, not a fact about the department:
   * this browser's, as the cohort picker's is.
   */
  // The filters and the search are the tables' own, kept ten minutes like theirs.
  const kept = rooms ? "rooms" : "semester-timetable";
  const [filters, setFilters] = usePageState<FilterModel[]>(`${kept}:filters`, []);
  const [query, setQuery] = usePageState(`${kept}:search`, "");
  // A room's whole week along one line, or one day with room to read every box.
  const [span, setSpan] = usePageState<"day" | "week">("rooms:span", "day");
  const [widthZoom, setWidthZoom] = useKeptNumber("semester-timetable:width", WIDTH);
  const [rowHeight, setRowHeight] = useKeptNumber("semester-timetable:height", HEIGHT);
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  // Where the week's arrows and dates go, so they cost no row of their own.
  const [navSlot, setNavSlot] = useState<HTMLDivElement | null>(null);
  // What the sweep could not draw. The grid hides the sentences that usually say so, and
  // silence about it would read as a complete week.
  const [missing, setMissing] = useState<{ unasked: string[]; gone: string[]; unbooked: string[] }>({
    unasked: [],
    gone: [],
    unbooked: [],
  });

  // Where this semester's Week 1 is, from Settings → Semesters, so the week says its number.
  const weeks = useQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks, retry: false, staleTime: 60_000 });

  const held = useQuery({
    queryKey: ["term-crns", term.id],
    queryFn: () => fetchTermCrns(term.id),
    retry: false,
  });
  // The department's own list, so a box knows whether there is a record behind it to open.
  const register = useQuery({ queryKey: ["active-crns", ""], queryFn: () => fetchActiveCrns(), retry: false });
  const inRegister = (crn: string) => (register.data ?? []).find((row) => row.crn === crn) ?? null;

  /*
   * Course-level rows, which are not classes and are never drawn.
   *
   * A mutualized course keeps one row of its own that the real sections hang from. Nobody
   * registers into it, so the sweep never asks the registrar about it, so it lands among
   * the ones the grid could not draw — thirty of them on a semester where eighteen sections
   * are genuinely missing. Counting those made the honest number unreadable.
   *
   * `childCount` alone is not enough to set one aside: a row that both parents others and
   * is itself taught somewhere on a card IS a class, and its absence from the week is a
   * real absence. Only a parent that teaches nobody is passed over.
   */
  const passedOver = useMemo(() => {
    const rows = register.data ?? [];
    return new Set(rows.filter((row) => row.childCount > 0 && row.usedBy === 0).map((row) => row.crn));
  }, [register.data]);
  const notDrawn = useMemo(() => {
    const keep = (crns: string[]) => crns.filter((crn) => !passedOver.has(crn));
    const [unasked, gone, unbooked] = [keep(missing.unasked), keep(missing.gone), keep(missing.unbooked)];
    const setAside = missing.unasked.length + missing.gone.length + missing.unbooked.length
      - (unasked.length + gone.length + unbooked.length);
    return { unasked, gone, unbooked, setAside, total: unasked.length + gone.length + unbooked.length };
  }, [missing, passedOver]);

  /*
   * Which group of ours each section stands for — "TD 3", "CM 1 · Physics".
   *
   * Walked out of the cards rather than asked for, because a CRN is a cell of the matrix
   * and nothing indexes the matrix by it; the CRN record does the same walk for the same
   * reason. Worth the read: on a grid of the whole department the group is the second
   * thing you want after the course, ahead of the room and well ahead of the hour, which
   * the box's own position already tells you.
   */
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  const { groupOf, cohortOf } = useMemo(() => {
    const groups = new Map<string, string>();
    const whose = new Map<string, string>();
    for (const card of buildCards(catalogues.data ?? [], () => "", [])) {
      for (const set of card.sets) {
        for (const row of set.rows.filter((entry) => teaches(entry)).flatMap((entry) => rowsPerPart(entry))) {
          const crn = row.section?.crn;
          if (!crn || groups.has(crn)) continue;
          groups.set(crn, `${set.scope.code} ${subRowLabel(row.group.label, row.major?.program ?? "", (row.group.majors ?? []).length)}`.trim());
          whose.set(crn, card.cohortName);
        }
      }
    }
    return { groupOf: groups, cohortOf: whose };
  }, [catalogues.data]);

  const all = useMemo<TimetableEntry[]>(() => {
    const crns = held.data?.crns ?? {};
    const termCode = held.data?.portalTermCode ?? "";
    return Object.entries(crns)
      .filter(([, course]) => course.status === "in_portal")
      .map(([crn, course]) => ({
        termCode,
        crn,
        code: course.courseCode,
        title: course.title,
        staff: course.teacherName,
        group: groupOf.get(crn) ?? "",
        // Not shown in the box — it is the filter's business, and the group already says
        // most of it — but carried so the filter has something to read.
        // One colour per COURSE, so a course's sections read as one thing across the week.
        colorKey: course.courseCode,
      }));
  }, [held.data, groupOf]);

  /*
   * Every section with what can be asked of it, for the same filter bar the tables have.
   *
   * The rooms and the weekdays are the classes', read from the same sweep the grid draws:
   * a section is kept when any of its classes answers, and the grid then draws only the
   * classes that do — asking for 5.111 shows Monday in 5.111, not the Wednesday elsewhere.
   */
  const termCode = held.data?.portalTermCode ?? "";
  const meetings = useQuery({
    queryKey: ["facility-sections", termCode, all.map((entry) => entry.crn).sort().join(",")],
    queryFn: () => fetchFacilitySections(termCode, all.map((entry) => entry.crn).sort()),
    enabled: Boolean(termCode) && all.length > 0,
    retry: false,
  });
  const classesOf = useMemo(
    () => new Map((meetings.data?.sections ?? []).map((section) => [section.crn, section.meetings])),
    [meetings.data],
  );
  const rows = useMemo<SectionRow[]>(
    () =>
      all.map((entry) => {
        const classes = classesOf.get(entry.crn) ?? [];
        return {
          ...entry,
          cohort: cohortOf.get(entry.crn) ?? "",
          subject: subjectOf(entry.code),
          set: (entry.group ?? "").split(" ", 1)[0] ?? "",
          rooms: [...new Set(classes.map((meeting) => formatRoom(meeting.room)).filter(Boolean))],
          days: [...new Set(classes.map((meeting) => dayOf(meeting.meetsOn)))],
        };
      }),
    [all, classesOf, cohortOf],
  );
  const searched = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return rows;
    return rows.filter((row) =>
      [row.crn, row.code, row.title, row.staff ?? "", row.group ?? "", row.cohort, ...row.rooms]
        .join(" ")
        .toLowerCase()
        .includes(words),
    );
  }, [rows, query]);
  const shown = useMemo(() => applyFilters(searched, COLUMNS, filters), [searched, filters]);
  // The classes of a kept section that the room and weekday filters keep.
  const perClass = useMemo(() => filters.filter((filter) => filter.columnId === "rooms" || filter.columnId === "days"), [filters]);
  const sessionFilter = useMemo(
    () =>
      perClass.some((filter) => filter.values.length)
        ? (session: { room: string; date: string }) =>
            applyFilters([{ rooms: [formatRoom(session.room)], days: [dayOf(session.date)] }], CLASS_COLUMNS, perClass).length > 0
        : undefined,
    [perClass],
  );
  const narrowed = filters.some((filter) => filter.values.length) || Boolean(query.trim());

  /*
   * The export: what is on the page, every week of it. The notes — cancelled, covered —
   * are read only once somebody asks for the file; the grid reads its own.
   */
  const [exporting, setExporting] = useState(false);
  const notes = useQuery({
    queryKey: ["session-changes", termCode],
    queryFn: () => fetchSessionChanges(termCode),
    enabled: exporting && Boolean(termCode),
    retry: false,
  });
  const exportInput = useMemo<SemesterExportInput>(() => {
    const swept = new Map((meetings.data?.sections ?? []).map((section) => [section.crn, section]));
    return {
      semester: term.name,
      layout: rooms ? (span === "day" ? "rooms-day" : "rooms-week") : "days",
      weekOne: weeks.data?.[term.id],
      sweptAt: meetings.data?.pulledAt,
      sections: shown.map((row) => {
        const section = swept.get(row.crn);
        return {
          crn: row.crn,
          courseCode: row.code,
          title: row.title,
          teacher: row.staff || section?.teacherName || "",
          group: row.group ?? "",
          meetings: (section?.meetings ?? []).filter(
            (meeting) =>
              !sessionFilter ||
              sessionFilter({ date: meeting.meetsOn, room: meeting.room }),
          ),
          notes: (notes.data ?? [])
            .filter((note) => note.crn === row.crn)
            .map((note) => ({
              meetsOn: note.meetsOn,
              startsAt: note.startsAt,
              kind: note.kind,
              coverTeacherName: note.coverTeacherName,
              note: note.note,
            })),
        };
      }),
    };
  }, [meetings.data, notes.data, rooms, sessionFilter, shown, span, term.id, term.name, weeks.data]);

  return (
    /*
     * The page is exactly the screen and the grid scrolls inside it.
     *
     * The controls and the week's dates are what you steer by, so they stay put; a page
     * that scrolled as a whole took them off the top of the screen the moment you looked
     * at Friday.
     */
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-3">
        <h2 className="flex shrink-0 items-center gap-2 text-lg font-semibold text-[#171717]">
          {rooms ? <DoorOpen size={18} aria-hidden="true" /> : <CalendarRange size={18} aria-hidden="true" />}
          {rooms ? "Rooms" : "Semester Timetable"}
        </h2>
        {picker}
        {/*
          * Everything you steer by on one row, pushed to the right; the filters get the row
          * under it, where a long run of them has the whole width to grow into.
          */}
        <div ref={setNavSlot} className="shrink-0" />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <label className="relative block w-64">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#667085]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search sections"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="w-full rounded-md border border-[#d3d9e2] bg-white py-1.5 pl-8 pr-2 text-sm"
            />
          </label>
          {rooms ? (
            <span role="group" aria-label="Across the page" className="inline-flex overflow-hidden rounded-md border border-[#d3d9e2]">
              {(["day", "week"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={span === choice}
                  onClick={() => setSpan(choice)}
                  className={`border-l border-[#d3d9e2] px-2.5 py-1.5 text-xs font-semibold first:border-l-0 ${
                    span === choice ? "bg-[#1f4e79] text-white" : "bg-white text-[#344054] hover:bg-[#f8fafc]"
                  }`}
                >
                  {choice === "day" ? "Day" : "Week"}
                </button>
              ))}
            </span>
          ) : null}
          <Zoom label="Width" value={widthZoom} {...WIDTH} onChange={setWidthZoom} />
          <Zoom label="Height" value={rowHeight} {...HEIGHT} onChange={setRowHeight} />
          <button
            type="button"
            onClick={() => setExporting(true)}
            disabled={!meetings.data}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <Download size={14} aria-hidden="true" /> Export
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-[#98a2b3]">
            {`${shown.length} of ${all.length}`}
            {notDrawn.total ? (
              <Warning
                label={`${notDrawn.total} section${notDrawn.total === 1 ? "" : "s"} not drawn`}
                lines={[
                  notDrawn.unasked.length
                    ? `${notDrawn.unasked.length} never swept from the portal — run a portal sync.`
                    : "",
                  notDrawn.gone.length ? `${notDrawn.gone.length} the portal has stopped answering for.` : "",
                  notDrawn.unbooked.length ? `${notDrawn.unbooked.length} the portal has booked no hours for.` : "",
                  notDrawn.setAside
                    ? `${notDrawn.setAside} course-level row${notDrawn.setAside === 1 ? " is" : "s are"} not counted — they hold no hours of their own.`
                    : "",
                ].filter(Boolean)}
              />
            ) : null}
          </span>
          {narrowed ? (
            <button
              type="button"
              onClick={() => {
                setFilters([]);
                setQuery("");
              }}
              className="text-xs font-semibold text-[#1f4e79] underline"
            >
              Every section
            </button>
          ) : null}
        </div>
      </div>
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <TableFilterBar columns={COLUMNS} filters={filters} optionsFor={(column) => optionsFor(rows, column)} onChange={setFilters} />
      </div>

      {held.isError ? (
        <p className="rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm text-[#8a6116]">
          This semester is not linked to a portal term, so the portal has nothing to show for it.
        </p>
      ) : (
        <SectionTimetable
          fills
          entries={shown}
          sessionFilter={sessionFilter}
          daysDown
          byRoom={rooms ? span : undefined}
          onCoverage={setMissing}
          navInto={navSlot}
          widthZoom={widthZoom}
          rowHeight={rowHeight}
          weekOne={weeks.data?.[term.id]}
          keepWeekAs={`semester:${term.id}`}
          title={term.name}
          openable={(crn) => Boolean(inRegister(crn))}
          onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
          emptyMessage={
            all.length
              ? "Nothing matches those filters."
              : "No section of this semester has been swept from the portal's timetable yet."
          }
        />
      )}

      {exporting ? (
        <SemesterExport
          open
          onClose={() => setExporting(false)}
          input={exportInput}
          shown={`${shown.length} of ${all.length} sections`}
        />
      ) : null}

      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(register.data ?? []).filter(
            (entry) => entry.courseCode === showingCrn.courseCode && entry.termCode === showingCrn.termCode,
          )}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void client.invalidateQueries({ queryKey: ["active-crns"] })}
        />
      ) : null}
    </section>
  );
}

/**
 * What the grid could not draw, as one mark that explains itself on hover.
 *
 * It was a line of amber words — "18 not drawn" — on the row the page steers by, read
 * every time the eye went to the zooms and needed only when somebody wonders why a class
 * is missing. The mark says there is something to know; the hover says what.
 */
function Warning({ label, lines }: { label: string; lines: string[] }) {
  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label={`${label}. ${lines.join(" ")}`} className="rounded p-0.5 text-[#b7791f] hover:bg-[#fdf3e1]">
            <TriangleAlert size={15} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-[100] w-72 rounded-lg border border-[#d9dee7] bg-white p-3 text-xs leading-5 text-[#475467] shadow-lg"
          >
            <p className="font-semibold text-[#171717]">{label}</p>
            <ul className="mt-1 space-y-0.5">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** One axis of the zoom, as a slider: drag for size. */
function Zoom({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  start?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-[#d3d9e2] bg-white px-2 py-1.5">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} of a class`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-16 cursor-pointer accent-[#1f4e79]"
      />
    </label>
  );
}

/** A number this browser keeps, back inside its range if the range has moved since. */
function useKeptNumber(key: string, range: { min: number; max: number; start: number }): [number, (next: number) => void] {
  const [held, setHeld] = useRemembered(key);
  const value = Number(held);
  const kept = held && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : range.start;
  return [kept, (next) => setHeld(String(next))];
}

