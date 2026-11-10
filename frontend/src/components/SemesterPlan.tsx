import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ChevronLeft, ChevronRight, Download, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PlanClassDialog, ScopeDialog, type ClassDraft } from "@/components/PlanDialogs";
import { PlanWishesPanel, type WishView } from "@/components/PlanWishesPanel";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TeachingWeek } from "@/components/SectionTimetable";
import { SelectMenu } from "@/components/SelectMenu";
import { SemesterExport } from "@/components/SemesterExport";
import { SortMenu } from "@/components/SortMenu";
import { TableFilterBar } from "@/components/TableFilterBar";
import { Zoom } from "@/components/TimelineZoom";
import { usePageState } from "@/components/usePageState";
import { WeekTimeline, type GhostJudgement, type GridSlot, type Shade } from "@/components/WeekTimeline";
import { useKeptNumber } from "@/services/keptNumber";
import { programCode } from "@/services/programmes";
import { optionsFor, type GridColumn } from "@/services/studentColumns";
import { applyFilters, type FilterColumn, type FilterModel } from "@/services/tableFilter";
import { HEIGHT, WIDTH } from "@/services/timelineZoom";
import { useRooms } from "@/services/rooms";
import {
  SECTION_DRAG,
  WEEKDAY_NAMES,
  changeClass,
  clashesOf,
  endOf,
  fetchPlan,
  fetchPlans,
  groupWords,
  placeClass,
  plannedHours,
  removeClass,
  removeSection,
  sectionLabel,
  weeksSaid,
  type Clash,
  type PlanClass,
  type PlanSection,
  type PlanSeries,
  type Scope,
  type SeriesChanges,
} from "@/services/semesterPlans";
import type { SemesterExportInput } from "@/services/semesterPdf";
import {
  DAY_NAMES,
  assignColors,
  formatDayAndMonth,
  formatRoom,
  isoToday,
  mondayOf,
  parseIsoDate,
  shiftWeek,
  toIsoDate,
  weekLabel,
  weekStartOf,
  type CalendarCourse,
  type PlacedSession,
} from "@/services/weekSchedule";
import { fetchSemesterShortNames } from "@/services/portalLists";
import { judgeSlot } from "@/services/planJudge";
import { checkWishes, fetchWishSemester, periodWords, shadingOf } from "@/services/teacherWishes";
import { semesterShown, yearOfTermCode } from "@/services/semesterYears";

/** A class as the filters read it: the class, and what its cohorts, majors, set and classes are. */
type PlanRow = {
  section: PlanSection;
  cohort: string[];
  majors: string[];
  subject: string;
  code: string;
  title: string;
  crn: string;
  set: string;
  group: string;
  staff: string;
  rooms: string[];
  days: string[];
};

/** The subject is the code's first segment: MATH-222 and MATH-351 are one subject. */
const subjectOf = (code: string) => (code.split("-", 1)[0] || code).toUpperCase();
/** "Mon", for a class's date. */
const dayOf = (date: string) => DAY_NAMES[parseIsoDate(date).getDay()];

const column = (id: string, displayName: string, type: GridColumn<PlanRow>["type"], accessor: (row: PlanRow) => unknown): GridColumn<PlanRow> => ({
  id,
  displayName,
  type,
  accessor,
  defaultWidth: 120,
});
/**
 * The Semester Timetable's filters, in its order and its words. A class can be for more than
 * one cohort — a CRN two cohorts share, a language group — so Cohort takes any of them.
 */
const COLUMNS: GridColumn<PlanRow>[] = [
  column("cohort", "Cohort", "multiOption", (row) => row.cohort),
  column("majors", "Major", "multiOption", (row) => row.majors),
  column("subject", "Subject", "option", (row) => row.subject),
  column("code", "Course", "option", (row) => row.code),
  column("title", "Title", "text", (row) => row.title),
  column("crn", "CRN", "text", (row) => row.crn),
  column("set", "Set", "option", (row) => row.set),
  column("group", "Group", "option", (row) => row.group),
  column("staff", "Teacher", "option", (row) => row.staff),
  column("rooms", "Room", "multiOption", (row) => row.rooms),
  column("days", "Day", "multiOption", (row) => row.days),
];
/** The two that are the classes' own, for keeping a kept class's matching weeks only. */
const CLASS_COLUMNS: FilterColumn<{ rooms: string[]; days: string[] }>[] = [
  { id: "rooms", displayName: "Room", type: "multiOption", accessor: (row) => row.rooms },
  { id: "days", displayName: "Day", type: "multiOption", accessor: (row) => row.days },
];

type TrayShow = "all" | "to-place" | "placed" | "no-teacher" | "no-crn" | "wishes";
type TraySort = "groups" | "course" | "left" | "teacher" | "cohort";

const TRAY_SHOW: { value: TrayShow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "to-place", label: "Still to place" },
  { value: "placed", label: "Fully placed" },
  { value: "no-teacher", label: "No teacher" },
  { value: "no-crn", label: "No CRN" },
  { value: "wishes", label: "Breaks a wish" },
];
const TRAY_SORT: { value: TraySort; label: string }[] = [
  // Groups & CRNs' own order: cohort, set, group, course.
  { value: "groups", label: "As on Groups & CRNs" },
  { value: "course", label: "Course" },
  { value: "left", label: "Most hours left" },
  { value: "teacher", label: "Teacher" },
  { value: "cohort", label: "Cohort" },
];

/** What is waiting on the scope question: a gesture or a form, and what it would change. */
type Pending =
  | { verb: "change"; entry: PlanClass; series: PlanSeries; changes: SeriesChanges }
  | { verb: "delete"; entry: PlanClass; series: PlanSeries };

const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort(byNumber);
}

/** The grid's key for a class to place: its CRN, or its own id until it has one. */
const keyOf = (section: PlanSection) => section.crn || section.id;

/** 1 for Monday, as the plan counts weekdays. */
const weekdayOf = (date: string) => ((parseIsoDate(date).getDay() + 6) % 7) + 1;

