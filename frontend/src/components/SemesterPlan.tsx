import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NewPlanDialog, PlanClassDialog, PlanSettingsDialog, ScopeDialog, type ClassDraft } from "@/components/PlanDialogs";
import { PlanWeek, SECTION_DRAG, type PlanDay } from "@/components/PlanWeek";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { usePageState } from "@/components/usePageState";
import { useRooms } from "@/services/rooms";
import {
  WEEKDAY_NAMES,
  changeClass,
  clashesOf,
  createPlan,
  fetchPlan,
  fetchPlans,
  placeClass,
  plannedHours,
  removeClass,
  sectionLabel,
  settlePlan,
  weeksSaid,
  type PlanClass,
  type PlanSection,
  type PlanSeries,
  type Scope,
  type SeriesChanges,
  type Slot,
} from "@/services/semesterPlans";
import { assignColors, formatDayAndMonth, minutesOf, toIsoDate, weekStartOf } from "@/services/weekSchedule";

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

/**
 * A semester planned on a calendar before the registrar books it.
 *
 * One week at a time, seen through one lens: a programme (and one of its groups), a
 * teacher, a room or a course. Beside it, the classes still to place, each with the hours
 * placed against the hours asked for — drag one onto the week to place it. Everything is
 * saved as it is done; there is no draft and no Save button, because several coordinators
 * plan the same semester and each needs to see the others' classes.
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
  const { rooms } = useRooms();

  const [lens, setLens] = usePageState<Lens>("plan:lens", "programme");
  const [focus, setFocus] = usePageState<string>("plan:focus", "");
  const [group, setGroup] = usePageState<string>("plan:group", "");
  const [week, setWeek] = usePageState<number>("plan:week", 1);
  const [onlyToPlace, setOnlyToPlace] = usePageState<boolean>("plan:only-to-place", false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [dialog, setDialog] = useState<{ draft: ClassDraft; entry?: PlanClass; series?: PlanSeries } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ entry: PlanClass; series: PlanSeries } | null>(null);
  const [error, setError] = useState("");

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["plan", chosen] });
    void client.invalidateQueries({ queryKey: ["plans"] });
  };
  const failed = (exc: Error) => {
    setError(exc.message);
    // A refusal for an old revision means the calendar is behind: show what is there now.
    void client.invalidateQueries({ queryKey: ["plan", chosen] });
  };

  const settle = useMutation({
    mutationFn: (settings: Parameters<typeof settlePlan>[1]) => settlePlan(chosen, settings),
    onSuccess: (fresh) => {
      client.setQueryData(["plan", chosen], fresh);
      setSettingsOpen(false);
      setError("");
      refresh();
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const create = useMutation({
    mutationFn: ({ code, name }: { code: string; name: string }) => createPlan(code, name),
    onSuccess: (fresh) => {
      setNewOpen(false);
      setError("");
      void client.invalidateQueries({ queryKey: ["plans"] });
      onPickTerm(fresh.termCode);
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const place = useMutation({
    mutationFn: (draft: ClassDraft) => placeClass(chosen, draft),
    onSuccess: () => {
      setDialog(null);
      setError("");
      refresh();
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const change = useMutation({
    mutationFn: ({ series, scope, week: at, changes }: { series: PlanSeries; scope: Scope; week?: number; changes: SeriesChanges }) =>
      changeClass(chosen, series.id, { scope, week: at, revision: series.revision, changes }),
    onSuccess: () => {
      setDialog(null);
      setPending(null);
      setError("");
      refresh();
    },
    onError: (exc: Error) => {
      setPending(null);
      failed(exc);
    },
  });
  const remove = useMutation({
    mutationFn: ({ series, scope, week: at }: { series: PlanSeries; scope: Scope; week?: number }) =>
      removeClass(chosen, series.id, { scope, week: at, revision: series.revision }),
    onSuccess: () => {
      setDialog(null);
      setPending(null);
      setConfirmDelete(null);
      setError("");
      refresh();
    },
    onError: (exc: Error) => {
      setPending(null);
      setConfirmDelete(null);
      failed(exc);
    },
  });

  const data = plan.data;
  const sections = useMemo(() => new Map((data?.sections ?? []).map((section) => [section.id, section])), [data?.sections]);
  const seriesById = useMemo(() => new Map((data?.series ?? []).map((series) => [series.id, series])), [data?.series]);
  const colors = useMemo(() => assignColors(distinct((data?.sections ?? []).map((section) => section.courseCode))), [data?.sections]);
  const clashes = useMemo(() => (data ? clashesOf(data) : new Map()), [data]);
  const placed = useMemo(() => (data ? plannedHours(data) : new Map<string, number>()), [data]);

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
    return sectionShown(sections.get(entry.sectionId));
  };

  if (plans.isLoading || (chosen && plan.isLoading)) return <ScreenLoading label="Reading the plan…" />;

  const planOptions = (plans.data ?? []).map((entry) => ({
    value: entry.termCode,
    label: entry.name || entry.termCode,
    badge: entry.termCode,
    badgeTone: "muted" as const,
  }));
  const header = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-72">
        <SelectMenu label="Semester" value={chosen} onChange={onPickTerm} options={planOptions} placeholder="No plan yet" />
      </div>
      {data ? (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Settings2 size={15} /> Semester settings
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setNewOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold text-[#1f4e79] hover:underline"
      >
        <CalendarPlus size={15} /> New plan
      </button>
    </div>
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
      <div className="grid gap-4">
        {header}
        <p className="text-sm text-[#667085]">
          {plan.isError ? (plan.error as Error).message : "There is no semester plan yet. Start one with New plan."}
        </p>
        {newPlan}
      </div>
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

  if (!data.weekOne || !data.weeks) {
    return (
      <div className="grid gap-4">
        {header}
        <div className="rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-4 py-3 text-sm text-[#7a5d00]">
          Say when {data.name || data.termCode} starts and how many teaching weeks it has, in{" "}
          <button type="button" onClick={() => setSettingsOpen(true)} className="font-semibold underline">
            Semester settings
          </button>
          . Classes are placed by teaching week, so the calendar needs them first.
        </div>
        {settings}
        {newPlan}
      </div>
    );
  }

  const calendar = { weekOne: data.weekOne, without: data.without };
  const shownWeek = Math.min(Math.max(1, week), data.weeks);
  const monday = weekStartOf(shownWeek, calendar);
  const holidays = new Map(data.holidays.map((holiday) => [holiday.date, holiday.label || "Holiday"]));
  const weekClasses = data.classes.filter((entry) => entry.week === shownWeek && classShown(entry));
  const usesSaturday = data.classes.some((entry) => entry.week === shownWeek && entry.weekday === 6);
  const days: PlanDay[] = Array.from({ length: usesSaturday ? 6 : 5 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const iso = toIsoDate(date);
    return { weekday: index + 1, date: iso, holiday: holidays.get(iso) };
  });
  const starts = data.classes.map((entry) => minutesOf(entry.startsAt));
  const ends = data.classes.map((entry) => minutesOf(entry.endsAt));
  const fromHour = Math.min(8, ...starts.map((minutes) => Math.floor(minutes / 60)));
  const toHour = Math.max(19, ...ends.map((minutes) => Math.ceil(minutes / 60)));
  const lost = data.skipped.filter((entry) => entry.week === shownWeek && classShown(entry));

  const allWeeks = Array.from({ length: data.weeks }, (_, index) => index + 1);
  const draftFor = (sectionId: string, slot: Pick<Slot, "weekday" | "startsAt" | "endsAt">): ClassDraft => ({
    sectionId,
    ...slot,
    room: lens === "room" ? focused : "",
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
        // The series' own word, not the class's teacher filled in from the class to place.
        teacherName: (series.moves.find((move) => move.week === entry.week) ?? series).teacherName,
        weeks: series.weeks,
        note: series.note,
      },
    });
  };
  /** A change to one dated class: asked about when its series has more than one week. */
  const changeOne = (entry: PlanClass, series: PlanSeries, changes: SeriesChanges) => {
    if (series.weeks.length === 1) {
      change.mutate({ series, scope: "all", changes });
    } else {
      setPending({ verb: "change", entry, series, changes });
    }
  };
  const save = (draft: ClassDraft) => {
    if (!dialog?.entry || !dialog.series) {
      place.mutate(draft);
      return;
    }
    const { entry, series } = dialog;
    const own: SeriesChanges = {};
    for (const key of ["weekday", "startsAt", "endsAt", "room", "teacherName"] as const) {
      const before = key === "teacherName" ? dialog.draft.teacherName : entry[key];
      if (draft[key] !== before) Object.assign(own, { [key]: draft[key] });
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

  const toPlace = (data.sections ?? []).filter((section) => sectionShown(section) || lens === "room");
  const trayShown = onlyToPlace
    ? toPlace.filter((section) => (placed.get(section.id) ?? 0) < (section.hours ?? 0) || (!section.hours && !placed.get(section.id)))
    : toPlace;
  const weekOptions = allWeeks.map((each) => ({
    value: String(each),
    label: `Week ${each}`,
    detail: formatDayAndMonth(toIsoDate(weekStartOf(each, calendar))),
  }));

  return (
    <div className="grid gap-3">
      {header}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <SelectMenu label="View by" value={lens} onChange={(value) => setLens(value as Lens)} options={LENSES} />
        </div>
        {lens !== "all" ? (
          <div className="w-56">
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
          <div className="w-40">
            <SelectMenu
              label="Group"
              value={groupFocused}
              onChange={setGroup}
              options={[{ value: "", label: "Every group" }, ...groups.map((value) => ({ value, label: value }))]}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-end gap-1.5">
          <button
            type="button"
            aria-label="Previous week"
            disabled={shownWeek <= 1}
            onClick={() => setWeek(shownWeek - 1)}
            className="rounded-md border border-[#d0d5dd] p-2 text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="w-44">
            <SelectMenu label="Week" value={String(shownWeek)} onChange={(value) => setWeek(Number(value))} options={weekOptions} />
          </div>
          <button
            type="button"
            aria-label="Next week"
            disabled={shownWeek >= data.weeks}
            onClick={() => setWeek(shownWeek + 1)}
            className="rounded-md border border-[#d0d5dd] p-2 text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {error && !dialog && !settingsOpen && !newOpen ? (
        <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-2 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}
      {lost.length ? (
        <p className="rounded-md border border-[#f0c36d] bg-[#fdf6e3] px-4 py-2 text-sm text-[#7a5d00]">
          Not held this week because of a holiday:{" "}
          {lost.map((entry) => `${sectionLabel(sections.get(entry.sectionId))} (${WEEKDAY_NAMES[entry.weekday - 1]} ${entry.startsAt}, ${entry.holiday})`).join("; ")}
        </p>
      ) : null}

      <div className="flex min-w-0 gap-3">
        <div className="min-w-0 flex-1">
          <PlanWeek
            days={days}
            classes={weekClasses}
            labelOf={(entry) => sectionLabel(sections.get(entry.sectionId))}
            detailOf={(entry) => [`${entry.startsAt}–${entry.endsAt}`, entry.room, entry.teacherName].filter(Boolean)}
            colorOf={(entry) => colors.get(sections.get(entry.sectionId)?.courseCode ?? "") ?? "#1f4e79"}
            clashes={clashes}
            fromHour={fromHour}
            toHour={toHour}
            onDraw={(slot) => {
              setError("");
              setDialog({ draft: draftFor(lens === "course" ? (toPlace[0]?.id ?? "") : "", slot) });
            }}
            onOpen={openClass}
            onMove={(entry, slot) => {
              const series = seriesById.get(entry.seriesId);
              if (!series) return;
              const changes: SeriesChanges = {};
              if (slot.weekday !== entry.weekday) changes.weekday = slot.weekday;
              if (slot.startsAt !== entry.startsAt) changes.startsAt = slot.startsAt;
              if (slot.endsAt !== entry.endsAt) changes.endsAt = slot.endsAt;
              if (Object.keys(changes).length) changeOne(entry, series, changes);
            }}
            onDropSection={(sectionId, slot) => {
              setError("");
              setDialog({ draft: draftFor(sectionId, slot) });
            }}
          />
          <p className="mt-1.5 text-xs text-[#667085]">
            Drag down an empty column to place a class, or drop one from the list. Drag a class to move it, its
            bottom edge to change its length; click it to open it.
          </p>
        </div>

        <aside className="hidden w-80 shrink-0 flex-col rounded-lg border border-[#d9dee7] bg-white lg:flex" aria-label="Classes to place">
          <div className="flex items-center justify-between gap-2 border-b border-[#eef1f5] px-3 py-2">
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
          <ul className="max-h-[70vh] divide-y divide-[#f2f4f7] overflow-y-auto">
            {trayShown.map((section) => {
              const done = placed.get(section.id) ?? 0;
              const asked = section.hours ?? 0;
              const share = asked ? Math.min(1, done / asked) : done ? 1 : 0;
              const over = asked > 0 && done > asked + 0.01;
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
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors.get(section.courseCode) ?? "#1f4e79" }} />
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
                          {Math.round(done * 10) / 10}
                          {asked ? ` of ${asked}` : ""} h
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Place ${section.title || section.courseCode}`}
                      onClick={() => {
                        setError("");
                        setDialog({ draft: draftFor(section.id, { weekday: 1, startsAt: "08:30", endsAt: "10:00" }) });
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
            ? `${sectionLabel(sections.get(confirmDelete.entry.sectionId))}, ${weeksSaid(confirmDelete.series.weeks)}. It comes off the plan for everybody.`
            : ""
        }
        confirmLabel="Delete"
        busy={remove.isPending}
        onConfirm={() => confirmDelete && remove.mutate({ series: confirmDelete.series, scope: "all" })}
        onClose={() => setConfirmDelete(null)}
      />
      {settings}
      {newPlan}
    </div>
  );
}

