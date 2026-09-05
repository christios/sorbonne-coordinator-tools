import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, FolderInput, Globe, IdCard, LayoutGrid, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ColumnMenu } from "@/components/ColumnMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { CopyButton } from "@/components/CopyButton";
import { CopyPresetMenu } from "@/components/CopyPresetMenu";
import { FilterTabs } from "@/components/FilterTabs";
import { HistoryBackup } from "@/components/HistoryBackup";
import { PlaceInBlock } from "@/components/PlaceInBlock";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentHistoryPane } from "@/components/StudentHistoryPane";
import { StudentRecord } from "@/components/StudentRecord";
import { StudentTable, cellText, type Sort } from "@/components/StudentTable";
import { TableFilterBar } from "@/components/TableFilterBar";
import { costOfMove, describeCost } from "@/services/cohortMove";
import { copyToClipboard, tableText } from "@/services/copyCells";
import { presetText, rowsForCopy } from "@/services/copyPresets";
import { forgetHistory, loadHistory, type PullHistory } from "@/services/pullHistory";
import { fetchSchema, type RosterRow } from "@/services/scenRosters";
import { fetchTimetableTerms } from "@/services/timetables";
import type { Warning } from "@/services/discrepancies";
import { changesFromRecord, changesSince, sharedCohort, studentRows, type StudentRow } from "@/services/rosterView";
import { PortalError } from "@/services/scenRosters";
import {
  forgetRosters,
  lastSync,
  loadPull,
  rowsHeld,
  type StoredPreset,
} from "@/services/rosterStore";
import {
  buildColumns,
  loadLayout,
  sortByColumn,
  optionsFor,
  reorderColumn,
  resizeColumn,
  saveLayout,
  visibleColumns,
  type ColumnLayout,
} from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import {
  createCohort,
  fetchStudents,
  setCohort,
  type Cohort,
  type PlacementReport,
} from "@/services/studentDatabase";

/** Where a student goes when the picker is used, with "no cohort" as a real choice. */
const NO_COHORT = "__none__";
/** Making one is a way of moving into one, so it lives in the same picker. */
const NEW_COHORT = "__new__";

/**
 * One view's students, and what the portal last said about them.
 *
 * The list comes from one place — syncing this view, which asks the fixed question the
 * view was created with. Nothing on this page changes who is in the view: the filters
 * here narrow what is *shown*, and the status beside each student is what this view's
 * last sync found, which another view is free to disagree with.
 *
 * Names, e-mail addresses and year levels come from the SCEN Rosters extension and are
 * kept in this browser alone — see services/rosterStore.ts.
 */
/** What a view's history is before it has been read, and after it has been forgotten. */
const NO_HISTORY: PullHistory = { pulls: [], latest: {}, present: [] };

const studentIdOf = (row: StudentRow) => row.studentId;

