import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, FileDown, Plus, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NewPlanDialog, PlanClassDialog, PlanSettingsDialog, ScopeDialog, type ClassDraft } from "@/components/PlanDialogs";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { SemesterExport } from "@/components/SemesterExport";
import { Zoom } from "@/components/TimelineZoom";
import { usePageState } from "@/components/usePageState";
import { WeekTimeline, type GridSlot } from "@/components/WeekTimeline";
import { useKeptNumber } from "@/services/keptNumber";
import { HEIGHT, WIDTH } from "@/services/timelineZoom";
import { useRooms } from "@/services/rooms";
import {
  SECTION_DRAG,
  WEEKDAY_NAMES,
  changeClass,
  clashesOf,
  createPlan,
  fetchPlan,
  fetchPlans,
  groupWords,
  placeClass,
  plannedHours,
  removeClass,
  sectionLabel,
  settlePlan,
  updateSection,
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
  assignColors,
  formatDayAndMonth,
  isoToday,
  parseIsoDate,
  toIsoDate,
  weekStartOf,
  type CalendarCourse,
  type PlacedSession,
} from "@/services/weekSchedule";

type Lens = "programme" | "teacher" | "room" | "course" | "all";

const LENSES: { value: Lens; label: string }[] = [
  { value: "programme", label: "Programme" },
  { value: "teacher", label: "Teacher" },
  { value: "room", label: "Room" },
  { value: "course", label: "Course" },
  { value: "all", label: "Everything" },
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
const STEP =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40";

/**
 * A semester planned before the registrar books it, drawn on the Semester Timetable's own
 * grid: the days down the side, the hours across, the same boxes in the same colours, and
 * the same two zooms. What it adds is the drawing — see `editing` on `WeekTimeline`.
 *
 * One week at a time, seen through one lens: a programme (and one of its groups), a
 * teacher, a room or a course. Beside it, the classes still to place, each with the hours
 * placed against the hours asked for — drag one onto the week to place it. Everything is
 * saved as it is done; several coordinators plan the same semester and each needs to see
 * the others' classes.
 */
export function SemesterPlan({ termCode, onPickTerm }: { termCode: string; onPickTerm: (termCode: string) => void }) {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans });
  const chosen = termCode || plans.data?.[0]?.termCode || "";
  const plan = useQuery({
    queryKey: ["plan", chosen],
    queryFn: () => fetchPlan(chosen),
    enabled: Boolean(chosen),
    // Somebody else may be planning the same semester.
    refetchInterval: 30_000,
  });
  const { rooms, roomOf } = useRooms();

  const [lens, setLens] = usePageState<Lens>("plan:lens", "programme");
  const [focus, setFocus] = usePageState<string>("plan:focus", "");
  const [group, setGroup] = usePageState<string>("plan:group", "");
  const [week, setWeek] = usePageState<number>("plan:week", 1);
  const [onlyToPlace, setOnlyToPlace] = usePageState<boolean>("plan:only-to-place", false);
  const [widthZoom, setWidthZoom] = useKeptNumber("semester-plan:width", WIDTH);
  const [heightZoom, setHeightZoom] = useKeptNumber("semester-plan:height", HEIGHT);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [dialog, setDialog] = useState<{ draft: ClassDraft; entry?: PlanClass; series?: PlanSeries } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ entry: PlanClass; series: PlanSeries } | null>(null);
  const [error, setError] = useState("");

  const data = plan.data;
  const sectionsById = useMemo(() => new Map((data?.sections ?? []).map((section) => [section.id, section])), [data?.sections]);
  const seriesById = useMemo(() => new Map((data?.series ?? []).map((series) => [series.id, series])), [data?.series]);
  const clashes = useMemo(() => (data ? clashesOf(data) : new Map<PlanClass, Clash[]>()), [data]);
  const placed = useMemo(() => (data ? plannedHours(data) : new Map<string, number>()), [data]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["plan", chosen] });
    void client.invalidateQueries({ queryKey: ["plans"] });
  };
  // A plan is a semester of the app: its name, its link and its weeks are read everywhere.
  const semestersChanged = () => {
    for (const key of ["timetable-terms", "term-links", "term-weeks"]) void client.invalidateQueries({ queryKey: [key] });
  };
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
    setError("");
  };
  /** The teacher is the CRN's, as on the portal: said once, it is every class of the section's. */
  const teach = async (section: PlanSection | undefined, teacherName: string) => {
    if (section && teacherName.trim() !== section.teacherName) {
      await updateSection(chosen, { ...section, teacherName: teacherName.trim() });
    }
  };

  const settle = useMutation({
    mutationFn: (settings: Parameters<typeof settlePlan>[1]) => settlePlan(chosen, settings),
    onSuccess: (fresh) => {
      client.setQueryData(["plan", chosen], fresh);
      setSettingsOpen(false);
      setError("");
      refresh();
      semestersChanged();
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const create = useMutation({
    mutationFn: ({ code, name }: { code: string; name: string }) => createPlan(code, name),
    onSuccess: (fresh) => {
      setNewOpen(false);
      setError("");
      void client.invalidateQueries({ queryKey: ["plans"] });
      semestersChanged();
      onPickTerm(fresh.termCode);
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const place = useMutation({
    mutationFn: async (draft: ClassDraft) => {
      await teach(sectionsById.get(draft.sectionId), draft.teacherName);
      return placeClass(chosen, { ...draft, teacherName: "" });
    },
    onSuccess: done,
    onError: (exc: Error) => setError(exc.message),
  });
  const change = useMutation({
    mutationFn: async ({
      series,
      scope,
      week: at,
      changes,
      teacher,
    }: {
      series: PlanSeries;
      scope: Scope;
      week?: number;
      changes: SeriesChanges;
      teacher?: string;
    }) => {
      if (teacher !== undefined) await teach(sectionsById.get(series.sectionId), teacher);
      if (Object.keys(changes).length) await changeClass(chosen, series.id, { scope, week: at, revision: series.revision, changes });
    },
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

  // What each lens can be pointed at, from what the plan holds.
  const choices = useMemo(() => {
    const all = data?.sections ?? [];
    return {
      programme: distinct(all.flatMap((section) => section.programmes)),
      teacher: distinct([...all.map((section) => section.teacherName), ...(data?.classes ?? []).map((entry) => entry.teacherName)]),
      room: distinct([...(data?.classes ?? []).map((entry) => entry.room), ...rooms.map((room) => room.code)]),
      course: distinct(all.map((section) => section.courseCode)),
    };
  }, [data, rooms]);
  const lensChoices = lens === "all" ? [] : choices[lens];
  const focused = lens === "all" ? "" : lensChoices.includes(focus) ? focus : (lensChoices[0] ?? "");
  const groups = useMemo(
    () =>
      lens === "programme"
        ? distinct((data?.sections ?? []).filter((section) => section.programmes.includes(focused)).map((section) => section.groupLabel))
        : [],
    [data?.sections, lens, focused],
  );
  const groupFocused = groups.includes(group) ? group : "";

  const sectionShown = (section: PlanSection | undefined): boolean => {
    if (!section) return false;
    if (lens === "programme") {
      return section.programmes.includes(focused) && (!groupFocused || !section.groupLabel || section.groupLabel === groupFocused);
    }
    if (lens === "teacher") return section.teacherName === focused;
    if (lens === "course") return section.courseCode === focused;
    return true;
  };
  const classShown = (entry: PlanClass): boolean => {
    if (lens === "teacher") return entry.teacherName === focused;
    if (lens === "room") return entry.room === focused;
    return sectionShown(sectionsById.get(entry.sectionId));
  };

  if (plans.isLoading || (chosen && plan.isLoading)) return <ScreenLoading label="Reading the plan…" />;

  const planOptions = (plans.data ?? []).map((entry) => ({
    value: entry.termCode,
    label: entry.name || entry.termCode,
    badge: entry.termCode,
    badgeTone: "muted" as const,
  }));
  const semesterPicker = (
    <div className="w-64">
      <SelectMenu label="Semester" value={chosen} onChange={onPickTerm} options={planOptions} placeholder="No plan yet" />
    </div>
  );
  const newPlanButton = (
    <button type="button" onClick={() => setNewOpen(true)} className={CONTROL}>
      <CalendarPlus size={14} aria-hidden="true" /> New plan
    </button>
  );
  const newPlan = (
    <NewPlanDialog
      open={newOpen}
      busy={create.isPending}
      error={newOpen ? error : ""}
      onCreate={(code, name) => create.mutate({ code, name })}
      onClose={() => {
        setNewOpen(false);
        setError("");
      }}
    />
  );

  if (!data) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {semesterPicker}
          {newPlanButton}
        </div>
        <p className="text-sm text-[#667085]">
          {plan.isError ? (plan.error as Error).message : "There is no semester plan yet. Start one with New plan."}
        </p>
        {newPlan}
      </section>
    );
  }

  const settings = (
    <PlanSettingsDialog
      open={settingsOpen}
      plan={data}
      busy={settle.isPending}
      error={settingsOpen ? error : ""}
      onSave={(value) => settle.mutate(value)}
      onClose={() => {
        setSettingsOpen(false);
        setError("");
      }}
    />
  );
  const settingsButton = (
    <button type="button" onClick={() => setSettingsOpen(true)} className={CONTROL}>
      <Settings2 size={14} aria-hidden="true" /> Semester settings
    </button>
  );

  if (!data.weekOne || !data.weeks) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {semesterPicker}
          {settingsButton}
          {newPlanButton}
        </div>
        <div className="rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-4 py-3 text-sm text-[#7a5d00]">
          Say when {data.name || data.termCode} starts and how many teaching weeks it has, in{" "}
          <button type="button" onClick={() => setSettingsOpen(true)} className="font-semibold underline">
            Semester settings
          </button>
          . Classes are placed by teaching week, so the calendar needs them first.
        </div>
        {settings}
        {newPlan}
      </section>
    );
  }

  const calendar = { weekOne: data.weekOne, without: data.without };
  const shownWeek = Math.min(Math.max(1, week), data.weeks);
  const monday = weekStartOf(shownWeek, calendar);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const shownClasses = data.classes.filter(classShown);
  const lost = data.skipped.filter((entry) => entry.week === shownWeek && classShown(entry));
  const holidays = data.holidays.filter((holiday) => holiday.date >= toIsoDate(monday) && holiday.date <= toIsoDate(sunday));

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
  const draftFor = (sectionId: string, slot: GridSlot): ClassDraft => ({
    sectionId,
    weekday: weekdayOf(slot.date),
    startsAt: slot.start,
    endsAt: slot.end,
    room: lens === "room" ? focused : "",
    teacherName: sectionsById.get(sectionId)?.teacherName ?? "",
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
        teacherName: sectionsById.get(entry.sectionId)?.teacherName ?? "",
        weeks: series.weeks,
        note: series.note,
      },
    });
  };
  /** A change to one dated class: asked about when its series has more than one week. */
  const changeOne = (entry: PlanClass, series: PlanSeries, changes: SeriesChanges, teacher?: string) => {
    if (series.weeks.length === 1 || !Object.keys(changes).length) {
      change.mutate({ series, scope: "all", changes, teacher });
      return;
    }
    // The teacher is the section's whatever the answer, so it is said now; the rest waits on it.
    if (teacher !== undefined) void teach(sectionsById.get(series.sectionId), teacher).then(refresh, failed);
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
    const teacher = draft.teacherName !== dialog.draft.teacherName ? draft.teacherName : undefined;
    const weeksChanged = draft.weeks.join() !== series.weeks.join();
    const noteChanged = draft.note !== series.note;
    if (weeksChanged || noteChanged) {
      change.mutate({
        series,
        scope: "all",
        changes: { ...own, ...(weeksChanged ? { weeks: draft.weeks } : {}), ...(noteChanged ? { note: draft.note } : {}) },
        teacher,
      });
    } else if (Object.keys(own).length || teacher !== undefined) {
      changeOne(entry, series, own, teacher);
    } else {
      setDialog(null);
    }
  };
  const askDelete = () => {
    if (!dialog?.entry || !dialog.series) return;
    if (dialog.series.weeks.length > 1) setPending({ verb: "delete", entry: dialog.entry, series: dialog.series });
    else setConfirmDelete({ entry: dialog.entry, series: dialog.series });
  };

  const toPlace = data.sections.filter((section) => sectionShown(section) || lens === "room");
  const trayShown = onlyToPlace
    ? toPlace.filter((section) => (placed.get(section.id) ?? 0) < (section.hours ?? 0) || (!section.hours && !placed.get(section.id)))
    : toPlace;
  const weekOptions = allWeeks.map((each) => ({
    value: String(each),
    label: `Week ${each}`,
    detail: formatDayAndMonth(toIsoDate(weekStartOf(each, calendar))),
  }));

  /*
   * The PDF for the timetabling team: the Semester Timetable's own export, fed the plan's
   * classes instead of the portal's, for whatever the lens shows.
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
  const lensSaid = lens === "all" ? "" : [focused, lens === "programme" && groupFocused ? groupFocused : ""].filter(Boolean).join(" ");
  const exportInput: SemesterExportInput = {
    semester: [data.name || data.termCode, lensSaid].filter(Boolean).join(" · "),
    layout: lens === "room" ? "rooms-week" : "days",
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
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-3">
        {semesterPicker}
        <div className="w-36">
          <SelectMenu label="View by" value={lens} onChange={(value) => setLens(value as Lens)} options={LENSES} />
        </div>
        {lens !== "all" ? (
          <div className="w-48">
            <SelectMenu
              label={LENSES.find((entry) => entry.value === lens)?.label ?? ""}
              value={focused}
              onChange={setFocus}
              options={lensChoices.map((value) => ({ value, label: value }))}
              searchable={lensChoices.length > 12}
              placeholder="Nothing to show yet"
            />
          </div>
        ) : null}
        {lens === "programme" && groups.length ? (
          <div className="w-36">
            <SelectMenu
              label="Group"
              value={groupFocused}
              onChange={setGroup}
              options={[{ value: "", label: "Every group" }, ...groups.map((value) => ({ value, label: value }))]}
            />
          </div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous week" disabled={shownWeek <= 1} onClick={() => setWeek(shownWeek - 1)} className={STEP}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <div className="w-40">
            <SelectMenu label="Week" value={String(shownWeek)} onChange={(value) => setWeek(Number(value))} options={weekOptions} />
          </div>
          <button type="button" aria-label="Next week" disabled={shownWeek >= data.weeks} onClick={() => setWeek(shownWeek + 1)} className={STEP}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        <Zoom label="Width" value={widthZoom} {...WIDTH} onChange={setWidthZoom} />
        <Zoom label="Height" value={heightZoom} {...HEIGHT} onChange={setHeightZoom} />
        <button type="button" onClick={() => setExportOpen(true)} className={CONTROL}>
          <FileDown size={14} aria-hidden="true" /> Export PDF
        </button>
        {settingsButton}
        {newPlanButton}
      </div>

      {error && !dialog && !settingsOpen && !newOpen ? (
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
            editing={{
              onDraw: (slot) => {
                setError("");
                setDialog({ draft: draftFor(lens === "course" ? (toPlace[0]?.id ?? "") : "", slot) });
              },
              onOpen: (session) => {
                const entry = entryOf(session);
                if (entry) openClass(entry);
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
              onDrop: (sectionId, slot) => {
                setError("");
                setDialog({ draft: draftFor(sectionId, slot) });
              },
            }}
          />
          <p className="mt-1.5 shrink-0 text-xs text-[#667085]">
            Drag along a day to place a class, or drop one from the list. Drag a class to move it, its right-hand end to
            change its length; click it to open it.
          </p>
        </div>

        <aside className="hidden min-h-0 w-80 shrink-0 flex-col rounded-lg border border-[#d9dee7] bg-white lg:flex" aria-label="Classes to place">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#eef1f5] px-3 py-2">
            <h3 className="text-sm font-semibold text-[#171717]">Classes to place · {trayShown.length}</h3>
            <button
              type="button"
              aria-pressed={onlyToPlace}
              onClick={() => setOnlyToPlace(!onlyToPlace)}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${onlyToPlace ? "bg-[#1f4e79] text-white" : "bg-[#eef1f5] text-[#667085]"}`}
            >
              Still to place
            </button>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-[#f2f4f7] overflow-y-auto">
            {trayShown.map((section) => {
              const course = courses.get(keyOf(section));
              const doneHours = placed.get(section.id) ?? 0;
              const asked = section.hours ?? 0;
              const share = asked ? Math.min(1, doneHours / asked) : doneHours ? 1 : 0;
              const over = asked > 0 && doneHours > asked + 0.01;
              return (
                <li
                  key={section.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SECTION_DRAG, section.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                  className="cursor-grab px-3 py-2 hover:bg-[#f8fafc] active:cursor-grabbing"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: course?.color ?? "#1f4e79" }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#344054]" title={section.title}>
                        {section.title || section.courseCode}
                      </p>
                      <p className="truncate text-xs text-[#667085]">
                        {[section.courseCode, section.crn ? `CRN ${section.crn}` : "", section.teacherName || "no teacher yet"].filter(Boolean).join(" · ")}
                      </p>
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
                      aria-label={`Place ${section.title || section.courseCode}`}
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
            {!trayShown.length ? <li className="px-3 py-4 text-sm text-[#667085]">Nothing here to place.</li> : null}
          </ul>
        </aside>
      </div>

      {dialog ? (
        <PlanClassDialog
          open
          plan={data}
          rooms={rooms.map((room) => room.code)}
          initial={dialog.draft}
          editing={
            dialog.entry && dialog.series
              ? {
                  week: dialog.entry.week,
                  meetsOn: dialog.entry.meetsOn,
                  seriesWeeks: dialog.series.weeks.length,
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
        shown={`${exportSections.size} of ${data.sections.length} classes${lensSaid ? `, ${lensSaid}` : ""}`}
      />
      {settings}
      {newPlan}
    </section>
  );
}