const CLASH_WORDS: Record<Clash["kind"], string> = {
  teacher: "same teacher as",
  room: "same room as",
  students: "may share students with",
};

/** The Semester Timetable's buttons, so the two pages' controls look alike. */
const CONTROL =
  "inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50";
// The Semester Timetable's week arrows.
const STEP =
  "inline-flex h-7 items-center justify-center rounded-md border border-[#d9dee7] bg-white px-1.5 text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40";

/**
 * A semester planned before the registrar books it, drawn on the Semester Timetable's own
 * grid: the days down the side, the hours across, the same boxes in the same colours, and
 * the same two zooms. What it adds is the drawing — see `editing` on `WeekTimeline`.
 *
 * One week at a time, narrowed with the Semester Timetable's own search and filter bar —
 * cohort, major, course, set, group, teacher, room, day. Beside it, the classes still to place, each with the hours
 * placed against the hours asked for — drag one onto the week to place it. Everything is
 * saved as it is done; several coordinators plan the same semester and each needs to see
 * the others' classes.
 *
 * The classes to place are Groups & CRNs': each group of a set taught each of its courses,
 * with its CRN, teacher and hours. They are set up there, and this page says when and where.
 */
export function SemesterPlan({
  termCode,
  onPickTerm,
  onOpenGroups,
  onOpenSemesters,
}: {
  termCode: string;
  onPickTerm: (termCode: string) => void;
  onOpenGroups?: () => void;
  /** Where a semester is made and its weeks are set: this page only picks one. */
  onOpenSemesters?: () => void;
}) {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans });
  // A plan is the semester `plan:<code>`, and may have a short name like any other.
  const shortNames = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false, staleTime: 60_000 });
  const chosen = termCode || plans.data?.[0]?.termCode || "";
  const plan = useQuery({
    queryKey: ["plan", chosen],
    queryFn: () => fetchPlan(chosen),
    enabled: Boolean(chosen),
    // Somebody else may be planning the same semester.
    refetchInterval: 30_000,
  });
  const { rooms, roomOf } = useRooms();

  // The Semester Timetable's filters and search, kept the same way, and the week on screen.
  const [filters, setFilters] = usePageState<FilterModel[]>("semester-plan:filters", []);
  const [query, setQuery] = usePageState("semester-plan:search", "");
  const [week, setWeek] = usePageState<string>("semester-plan:week", "");
  // The list of classes to place: its own search, which of them, and in what order.
  const [traySearch, setTraySearch] = usePageState("semester-plan:tray-search", "");
  const [trayShow, setTrayShow] = usePageState<TrayShow>("semester-plan:tray-show", "all");
  const [traySort, setTraySort] = usePageState<TraySort>("semester-plan:tray-sort", "groups");
  const [widthZoom, setWidthZoom] = useKeptNumber("semester-plan:width", WIDTH);
  const [heightZoom, setHeightZoom] = useKeptNumber("semester-plan:height", HEIGHT);

  const [exportOpen, setExportOpen] = useState(false);
  const [dialog, setDialog] = useState<{ draft: ClassDraft; entry?: PlanClass; series?: PlanSeries } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ entry: PlanClass; series: PlanSeries } | null>(null);
  const [takingOff, setTakingOff] = useState<PlanSection | null>(null);
  const [error, setError] = useState("");

  const data = plan.data;
  const sectionsById = useMemo(() => new Map((data?.sections ?? []).map((section) => [section.id, section])), [data?.sections]);
  const seriesById = useMemo(() => new Map((data?.series ?? []).map((series) => [series.id, series])), [data?.series]);
  const clashes = useMemo(() => (data ? clashesOf(data) : new Map<PlanClass, Clash[]>()), [data]);
  const placed = useMemo(() => (data ? plannedHours(data) : new Map<string, number>()), [data]);

  /*
   * Timetable wishes: the teachers' answers for the semester, and what the plan breaks of
   * them — with the semester's periods binding everybody (Ramadan). A server without them
   * answers with an error, and the plan simply goes without.
   */
  const wishSemester = useQuery({
    queryKey: ["wishes", chosen],
    queryFn: () => fetchWishSemester(chosen),
    enabled: Boolean(chosen),
    retry: false,
    refetchInterval: 60_000,
  });
  const wishCheck = useMemo(
    () => (data ? checkWishes(data, wishSemester.data?.teachers ?? []) : null),
    [data, wishSemester.data],
  );
  // Whose wishes are shaded: the class being moved, else the class last opened, else the teacher filtered to.
  const [held, setHeld] = useState("");
  const [picked, setPicked] = useState("");
  // The class to place being dragged from the list, for the box that shows where it would land.
  const [dragging, setDragging] = useState("");
  // What the panel beside the week shows: the classes to place, or the teachers' wishes.
  const [side, setSide] = usePageState<"tray" | "wishes">("semester-plan:side", "tray");
  const [wishView, setWishView] = usePageState<WishView>("semester-plan:wish-view", "week");

  const failed = (exc: Error) => {
    setError(exc.message);
    // A refusal for an old revision means the calendar is behind: show what is there now.
    void client.invalidateQueries({ queryKey: ["plan", chosen] });
  };
  /*
   * Closed only once the plan on screen has the change in it: cleared any sooner, a moved
   * class went back to where it was for the moment the plan took to be read again.
   */
  const done = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["plan", chosen] }),
      client.invalidateQueries({ queryKey: ["plans"] }),
    ]);
    setDialog(null);
    setPending(null);
    setConfirmDelete(null);
    setTakingOff(null);
    setError("");
  };

  const place = useMutation({
    // Taught by the group's teacher on Groups & CRNs, so the series names nobody of its own.
    mutationFn: (draft: ClassDraft) => placeClass(chosen, { ...draft, teacherName: "" }),
    onSuccess: done,
    onError: (exc: Error) => setError(exc.message),
  });
  const change = useMutation({
    mutationFn: ({ series, scope, week: at, changes }: { series: PlanSeries; scope: Scope; week?: number; changes: SeriesChanges }) =>
      changeClass(chosen, series.id, { scope, week: at, revision: series.revision, changes }),
    onSuccess: done,
    onError: (exc: Error) => {
      setPending(null);
      failed(exc);
    },
  });
  const remove = useMutation({
    mutationFn: ({ series, scope, week: at }: { series: PlanSeries; scope: Scope; week?: number }) =>
      removeClass(chosen, series.id, { scope, week: at, revision: series.revision }),
    onSuccess: done,
    onError: (exc: Error) => {
      setPending(null);
      setConfirmDelete(null);
      failed(exc);
    },
  });
  const takeOff = useMutation({
    mutationFn: (section: PlanSection) => removeSection(chosen, section.id),
    onSuccess: done,
    onError: (exc: Error) => {
      setTakingOff(null);
      failed(exc);
    },
  });

  /*
   * What the grid prints and how it paints, as the Semester Timetable does: one colour per
   * course, in the order the plan lists them, the course code in bold and the group after it.
   */
  const courses = useMemo(() => {
    const all = data?.sections ?? [];
    const colors = assignColors(all.map((section) => section.courseCode));
    const unlabelled = new Map<string, number>();
    for (const section of all) {
      if (!section.groupLabel) unlabelled.set(section.courseCode, (unlabelled.get(section.courseCode) ?? 0) + 1);
    }
    return new Map<string, CalendarCourse>(
      all.map((section) => [
        keyOf(section),
        {
          crn: section.crn,
          code: section.courseCode,
          title: section.title,
          label: section.courseCode || section.title,
          group: groupWords(section, (unlabelled.get(section.courseCode) ?? 0) > 1),
          staff: section.teacherName,
          tone: "solid",
          color: colors.get(section.courseCode) ?? "#1f4e79",
          openable: true,
        },
      ]),
    );
  }, [data?.sections]);

  /*
   * Every class with what can be asked of it, for the Semester Timetable's own filter bar:
   * the same filters, read the same way. The rooms and the days are the placed classes',
   * so a class is kept when any of its classes answers, and the week then shows only the
   * ones that do — asking for 5.111 shows Monday in 5.111, not the Wednesday elsewhere.
   */
  const rows = useMemo<PlanRow[]>(() => {
    const placedOf = new Map<string, PlanClass[]>();
    for (const entry of data?.classes ?? []) placedOf.set(entry.sectionId, [...(placedOf.get(entry.sectionId) ?? []), entry]);
    return (data?.sections ?? []).map((section) => {
      const classes = placedOf.get(section.id) ?? [];
      return {
        section,
        // Every cohort it is for: a language group, open to all, is in each cohort's week.
        cohort: section.programmes,
        majors: distinct(section.places.flatMap((place) => (place.majors ?? []).map(programCode))),
        subject: subjectOf(section.courseCode),
        code: section.courseCode,
        title: section.title,
        crn: section.crn,
        set: distinct(section.places.map((place) => place.set)).join(", ") || section.component,
        group: section.groupLabel,
        staff: section.teacherName,
        rooms: distinct(classes.map((entry) => formatRoom(entry.room))),
        days: distinct(classes.map((entry) => dayOf(entry.meetsOn))),
      };
    });
  }, [data?.classes, data?.sections]);
  const searched = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words) return rows;
    return rows.filter((row) =>
      [row.crn, row.code, row.title, row.staff, row.group, ...row.cohort, ...row.rooms].join(" ").toLowerCase().includes(words),
    );
  }, [rows, query]);
  const shownIds = useMemo(
    () => new Set(applyFilters(searched, COLUMNS, filters).map((row) => row.section.id)),
    [searched, filters],
  );
  /*
   * The classes still to place answer every filter but the room and the day, which only a
   * placed class has: asking for 5.111 is how to plan 5.111, so its classes to place stay.
   */
  const placeableIds = useMemo(
    () =>
      new Set(
        applyFilters(
          searched,
          COLUMNS,
          filters.filter((filter) => filter.columnId !== "rooms" && filter.columnId !== "days"),
        ).map((row) => row.section.id),
      ),
    [searched, filters],
  );
  const perClass = useMemo(() => filters.filter((filter) => filter.columnId === "rooms" || filter.columnId === "days"), [filters]);
  const narrowed = filters.some((filter) => filter.values.length) || Boolean(query.trim());
  // One room asked for is the room a class drawn now is in.
  const oneRoom = perClass.find((filter) => filter.columnId === "rooms" && filter.values.length === 1)?.values[0] ?? "";

  const sectionShown = (section: PlanSection | undefined): boolean => Boolean(section && placeableIds.has(section.id));
  const classShown = (entry: PlanClass): boolean =>
    shownIds.has(entry.sectionId) &&
    (!perClass.some((filter) => filter.values.length) ||
      applyFilters([{ rooms: [formatRoom(entry.room)], days: [dayOf(entry.meetsOn)] }], CLASS_COLUMNS, perClass).length > 0);

  if (plans.isLoading || (chosen && plan.isLoading)) return <ScreenLoading label="Reading the plan…" />;

  // In the portal's order, as every semester menu lists them; the latest is still the one opened.
  const planOptions = [...(plans.data ?? [])].sort((left, right) => left.termCode.localeCompare(right.termCode)).map((entry) => ({
    value: entry.termCode,
    // The name, its year and its short name, as every other semester menu says them.
    ...semesterShown(entry.name || entry.termCode, yearOfTermCode(entry.termCode), shortNames.data?.[`plan:${entry.termCode}`] ?? ""),
  }));
  const semesterPicker = (
    <div className="w-fit min-w-[12rem] max-w-[min(24rem,100%)]">
      <SelectMenu label="Semester" value={chosen} onChange={onPickTerm} options={planOptions} placeholder="No plan yet" />
    </div>
  );
  // The semester is made, named and given its weeks on the Semesters page.
  const semestersLink = (words: string) =>
    onOpenSemesters ? (
      <button type="button" onClick={onOpenSemesters} className="font-semibold underline">
        {words}
      </button>
    ) : (
      words
    );

  if (!data) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">{semesterPicker}</div>
        <p className="text-sm text-[#667085]">
          {plan.isError ? (
            (plan.error as Error).message
          ) : (
            <>There is no semester to plan yet. Make one on the {semestersLink("Semesters")} page.</>
          )}
        </p>
      </section>
    );
  }

  if (!data.weekOne || !data.weeks) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">{semesterPicker}</div>
        <div className="rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-4 py-3 text-sm text-[#7a5d00]">
          Say when {data.name || data.termCode} starts and how many teaching weeks it has, in its Settings on the{" "}
          {semestersLink("Semesters")} page. Classes are placed by teaching week, so the calendar needs them first.
        </div>
      </section>
    );
  }

  /*
   * The week on screen, stepped through as the Semester Timetable steps: a week at a time,
   * the weeks without classes included, from Week 1 to the last teaching week. It opens on
   * this week while the semester is on, and on Week 1 before it starts.
   */
  const calendar = { weekOne: data.weekOne, without: data.without };
  const firstMonday = weekStartOf(1, calendar);
  const lastMonday = weekStartOf(data.weeks, calendar);
  const within = (when: Date | null) => (when && when >= firstMonday && when <= lastMonday ? when : null);
  const thisWeek = () => within(mondayOf(parseIsoDate(isoToday()))) ?? firstMonday;
  const monday = within(week ? mondayOf(parseIsoDate(week)) : null) ?? thisWeek();
  const goTo = (when: Date) => setWeek(toIsoDate(within(when) ?? (when < firstMonday ? firstMonday : lastMonday)));
  const sunday = shiftWeek(monday, 1);
  sunday.setDate(sunday.getDate() - 1);
  const inWeek = (date: string) => date >= toIsoDate(monday) && date <= toIsoDate(sunday);
  const shownClasses = data.classes.filter(classShown);
  const lost = data.skipped.filter((entry) => inWeek(entry.meetsOn) && classShown(entry));
  const holidays = data.holidays.filter((holiday) => inWeek(holiday.date));

  /*
   * The classes as the grid draws them: the whole semester's, so the hours across the top
   * hold still from week to week, as on the Semester Timetable. Each carries what it clashes
   * with, in words, for its hover.
   */
  const classOf = new Map<PlacedSession, PlanClass>();
  // A class dragged and dropped, waiting on "this one, the following, or all?": drawn where it was dropped.
  const asked = pending?.verb === "change" ? pending : null;
  const sessions: PlacedSession[] = shownClasses.map((entry) => {
    const section = sectionsById.get(entry.sectionId);
    const its = clashes.get(entry) ?? [];
    const moving = asked && asked.entry.seriesId === entry.seriesId && asked.entry.week === entry.week ? asked.changes : null;
    const day = parseIsoDate(entry.meetsOn);
    if (moving?.weekday) day.setDate(day.getDate() + moving.weekday - entry.weekday);
    const session: PlacedSession = {
      crn: section ? keyOf(section) : entry.sectionId,
      termCode: data.termCode,
      date: toIsoDate(day),
      start: moving?.startsAt ?? entry.startsAt,
      end: moving?.endsAt ?? entry.endsAt,
      room: moving?.room ?? entry.room,
      tentative: Boolean(moving),
      clashes: its.length > 0,
      clashSaid: its
        .map((clash) => `${CLASH_WORDS[clash.kind]} ${sectionLabel(sectionsById.get(clash.with.sectionId))} (${clash.with.startsAt}–${clash.with.endsAt})`)
        .join("; "),
      wish: (() => {
        const flag = wishCheck?.flags.get(entry);
        // A line each on the flag's hover: the Musts and periods first.
        return flag ? { level: flag.level, said: flag.said.join("\n") } : undefined;
      })(),
    };
    classOf.set(session, entry);
    return session;
  });
  const entryOf = (session: PlacedSession) =>
    classOf.get(session) ??
    shownClasses.find((entry) => {
      const section = sectionsById.get(entry.sectionId);
      return entry.meetsOn === session.date && entry.startsAt === session.start && section && keyOf(section) === session.crn;
    });

  const allWeeks = Array.from({ length: data.weeks }, (_, index) => index + 1);
  const weekNo = allWeeks.find((n) => toIsoDate(weekStartOf(n, calendar)) === toIsoDate(monday)) ?? null;

  /*
   * Whose wishes the grid shades: the teacher of the class being moved, from the list or
   * across the week; else of the class last opened, until something is drawn; else the one
   * teacher the plan is filtered to.
   */
  const wishTeachers = wishSemester.data?.teachers ?? [];
  const filteredTeacherName = filters.find((filter) => filter.columnId === "staff" && filter.values.length === 1)?.values[0] ?? "";
  const filteredTeacher = filteredTeacherName
    ? (data.sections.find((section) => section.teacherName === filteredTeacherName && section.teacherId)?.teacherId ?? "")
    : "";
  const focusId = held || picked || filteredTeacher;
  const focusRow = wishTeachers.find((row) => row.teacherId === focusId) ?? null;
  const focusName = focusRow?.name ?? data.sections.find((section) => section.teacherId === focusId)?.teacherName ?? "";
  const focusShades = focusRow?.wishes ? shadingOf(focusRow.wishes) : {};
  const shading = (date: string): Shade[] => {
    const weekday = weekdayOf(date);
    const shades: Shade[] = [];
    // The semester's periods bind everybody, so they are always there in their weeks.
    for (const period of data.periods ?? []) {
      if (date < period.from || date > period.to || !period.days.includes(weekday)) continue;
      shades.push({ from: period.blockFrom, to: period.blockTo, tone: "period", title: periodWords(period) });
    }
    if (focusRow?.wishes) {
      for (const stretch of focusShades[weekday] ?? []) {
        shades.push({
          from: stretch.from,
          to: stretch.to,
          tone: stretch.kind,
          title: `${focusRow.name} ${stretch.kind === "cant" ? "can't teach" : "would rather teach"} ${stretch.from}–${stretch.to}`,
        });
      }
      for (const away of focusRow.wishes.away) {
        if (date >= away.from && date <= away.to) {
          shades.push({ from: "00:00", to: "23:59", tone: "cant", title: `${focusRow.name} is away${away.reason ? `: ${away.reason}` : ""}` });
        }
      }
    }
    return shades;
  };
  const answeredIds = new Set(wishTeachers.filter((row) => row.wishes).map((row) => row.teacherId));
  /**
   * What would go wrong if a class sat at a slot of the week on screen: the one being moved
   * (which no longer clashes with itself), or the one dragged in from the list.
   */
  const judge = (slot: GridSlot, session: PlacedSession | null): GhostJudgement | null => {
    const entry = session ? entryOf(session) : undefined;
    const sectionId = entry?.sectionId ?? (session ? "" : dragging);
    if (!sectionId || weekNo === null) return null;
    const { problems, worst } = judgeSlot(data, wishTeachers, {
      sectionId,
      weekday: weekdayOf(slot.date),
      startsAt: slot.start,
      endsAt: slot.end,
      room: entry ? entry.room : oneRoom,
      weeks: [weekNo],
      replacing: entry ? { seriesId: entry.seriesId, weeks: [entry.week] } : undefined,
    });
    const clash = problems.some((problem) => problem.kind === "clash");
    return {
      worst,
      label: clash ? "Clash" : worst === "must" ? "Breaks a Must" : worst ? "Breaks a wish" : "",
      said: problems.map((problem) => problem.said).join("\n"),
    };
  };
  const flaggedSections = new Set([...(wishCheck?.flags.keys() ?? [])].map((entry) => entry.sectionId));
  const thisWeekBroken = (wishCheck?.breaches ?? []).filter((breach) => breach.week === weekNo).length;
  /**
   * A new class at a slot. Drawn on the grid, it is as long as it was drawn; dropped from the
   * list or added with +, as long as one session of it is on Groups & CRNs.
   */
  const draftFor = (sectionId: string, slot: GridSlot, drawn = false): ClassDraft => ({
    sectionId,
    weekday: weekdayOf(slot.date),
    startsAt: slot.start,
    endsAt: drawn ? slot.end : endOf(sectionsById.get(sectionId), slot.start, slot.end),
    room: oneRoom,
    teacherName: "",
    weeks: allWeeks,
    note: "",
  });
  const openClass = (entry: PlanClass) => {
    const series = seriesById.get(entry.seriesId);
    if (!series) return;
    setError("");
    setDialog({
      entry,
      series,
      draft: {
        sectionId: entry.sectionId,
        weekday: entry.weekday,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        room: entry.room,
        teacherName: "",
        weeks: series.weeks,
        note: series.note,
      },
    });
  };
  /** A change to one dated class: asked about when its series has more than one week. */
  const changeOne = (entry: PlanClass, series: PlanSeries, changes: SeriesChanges) => {
    if (series.weeks.length === 1) {
      change.mutate({ series, scope: "all", changes });
      return;
    }
    setPending({ verb: "change", entry, series, changes });
  };
  const save = (draft: ClassDraft) => {
    if (!dialog?.entry || !dialog.series) {
      place.mutate(draft);
      return;
    }
    const { entry, series } = dialog;
    const own: SeriesChanges = {};
    for (const key of ["weekday", "startsAt", "endsAt", "room"] as const) {
      if (draft[key] !== entry[key]) Object.assign(own, { [key]: draft[key] });
    }
    const weeksChanged = draft.weeks.join() !== series.weeks.join();
    const noteChanged = draft.note !== series.note;
    if (weeksChanged || noteChanged) {
      change.mutate({
        series,
        scope: "all",
        changes: { ...own, ...(weeksChanged ? { weeks: draft.weeks } : {}), ...(noteChanged ? { note: draft.note } : {}) },
      });
    } else if (Object.keys(own).length) {
      changeOne(entry, series, own);
    } else {
      setDialog(null);
    }
  };
  const askDelete = () => {
    if (!dialog?.entry || !dialog.series) return;
    if (dialog.series.weeks.length > 1) setPending({ verb: "delete", entry: dialog.entry, series: dialog.series });
    else setConfirmDelete({ entry: dialog.entry, series: dialog.series });
  };

  const toPlace = data.sections.filter(sectionShown);
  const placeable = toPlace.filter((section) => !section.gone);
  /*
   * The list beside the week: the page's filters, then its own search, which of the classes
   * (still to place, fully placed, missing a teacher or a CRN), and its own order. A class
   * gone from Groups & CRNs heads it whatever is chosen: it needs somebody to act.
   */
  const hoursLeft = (section: PlanSection) => (section.hours ?? 0) - (placed.get(section.id) ?? 0);
  const stillToPlace = (section: PlanSection) => hoursLeft(section) > 0.01 || (!section.hours && !placed.get(section.id));
  const trayWords = traySearch.trim().toLowerCase();
  const trayFound = (section: PlanSection) =>
    !trayWords ||
    [section.courseCode, section.title, section.groupLabel, section.crn, section.teacherName, ...section.programmes]
      .join(" ")
      .toLowerCase()
      .includes(trayWords);
  const keeps = (show: TrayShow, section: PlanSection) =>
    show === "to-place"
      ? stillToPlace(section)
      : show === "placed"
        ? !stillToPlace(section)
        : show === "no-teacher"
          ? !section.teacherName
          : show === "no-crn"
            ? !section.crn
            : show === "wishes"
              ? flaggedSections.has(section.id)
              : true;
  const trayKept = (section: PlanSection) => keeps(trayShow, section);
  // How many each choice would show, beside it: the page's filters and the search still apply.
  const found = placeable.filter(trayFound);
  const trayCounts = Object.fromEntries(
    TRAY_SHOW.map((option) => [option.value, found.filter((section) => keeps(option.value, section)).length]),
  ) as Record<TrayShow, number>;
  const byCourse = (a: PlanSection, b: PlanSection) =>
    byNumber(a.courseCode, b.courseCode) || byNumber(a.groupLabel, b.groupLabel) || a.position - b.position;
  const trayOrder: Record<TraySort, (a: PlanSection, b: PlanSection) => number> = {
    groups: (a, b) => a.position - b.position,
    course: byCourse,
    left: (a, b) => hoursLeft(b) - hoursLeft(a) || byCourse(a, b),
    // Nobody named yet goes last, not first.
    teacher: (a, b) =>
      Number(!a.teacherName) - Number(!b.teacherName) || byNumber(a.teacherName, b.teacherName) || byCourse(a, b),
    cohort: (a, b) => byNumber(a.programmes.join(), b.programmes.join()) || a.position - b.position,
  };
  const trayShown = [
    ...toPlace.filter((section) => section.gone && trayFound(section)),
    ...placeable.filter((section) => trayFound(section) && trayKept(section)).sort(trayOrder[traySort]),
  ];

  /*
   * The PDF for the timetabling team: the Semester Timetable's own export, fed the plan's
   * classes instead of the portal's, for whatever the filters show.
   */
  const exportSections = new Map<string, SemesterExportInput["sections"][number]>();
  for (const entry of shownClasses) {
    const section = sectionsById.get(entry.sectionId);
    if (!section) continue;
    const held =
      exportSections.get(section.id) ??
      ({
        crn: section.crn,
        courseCode: section.courseCode,
        title: section.title,
        teacher: section.teacherName,
        group: courses.get(keyOf(section))?.group ?? "",
        meetings: [],
        notes: [],
      } satisfies SemesterExportInput["sections"][number]);
    held.meetings.push({ meetsOn: entry.meetsOn, startsAt: entry.startsAt, endsAt: entry.endsAt, room: entry.room });
    exportSections.set(section.id, held);
  }
  const roomSeats: Record<string, number> = {};
  for (const entry of shownClasses) {
    const seats = entry.room ? roomOf(entry.room)?.seats : null;
    if (seats !== null && seats !== undefined) roomSeats[entry.room] = seats;
  }
  const exportInput: SemesterExportInput = {
    semester: data.name || data.termCode,
    layout: "days",
    sections: [...exportSections.values()],
    roomSeats,
    weekOne: calendar,
    source: "plan",
  };

  return (
    /*
     * The page is exactly the screen and the grid scrolls inside it, as the Semester
     * Timetable's does: the controls and the week are what you steer by, so they stay put.
     */
    <section className="flex h-full min-h-0 flex-col">
      {/* The Semester Timetable's two rows: what you steer by, then its filter bar. */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-3">
        <h2 className="flex shrink-0 items-center gap-2 text-lg font-semibold text-[#171717]">
          <CalendarCheck size={18} aria-hidden="true" /> Semester plan
        </h2>
        {semesterPicker}
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" aria-label="Previous week" disabled={monday <= firstMonday} onClick={() => goTo(shiftWeek(monday, -1))} className={STEP}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(thisWeek())} className={`${STEP} px-2 text-xs font-semibold`}>
            Current week
          </button>
          <button type="button" aria-label="Next week" disabled={monday >= lastMonday} onClick={() => goTo(shiftWeek(monday, 1))} className={STEP}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <TeachingWeek shown={monday} weekOne={calendar} sessions={sessions} until={lastMonday} onGo={goTo} />
          <span className="text-xs font-semibold text-[#344054]">{weekLabel(monday, sessions)}</span>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <label className="relative block w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#667085]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search classes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="w-full rounded-md border border-[#d3d9e2] bg-white py-1.5 pl-8 pr-2 text-sm"
            />
          </label>
          <Zoom label="Width" value={widthZoom} {...WIDTH} onChange={setWidthZoom} />
          <Zoom label="Height" value={heightZoom} {...HEIGHT} onChange={setHeightZoom} />
          <button type="button" onClick={() => setExportOpen(true)} className={CONTROL}>
            <Download size={14} aria-hidden="true" /> Export
          </button>
          <span className="text-xs text-[#98a2b3]">{`${shownIds.size} of ${data.sections.length}`}</span>
          {narrowed ? (
            <button
              type="button"
              onClick={() => {
                setFilters([]);
                setQuery("");
              }}
              className="text-xs font-semibold text-[#1f4e79] underline"
            >
              Every class
            </button>
          ) : null}
        </div>
      </div>
      {error && !dialog ? (
        <p role="alert" className="mb-2 shrink-0 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-2 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}
      {holidays.length || lost.length ? (
        <p className="mb-2 shrink-0 rounded-md border border-[#f0c36d] bg-[#fdf6e3] px-4 py-2 text-sm text-[#7a5d00]">
          {holidays.map((holiday) => `${formatDayAndMonth(holiday.date)}: ${holiday.label || "holiday"}, no classes.`).join(" ")}
          {lost.length
            ? ` Not held: ${lost.map((entry) => `${sectionLabel(sectionsById.get(entry.sectionId))} (${WEEKDAY_NAMES[entry.weekday - 1]} ${entry.startsAt})`).join("; ")}.`
            : ""}
        </p>
      ) : null}

      {/* The filters, over the week; the banners sit above them. */}
      <div className="mb-3 flex shrink-0 items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <TableFilterBar columns={COLUMNS} filters={filters} optionsFor={(column) => optionsFor(rows, column)} onChange={setFilters} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WeekTimeline
            fills
            weekStart={monday}
            sessions={sessions}
            courses={courses}
            today={isoToday()}
            widthZoom={widthZoom}
            heightZoom={heightZoom}
            squeeze={{ width: widthZoom <= WIDTH.min }}
            atLeast={{ startMinute: 8 * 60, endMinute: 19 * 60 }}
            seatsOf={(room) => roomOf(room)?.seats ?? null}
            shading={shading}
            editing={{
              onHold: (session) => {
                const entry = session ? entryOf(session) : undefined;
                setHeld(entry ? (sectionsById.get(entry.sectionId)?.teacherId ?? "") : "");
              },
              onDraw: (slot) => {
                setError("");
                setPicked("");
                // Narrowed to one class to place, a drawn slot is that class.
                setDialog({ draft: draftFor(placeable.length === 1 ? placeable[0].id : "", slot, true) });
              },
              onOpen: (session) => {
                const entry = entryOf(session);
                if (!entry) return;
                setPicked(sectionsById.get(entry.sectionId)?.teacherId ?? "");
                openClass(entry);
              },
              onMove: (session, slot) => {
                const entry = entryOf(session);
                const series = entry ? seriesById.get(entry.seriesId) : undefined;
                if (!entry || !series) return;
                const changes: SeriesChanges = {};
                const weekday = weekdayOf(slot.date);
                if (weekday !== entry.weekday) changes.weekday = weekday;
                if (slot.start !== entry.startsAt) changes.startsAt = slot.start;
                if (slot.end !== entry.endsAt) changes.endsAt = slot.end;
                if (Object.keys(changes).length) changeOne(entry, series, changes);
              },
              dropType: SECTION_DRAG,
              // At the class's own length, as it will be placed.
              dropSlot: (slot) => (dragging ? { ...slot, end: endOf(sectionsById.get(dragging), slot.start, slot.end) } : null),
              judge,
              onDrop: (sectionId, slot) => {
                setError("");
                setDragging("");
                setDialog({ draft: draftFor(sectionId, slot) });
              },
            }}
          />
          {focusId && focusName ? (
            <p className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2 text-xs text-[#667085]">
              {focusRow?.wishes ? (
                <>
                  <span className="font-semibold text-[#344054]">{focusName}&rsquo;s wishes:</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-3 rounded-sm border border-[#a6292f]/40 bg-[#a6292f]/[0.15]" /> can&rsquo;t teach
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2.5 w-3 rounded-sm border border-[#2e7d55]/40 bg-[#2e7d55]/[0.15]" /> would rather
                  </span>
                  {focusRow.wishes.status === "draft" ? <span>(a draft)</span> : null}
                </>
              ) : (
                <span>{focusName} hasn&rsquo;t given their wishes for this semester.</span>
              )}
              {!held && picked ? (
                <button type="button" onClick={() => setPicked("")} className="font-semibold text-[#1f4e79] underline">
                  Hide
                </button>
              ) : null}
            </p>
          ) : (
            <p className="mt-1.5 shrink-0 text-xs text-[#667085]">
              Drag along a day to place a class, or drop one from the list. Drag a class to move it, its right-hand end to
              change its length; click it to open it.
            </p>
          )}
        </div>

        <aside className="hidden min-h-0 w-80 shrink-0 flex-col lg:flex" aria-label={side === "wishes" ? "Teacher wishes" : "Classes to place"}>
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#d9dee7] bg-white">
          {/*
            * Beside the week: the classes to place, or what the plan does to the teachers' wishes.
            * Two tabs on one line, the one open underlined, each with its count in a pill.
            */}
          <div role="tablist" aria-label="Beside the week" className="flex shrink-0 border-b border-[#e4e8ef]">
            {(
              [
                {
                  value: "tray",
                  label: "To place",
                  title: "Classes to place",
                  count: trayShown.length !== toPlace.length ? `${trayShown.length} of ${toPlace.length}` : String(toPlace.length),
                  alarm: false,
                },
                { value: "wishes", label: "Wishes", title: "Teacher wishes broken this week", count: String(thisWeekBroken), alarm: thisWeekBroken > 0 },
              ] as const
            ).map((tab) => {
              const on = side === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  id={`plan-side-${tab.value}`}
                  aria-selected={on}
                  aria-controls="plan-side-panel"
                  title={tab.title}
                  onClick={() => setSide(tab.value)}
                  className={`-mb-px flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
                    on ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
                  }`}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      tab.alarm ? "bg-[#fdf3f3] text-[#a6292f]" : on ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div id="plan-side-panel" role="tabpanel" aria-labelledby={`plan-side-${side}`} className="flex min-h-0 flex-1 flex-col">
          {side === "wishes" ? (
            <PlanWishesPanel
              check={wishCheck}
              collection={wishSemester.data?.collection ?? null}
              week={weekNo}
              view={wishView}
              onView={setWishView}
              onFocus={(teacherId) => setPicked(teacherId)}
              failed={wishSemester.isError ? "The teachers' wishes could not be read." : undefined}
            />
          ) : (
          <>
          <div className="grid shrink-0 gap-2 border-b border-[#eef1f5] px-3 py-2.5">
            {/* The search, and the order as an icon beside it rather than a row of its own. */}
            <div className="flex items-center gap-1.5">
              <label className="relative block min-w-0 flex-1">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#667085]" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search classes to place"
                  value={traySearch}
                  onChange={(event) => setTraySearch(event.target.value)}
                  placeholder="Course, group, CRN, teacher"
                  className="w-full rounded-md border border-[#d3d9e2] bg-white py-1.5 pl-8 pr-2 text-sm"
                />
              </label>
              <SortMenu value={traySort} options={TRAY_SORT} onChange={setTraySort} />
            </div>
            {/* Which of them, as chips that say how many each holds and wrap rather than cut a word. */}
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
              {TRAY_SHOW.map((option) => {
                const on = trayShow === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTrayShow(option.value)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                      on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
                    }`}
                  >
                    {option.label}
                    <span
                      className={`rounded-full px-1.5 tabular-nums ${on ? "bg-white/20 text-white" : "bg-[#eef1f5] text-[#667085]"}`}
                    >
                      {trayCounts[option.value]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-[#f2f4f7] overflow-y-auto">
            {trayShown.map((section) => {
              const course = courses.get(keyOf(section));
              const doneHours = placed.get(section.id) ?? 0;
              const asked = section.hours ?? 0;
              const share = asked ? Math.min(1, doneHours / asked) : doneHours ? 1 : 0;
              const over = asked > 0 && doneHours > asked + 0.01;
              const facts = [section.courseCode, section.crn ? `CRN ${section.crn}` : "no CRN yet", section.teacherName || "no teacher yet"];
              if (section.gone) {
                return (
                  <li key={section.id} className="bg-[#fdf3f3] px-3 py-2">
                    <p className="truncate text-sm font-semibold text-[#a6292f]" title={section.title}>
                      {sectionLabel(section)}
                    </p>
                    <p className="text-xs text-[#a6292f]">
                      No longer on Groups & CRNs, but still on the calendar ({Math.round(doneHours * 10) / 10} h placed).
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        setTakingOff(section);
                      }}
                      className="mt-1 text-xs font-semibold text-[#a6292f] underline"
                    >
                      Take it off the plan
                    </button>
                  </li>
                );
              }
              return (
                <li
                  key={section.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SECTION_DRAG, section.id);
                    event.dataTransfer.effectAllowed = "copy";
                    setHeld(section.teacherId ?? "");
                    setDragging(section.id);
                  }}
                  onDragEnd={() => {
                    setHeld("");
                    setDragging("");
                  }}
                  className="cursor-grab px-3 py-2 hover:bg-[#f8fafc] active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: course?.color ?? "#1f4e79" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#344054]" title={section.title}>
                        {section.places.length ? sectionLabel(section) : section.title || section.courseCode}
                      </p>
                      <p className="truncate text-xs text-[#667085]">
                        {(section.places.length ? facts.slice(1) : facts).filter(Boolean).join(" · ")}
                      </p>
                      {wishSemester.data?.collection && section.teacherId && !answeredIds.has(section.teacherId) ? (
                        <span className="mt-0.5 inline-block rounded-full bg-[#f2f4f7] px-1.5 text-[11px] text-[#667085]">
                          no wishes
                        </span>
                      ) : null}
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef1f5]">
                          <div className={`h-full ${over ? "bg-[#d92d20]" : share >= 1 ? "bg-[#2f6b3d]" : "bg-[#1f4e79]"}`} style={{ width: `${share * 100}%` }} />
                        </div>
                        <span className={`shrink-0 text-xs tabular-nums ${over ? "font-semibold text-[#a6292f]" : "text-[#667085]"}`}>
                          {Math.round(doneHours * 10) / 10}
                          {asked ? ` of ${asked}` : ""} h
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Place ${section.places.length ? sectionLabel(section) : section.title || section.courseCode}`}
                      onClick={() => {
                        setError("");
                        setDialog({ draft: draftFor(section.id, { date: toIsoDate(monday), start: "08:30", end: "10:00" }) });
                      }}
                      className="rounded p-1 text-[#1f4e79] hover:bg-[#e8edf3]"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </li>
              );
            })}
            {!trayShown.length ? (
              <li className="px-3 py-4 text-sm text-[#667085]">
                {data.sections.length ? (
                  toPlace.length ? (
                    "No class here matches."
                  ) : (
                    "Nothing here to place."
                  )
                ) : (
                  <>
                    No classes yet. They come from Groups & CRNs: give {data.name || "this semester"}&rsquo;s cohorts their
                    sets, courses and groups there, and each group&rsquo;s classes appear here to place.
                    {onOpenGroups ? (
                      <button type="button" onClick={onOpenGroups} className="mt-2 block font-semibold text-[#1f4e79] underline">
                        Open Groups & CRNs
                      </button>
                    ) : null}
                  </>
                )}
              </li>
            ) : null}
          </ul>
          </>
          )}
          </div>
          </div>
        </aside>
      </div>

      {dialog ? (
        <PlanClassDialog
          open
          plan={data}
          rooms={rooms.map((room) => room.code)}
          initial={dialog.draft}
          wishTeachers={wishSemester.data?.collection ? wishTeachers : undefined}
          editing={
            dialog.entry && dialog.series
              ? {
                  week: dialog.entry.week,
                  meetsOn: dialog.entry.meetsOn,
                  seriesWeeks: dialog.series.weeks.length,
                  seriesId: dialog.series.id,
                  updatedBy: dialog.series.updatedBy,
                  updatedAt: dialog.series.updatedAt,
                }
              : undefined
          }
          busy={place.isPending || change.isPending}
          error={error}
          onSave={save}
          onDelete={dialog.entry ? askDelete : undefined}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        />
      ) : null}
      {pending ? (
        <ScopeDialog
          open
          verb={pending.verb}
          when={`${WEEKDAY_NAMES[pending.entry.weekday - 1]} ${formatDayAndMonth(pending.entry.meetsOn)}`}
          week={pending.entry.week}
          firstWeek={pending.series.weeks[0]}
          count={pending.series.weeks.length}
          movedApart={pending.series.moves.length}
          busy={change.isPending || remove.isPending}
          onChoose={(scope) => {
            const at = scope === "all" ? undefined : pending.entry.week;
            if (pending.verb === "change") change.mutate({ series: pending.series, scope, week: at, changes: pending.changes });
            else remove.mutate({ series: pending.series, scope, week: at });
          }}
          onClose={() => setPending(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(takingOff)}
        title="Take this class off the plan?"
        description={
          takingOff
            ? `${sectionLabel(takingOff)} is no longer on Groups & CRNs. Every class of it placed on the calendar comes off, for everybody.`
            : ""
        }
        confirmLabel="Take it off"
        busy={takeOff.isPending}
        onConfirm={() => takingOff && takeOff.mutate(takingOff)}
        onClose={() => setTakingOff(null)}
      />
      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete this class?"
        description={
          confirmDelete
            ? `${sectionLabel(sectionsById.get(confirmDelete.entry.sectionId))}, ${weeksSaid(confirmDelete.series.weeks)}. It comes off the plan for everybody.`
            : ""
        }
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => confirmDelete && remove.mutate({ series: confirmDelete.series, scope: "all" })}
        onClose={() => setConfirmDelete(null)}
      />
      <SemesterExport
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        input={exportInput}
        shown={`${exportSections.size} of ${data.sections.length} classes`}
      />
    </section>
  );
}