export function StudentRoster({
  cohorts,
  viewId,
  preselect = [],
  filterCohort = "",
  scope,
  warningsFor,
  onDismissWarning,
  defaultSort,
}: {
  cohorts: Cohort[];
  viewId: string;
  /** Ids another page sent here — the table opens showing everybody, with these ticked. */
  preselect?: string[];
  /** A cohort whose members to show — arrives as an ordinary filter chip, clearable. */
  filterCohort?: string;
  /**
   * The Cohorts page: the table is narrowed to one cohort's students (or to those in
   * none, with `cohortId: null`) as a population rather than a clearable chip, every
   * student we hold is fetched rather than a portal filter's, and each row carries the
   * warnings the page worked out for it.
   */
  scope?: { cohortId: string | null };
  warningsFor?: (studentId: string) => Warning[];
  onDismissWarning?: (key: string, dismissed: boolean) => void;
  defaultSort?: Sort;
}) {
  const client = useQueryClient();
  // The scoped table has its own arrangement; see studentColumns.loadLayout.
  const layoutKey = scope ? "scen-student-columns:cohorts:v1" : undefined;
  const [everywhere, setEverywhere] = useState(false);
  // Searching everywhere asks for the whole record rather than this view's population.
  // A scoped table is always everywhere: a cohort's students come from every view.
  const asked = everywhere || scope ? "" : viewId;
  const students = useQuery({
    queryKey: ["students", asked],
    queryFn: () => fetchStudents(asked),
    /*
     * Not before a view has been settled on.
     *
     * The view arrives a tick after the first render, and an empty one means "every
     * student we hold" — so without this the page opened by fetching the whole roster
     * and then immediately fetching again for the view it had just chosen. The first
     * answer was the larger of the two and nobody ever saw it.
     */
    enabled: everywhere || Boolean(scope) || asked !== "",
    /*
     * A view's students are worth keeping. Switching views refetched thousands of rows
     * behind a full-screen loader every time, including views visited a moment ago; now
     * a recent answer is reused, and while a genuinely new one is in flight the table
     * that is already on screen stays there rather than being replaced by a spinner.
     */
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
  });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  // Only so the Groups column can name a semester when a student is in more than one.
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const termNames = useMemo(
    () => Object.fromEntries((terms.data ?? []).map((term) => [term.id, term.name])),
    [terms.data],
  );

  // The table offers the portal's own fields, so the columns follow the harvested schema.
  const allColumns = useMemo(
    () =>
      buildColumns(schema.data?.columns ?? [], schema.data?.fields ?? [], {
        withWarnings: Boolean(warningsFor),
        withoutCohort: Boolean(scope),
      }),
    [schema.data, warningsFor, scope],
  );

  const [stored, setStored] = useState<StoredPreset>({});
  const [syncedAt, setSyncedAt] = useState("");
  const [history, setHistory] = useState<PullHistory>(NO_HISTORY);
  const [historyOf, setHistoryOf] = useState<StudentRow | null>(null);
  // The one student whose whole record is open, from the toolbar button.
  const [recordOf, setRecordOf] = useState<StudentRow | null>(null);
  const [layout, setLayout] = useState<ColumnLayout | null>(null);
  const [filters, setFilters] = useState<FilterModel[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(defaultSort ?? { key: "studentId", ascending: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);
  /*
   * What the portal last said about each student, from whichever view asked most
   * recently. A view chooses which students, not what is true about them.
   */
  const [portalRows, setPortalRows] = useState<RosterRow[]>([]);

  /*
   * The names and the history live in this browser, so they are read back on mount
   * rather than fetched — and again after a sync, which is what changes them. All three
   * are this view's: another view's pull answered a different question.
   *
   * The browser answers for its own disk asynchronously now that these are held in a
   * drawer big enough for a term, so a read that arrives after the view has moved on is
   * discarded rather than shown against the wrong view.
   */
  useEffect(() => {
    let current = true;
    setSyncedAt(lastSync(viewId));
    void Promise.all([loadPull(viewId), loadHistory(viewId), rowsHeld()]).then(([pull, past, held]) => {
      if (!current) return;
      setStored(pull);
      setHistory(past);
      setPortalRows(held);
    });
    return () => {
      current = false;
    };
  }, [students.dataUpdatedAt, viewId]);

  // The arrangement can only be reconciled once the columns are known.
  useEffect(() => setLayout(loadLayout(allColumns, layoutKey)), [allColumns, layoutKey]);

  /*
   * With a student's history open, the arrow keys read the next and the previous row's —
   * the table is the list and the pane is the detail, so walking one should walk the
   * other. The row is scrolled into view, since it may well be off the screen.
   */
  useEffect(() => {
    if (!historyOf) return;
    const walk = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const shown = visibleRef.current;
      const at = shown.findIndex((row) => row.studentId === historyOf.studentId);
      const next = shown[at + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      event.preventDefault();
      setHistoryOf(next);
      document
        .querySelector(`[data-row-id="${CSS.escape(next.studentId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    document.addEventListener("keydown", walk);
    return () => document.removeEventListener("keydown", walk);
  }, [historyOf]);

  /*
   * A selection belongs to the view it was made in.
   *
   * The table survives a change of view now, and most of what it holds should: the
   * columns, the filters, the sort are the coordinator's working setup. A selection is
   * different — "Move these 30" pointing at students the new view does not contain is a
   * write against people the coordinator can no longer see.
   */
  useEffect(() => {
    setSelected(new Set());
    setFocus([]);
  }, [viewId]);

  const layoutRef = useRef<ColumnLayout | null>(null);
  layoutRef.current = layout;

  /*
   * The table is thousands of rows long, so it is memoised — which only helps while the
   * handlers it is given stay the same between renders. Reading the layout from a ref
   * keeps them stable without making each one depend on it.
   */
  const arrange = useCallback((next: ColumnLayout) => {
    setLayout(next);
    saveLayout(next, layoutKey);
  }, [layoutKey]);

  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<(PlacementReport & { removed: boolean }) | null>(null);

  /*
   * A handful of students sent here from the Groups page, who are in no block.
   *
   * The table is narrowed to exactly them, not merely ticked: nine ticks among 2803 rows
   * are nine rows you cannot see, and a page that looks unchanged has not answered "show
   * them to me". The search also widens to everybody first, because somebody with no group
   * need not be in whichever view happens to be open.
   */
  const [focus, setFocus] = useState<string[]>([]);
  const sent = preselect.join(",");
  useEffect(() => {
    if (!sent) return;
    const ids = sent.split(",");
    setFocus(ids);
    setSelected(new Set(ids));
    setEverywhere(true);
  }, [sent]);

  /*
   * "Who is in this cohort" is the table filtered by cohort, which it could always do.
   * It arrives as an ordinary filter chip rather than a special mode, so it shows in the
   * filter bar and comes off the way every other filter does.
   */
  useEffect(() => {
    if (!filterCohort) return;
    setEverywhere(true);
    setFilters([{ columnId: "cohortName", type: "option", operator: "is", values: [filterCohort] }]);
  }, [filterCohort]);

  /** Create a cohort and put the selection in it, which is the only reason to make one here. */
  const createAndMove = useMutation({
    mutationFn: async () => {
      const created = await createCohort({ name: newName.trim() });
      await setCohort([...selected], created.id);
      return created;
    },
    onSuccess: (created) => {
      setNaming(false);
      setNewName("");
      setMoveTo(created.id);
      setSelected(new Set());
      client.invalidateQueries({ queryKey: ["students"] });
      client.invalidateQueries({ queryKey: ["cohorts"] });
      client.invalidateQueries({ queryKey: ["catalogue"] });
      client.invalidateQueries({ queryKey: ["publication"] });
    },
  });

  // Set only when a move would throw placements away, which is the only time it is asked about.
  const [confirmMove, setConfirmMove] = useState<{ ids: string[]; cohortId: string | null } | null>(
    null,
  );

  const move = useMutation({
    mutationFn: ({ ids, cohortId }: { ids: string[]; cohortId: string | null }) =>
      setCohort(ids, cohortId),
    onSuccess: () => {
      setSelected(new Set());
      setMoveTo("");
      setConfirmMove(null);
      client.invalidateQueries({ queryKey: ["students"] });
      client.invalidateQueries({ queryKey: ["cohorts"] });
      // A move drops every group they held, so both cohorts' counts have changed.
      client.invalidateQueries({ queryKey: ["catalogue"] });
      client.invalidateQueries({ queryKey: ["publication"] });
    },
  });

  /*
   * What changed comes from the history, which records it pull by pull. A `previous`
   * roster is only read when there is no history to read — a view last synced by a
   * version that kept one, which the next sync replaces.
   */
  const changes = useMemo(() => {
    const newest = history.pulls[history.pulls.length - 1] ?? null;
    if (newest) return changesFromRecord(newest);
    return changesSince(stored.previous?.rows ?? [], stored.current?.rows ?? []);
  }, [history, stored]);
  const everyRow = useMemo(
    () => studentRows(students.data ?? [], portalRows, changes, syncedAt, termNames, warningsFor),
    [students.data, portalRows, changes, syncedAt, termNames, warningsFor],
  );
  const rows = useMemo(() => {
    // The population first: a scope is not a filter chip, it is who the page is about.
    const population = scope
      ? everyRow.filter((row) => (scope.cohortId === null ? !row.cohortId : row.cohortId === scope.cohortId))
      : everyRow;
    if (focus.length === 0) return population;
    const wanted = new Set(focus);
    return population.filter((row) => wanted.has(row.studentId));
  }, [everyRow, focus, scope]);

  const columns = useMemo(
    () => (layout ? visibleColumns(layout, allColumns) : []),
    [layout, allColumns],
  );
  const columnIds = useMemo(() => new Set(allColumns.map((column) => column.id)), [allColumns]);
  const visibleRef = useRef<StudentRow[]>([]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Across every column on screen, not a chosen few: if you can see a value, searching
    // for it should find it.
    const searched = needle
      ? rows.filter((row) =>
          columns.some((column) => cellText(row, column).toLowerCase().includes(needle)),
        )
      : rows;
    return sortByColumn(applyFilters(searched, columns, filters), sort, allColumns, studentIdOf);
  }, [rows, columns, filters, sort, query]);

  visibleRef.current = visible;

  /*
   * Ticking one row, or every row between the last one and this one.
   *
   * The anchor is whichever row was ticked last, and it follows the order on screen rather
   * than the order in the data — a range picked after sorting by cohort has to be the rows
   * the coordinator can see between their two clicks, not whatever lies between those two
   * ids in the record.
   */
  const anchor = useRef("");
  const toggle = useCallback((studentId: string, extend = false) => {
    const shown = visibleRef.current.map((row) => row.studentId);
    const from = shown.indexOf(anchor.current);
    const to = shown.indexOf(studentId);

    if (extend && from !== -1 && to !== -1) {
      const [start, end] = from < to ? [from, to] : [to, from];
      const range = shown.slice(start, end + 1);
      setSelected((current) => new Set([...current, ...range]));
      return;
    }

    anchor.current = studentId;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }, []);

  const sortBy = useCallback((key: string) => {
    setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }));
  }, []);
  const resize = useCallback(
    (id: string, width: number) => {
      if (layoutRef.current) arrange(resizeColumn(layoutRef.current, id, width, allColumns));
    },
    [arrange, allColumns],
  );
  const reorder = useCallback(
    (id: string, beforeId: string) => {
      if (layoutRef.current) arrange(reorderColumn(layoutRef.current, id, beforeId));
    },
    [arrange],
  );
  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const shownIds = visibleRef.current.map((row) => row.studentId);
      const everyShown = shownIds.length > 0 && shownIds.every((id) => current.has(id));
      return everyShown ? new Set<string>() : new Set(shownIds);
    });
  }, []);

  if (students.isLoading || !layout) return <ScreenLoading label="Loading the students…" />;

  const chosen = [...selected];
  /*
   * A move only interrupts when it would destroy something.
   *
   * Most moves are a student joining the cohort they should always have been in, and
   * costing them a confirmation each time is how a confirmation stops being read. What
   * is worth stopping for is the delete nobody can see coming: leaving a cohort drops
   * every group held in it, in every semester, not the one on screen.
   */
  const moveCost = (cohortId: string | null) =>
    costOfMove(students.data ?? [], chosen, cohortId, termNames);
  const newCohortCost = describeCost(moveCost(NEW_COHORT));
  const requestMove = (cohortId: string | null) => {
    if (moveCost(cohortId).placements === 0) {
      move.mutate({ ids: chosen, cohortId });
      return;
    }
    setConfirmMove({ ids: chosen, cohortId });
  };

  // A block belongs to one cohort, so placing is only offered for a selection that is in one.
  const placeInto = sharedCohort(rows, selected);
  const cohortOfSelection = cohorts.find((candidate) => candidate.id === placeInto) ?? null;
  const error = move.error ?? students.error;

  return (
    <>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error instanceof PortalError ? error.message : (error as Error).message}
        </p>
      ) : null}

      {/*
        * Always here, dimmed until there is something to move. A control that appears on
        * selection moves everything below it down at the moment you click a row, and it
        * does not answer "what can I do with these?" until after you have chosen.
        */}
      <div
        className={`flex flex-wrap items-center gap-3 rounded-md border px-4 py-2.5 text-sm transition-opacity ${
          chosen.length
            ? "border-[#cfe0ef] bg-[#f2f7fb]"
            : "border-[#e4e8ee] bg-[#fafbfc] opacity-60"
        }`}
      >
          <span className={chosen.length ? "font-semibold text-[#1f4e79]" : "font-semibold text-[#98a2b3]"}>
            {chosen.length ? `${chosen.length} selected` : "None selected"}
          </span>
          <div className="w-56">
            <SelectMenu
              label="Move to cohort"
              value={moveTo}
              placeholder="Move to cohort…"
              searchable={cohorts.length > 12}
              options={[
                ...cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name })),
                { value: NEW_COHORT, label: "New cohort…" },
                { value: NO_COHORT, label: "Take out of their cohort" },
              ]}
              onChange={(value) => {
                if (value === NEW_COHORT) {
                  setNewName("");
                  setNaming(true);
                  return;
                }
                setMoveTo(value);
              }}
              disabled={!chosen.length}
            />
          </div>
          <button
            type="button"
            disabled={!chosen.length || !moveTo || move.isPending}
            onClick={() => requestMove(moveTo === NO_COHORT ? null : moveTo)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            <FolderInput size={15} aria-hidden="true" /> {chosen.length ? `Move ${chosen.length}` : "Move"}
          </button>
          <button
            type="button"
            disabled={!cohortOfSelection}
            title={
              chosen.length && !cohortOfSelection
                ? "Blocks belong to one cohort — select students who share one"
                : undefined
            }
            onClick={() => {
              setPlaced(null);
              setPlacing(true);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054] disabled:opacity-50"
          >
            <LayoutGrid size={15} aria-hidden="true" /> Place in a block…
          </button>
          {chosen.length ? (
            <button type="button" onClick={() => setSelected(new Set())} className="text-[#667085] underline">
              Clear
            </button>
          ) : null}
      </div>

      {placed ? (
        <p className="mt-2 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {placed.assigned} student(s) {placed.removed ? "taken out of the block" : "placed"}.
          {placed.skipped.length > 0 ? (
            <span className="ml-1 text-[#8a6116]">
              {placed.skipped.length} id(s) were not in that block&rsquo;s cohort and were left alone:{" "}
              {placed.skipped.slice(0, 5).join(", ")}
              {placed.skipped.length > 5 ? "…" : ""}
            </span>
          ) : null}
        </p>
      ) : null}

      {recordOf ? (
        <StudentRecord open row={recordOf} cohorts={cohorts} history={history} onClose={() => setRecordOf(null)} />
      ) : null}

      {cohortOfSelection ? (
        <PlaceInBlock
          open={placing}
          cohort={cohortOfSelection}
          studentIds={chosen}
          onClose={() => setPlacing(false)}
          onPlaced={(report) => {
            setPlaced(report);
            setPlacing(false);
            setSelected(new Set());
            client.invalidateQueries({ queryKey: ["students"] });
            client.invalidateQueries({ queryKey: ["catalogue"] });
            // Placing somebody is the commonest way the "nobody has placed them" count
            // changes, and that count is the publication's, not the catalogue's.
            client.invalidateQueries({ queryKey: ["publication"] });
          }}
        />
      ) : null}

      {/*
        * Saved ways of looking, on the Students page only: the Cohorts page is already
        * one way of looking, and its filters are its own.
        */}
      {!scope ? (
        <div className="mt-3">
          <FilterTabs
            filters={filters}
            sort={sort}
            columnIds={columnIds}
            onApply={(nextFilters, nextSort) => {
              setFilters(nextFilters);
              setSort(nextSort);
            }}
          />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TableFilterBar
          columns={columns}
          filters={filters}
          optionsFor={(column) => optionsFor(rows, column)}
          onChange={setFilters}
        />

        {/* The margin lives here rather than on the search box, so the two travel
            together as a pair on the right instead of the button sitting by the filters. */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            disabled={chosen.length !== 1}
            title={chosen.length === 1 ? "Everything known about this student" : "Select one student"}
            onClick={() => {
              const target = rows.find((candidate) => candidate.studentId === chosen[0]);
              if (target) setRecordOf(target);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <IdCard size={16} aria-hidden="true" /> Student record
          </button>
          <CopyPresetMenu
            columns={allColumns}
            onCopy={async (chosen, withHeader) => {
              if (chosen.length === 0) return false;
              return copyToClipboard(
                presetText(chosen, rowsForCopy(visible, selected), cellText, withHeader),
              );
            }}
          />
        </div>

        <label className="relative block w-full sm:w-60">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label="Search students"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every column"
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>

        {scope ? null : (
        <button
          type="button"
          aria-pressed={everywhere}
          onClick={() => setEverywhere((current) => !current)}
          title={
            everywhere
              ? "Searching every student we hold. Click to go back to this portal filter."
              : "Search every student we hold, not only this portal filter"
          }
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
            everywhere
              ? "border-[#1f4e79] bg-[#1f4e79] text-white"
              : "border-[#b7bec8] bg-white text-[#344054] hover:bg-[#f8fafc]"
          }`}
        >
          <Globe size={15} aria-hidden="true" />
          {everywhere ? "All students" : "This filter"}
        </button>
        )}

        <ColumnMenu layout={layout} columns={allColumns} onChange={arrange} />

        <CopyButton
          label="Copy the whole table"
          text={() =>
            tableText(
              columns.map((column) => column.displayName),
              visible.map((row) => columns.map((column) => cellText(row, column))),
            )
          }
          className="border border-[#b7bec8] bg-white p-2 hover:bg-[#f8fafc]"
        />
      </div>

      <Modal
        open={naming}
        title={`New cohort for ${chosen.length} student${chosen.length === 1 ? "" : "s"}`}
        description="A cohort is a population for a year, not a semester — its blocks are defined per semester."
        onClose={() => setNaming(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setNaming(false)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!newName.trim() || !chosen.length || createAndMove.isPending}
              onClick={() => createAndMove.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              Create and move {chosen.length}
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-[#344054]">
          Name
          <input
            value={newName}
            autoFocus
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Foundation Year"
            className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
        {/* A cohort that does not exist yet holds nobody, so everyone placed loses their groups. */}
        {newCohortCost ? (
          <p className="mt-3 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
            {newCohortCost}
          </p>
        ) : null}
        {createAndMove.error ? (
          <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {(createAndMove.error as Error).message}
          </p>
        ) : null}
      </Modal>

      {focus.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-4 py-2.5 text-sm text-[#1f4e79]">
          <Filter size={15} aria-hidden="true" />
          <span>
            Showing the <b className="tabular-nums">{focus.length}</b> student
            {focus.length === 1 ? "" : "s"} sent from Groups &amp; CRNs
            {rows.length !== focus.length ? ` — ${rows.length} of them are in this record` : ""}.
          </span>
          <button
            type="button"
            onClick={() => setFocus([])}
            className="font-semibold underline"
          >
            Show everyone again
          </button>
        </p>
      ) : null}

      <p className="mt-2 text-xs text-[#98a2b3]">
        {rows.length} student{rows.length === 1 ? "" : "s"} held
        {visible.length !== rows.length ? `, ${visible.length} shown` : ""}
        {portalRows.length ? (
          <>
            {". Names came from the portal in this browser. "}
            <button type="button" onClick={() => setConfirmForget(true)} className="underline">
              Forget stored rosters
            </button>
          </>
        ) : (
          ". No names held in this browser yet — sync to fill them in."
        )}
        {". "}
        <HistoryBackup
          onRestored={() => {
            // A restore changes the history behind the changed column, so read it again.
            void loadHistory(viewId).then(setHistory);
          }}
        />
        {"."}
      </p>

      <StudentTable
        rows={visible}
        columns={columns}
        layout={layout}
        sort={sort}
        selected={selected}
        onSort={sortBy}
        onResize={resize}
        onReorder={reorder}
        onOpenHistory={setHistoryOf}
        onDismissWarning={onDismissWarning}
        highlightedId={historyOf?.studentId}
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={
          rows.length
            ? "Nobody matches those filters."
            : scope
              ? scope.cohortId === null
                ? "Every student we hold is in a cohort."
                : "Nobody is in this cohort yet."
              : "No students yet. Sync with the portal to build the list."
        }
      />

      <ConfirmDialog
        open={confirmMove !== null}
        title={
          confirmMove?.cohortId
            ? `Move ${confirmMove.ids.length} student${confirmMove.ids.length === 1 ? "" : "s"} to ${
                cohorts.find((candidate) => candidate.id === confirmMove.cohortId)?.name ?? "another cohort"
              }?`
            : `Take ${confirmMove?.ids.length ?? 0} student${
                (confirmMove?.ids.length ?? 0) === 1 ? "" : "s"
              } out of their cohort?`
        }
        description={confirmMove ? describeCost(moveCost(confirmMove.cohortId)) : ""}
        confirmLabel="Move anyway"
        onConfirm={() => {
          if (confirmMove) move.mutate(confirmMove);
        }}
        onClose={() => setConfirmMove(null)}
      />

      <ConfirmDialog
        open={confirmForget}
        title="Forget the rosters stored in this browser?"
        description={
          "The names, e-mail addresses and year levels pulled from the portal are held in this " +
          "browser and will be cleared, along with the history of what the portal has said. No " +
          "student leaves the list and no cohort changes — the ids we keep are on the server and " +
          "are not touched. Sync again and the names come back."
        }
        confirmLabel="Forget rosters"
        onConfirm={() => {
          void Promise.all([forgetRosters(), forgetHistory()]).then(() => {
            setStored({});
            setHistory(NO_HISTORY);
            // The names on screen come from every view now, not this one's pull, so
            // forgetting has to take them away here too or they sit there until reload.
            setPortalRows([]);
            setSyncedAt("");
          });
          setConfirmForget(false);
        }}
        onClose={() => setConfirmForget(false)}
      />

      <StudentHistoryPane
        row={historyOf}
        history={history}
        columns={allColumns}
        onClose={() => setHistoryOf(null)}
      />
    </>
  );
}


