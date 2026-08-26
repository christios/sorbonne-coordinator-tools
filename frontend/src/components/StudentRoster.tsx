import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderInput, Globe, LayoutGrid, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ColumnMenu } from "@/components/ColumnMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CopyButton } from "@/components/CopyButton";
import { PlaceInBlock } from "@/components/PlaceInBlock";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentHistoryPane } from "@/components/StudentHistoryPane";
import { StudentTable, cellText, type Sort } from "@/components/StudentTable";
import { TableFilterBar } from "@/components/TableFilterBar";
import { tableText } from "@/services/copyCells";
import { forgetHistory, loadHistory, type PullHistory } from "@/services/pullHistory";
import { fetchSchema } from "@/services/scenRosters";
import { changesSince, sharedCohort, studentRows, type StudentRow } from "@/services/rosterView";
import { PortalError } from "@/services/scenRosters";
import {
  forgetRosters,
  lastSync,
  loadPull,
  type StoredPreset,
} from "@/services/rosterStore";
import {
  buildColumns,
  loadLayout,
  optionsFor,
  reorderColumn,
  resizeColumn,
  saveLayout,
  visibleColumns,
  type ColumnLayout,
  type StudentColumn,
} from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import {
  fetchStudents,
  setCohort,
  type Cohort,
  type PlacementReport,
} from "@/services/studentDatabase";

/** Where a student goes when the picker is used, with "no cohort" as a real choice. */
const NO_COHORT = "__none__";

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
export function StudentRoster({
  cohorts,
  viewId,
  preselect = [],
}: {
  cohorts: Cohort[];
  viewId: string;
  /** Ids another page sent here — the table opens showing everybody, with these ticked. */
  preselect?: string[];
}) {
  const client = useQueryClient();
  const [everywhere, setEverywhere] = useState(false);
  // Searching everywhere asks for the whole record rather than this view's population.
  const asked = everywhere ? "" : viewId;
  const students = useQuery({
    queryKey: ["students", asked],
    queryFn: () => fetchStudents(asked),
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

  // The table offers the portal's own fields, so the columns follow the harvested schema.
  const allColumns = useMemo(
    () => buildColumns(schema.data?.columns ?? [], schema.data?.fields ?? []),
    [schema.data],
  );

  const [stored, setStored] = useState<StoredPreset>({});
  const [syncedAt, setSyncedAt] = useState("");
  const [history, setHistory] = useState<PullHistory>(() => loadHistory(viewId));
  const [historyOf, setHistoryOf] = useState<StudentRow | null>(null);
  const [layout, setLayout] = useState<ColumnLayout | null>(null);
  const [filters, setFilters] = useState<FilterModel[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "studentId", ascending: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);

  // The names and the history live in this browser, so they are read back on mount
  // rather than fetched — and again after a sync, which is what changes them. All three
  // are this view's: another view's pull answered a different question.
  useEffect(() => {
    setStored(loadPull(viewId));
    setSyncedAt(lastSync(viewId));
    setHistory(loadHistory(viewId));
  }, [students.dataUpdatedAt, viewId]);

  // The arrangement can only be reconciled once the columns are known.
  useEffect(() => setLayout(loadLayout(allColumns)), [allColumns]);

  const layoutRef = useRef<ColumnLayout | null>(null);
  layoutRef.current = layout;

  /*
   * The table is thousands of rows long, so it is memoised — which only helps while the
   * handlers it is given stay the same between renders. Reading the layout from a ref
   * keeps them stable without making each one depend on it.
   */
  const arrange = useCallback((next: ColumnLayout) => {
    setLayout(next);
    saveLayout(next);
  }, []);

  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<(PlacementReport & { removed: boolean }) | null>(null);

  /*
   * A preselection arrives from the Groups page naming students who are in no block. They
   * need not be in the view that happens to be open, so the search widens to everybody —
   * otherwise the ticks would land on rows that are not on screen and nothing would happen.
   */
  const sent = preselect.join(",");
  useEffect(() => {
    if (!sent) return;
    setSelected(new Set(sent.split(",")));
    setEverywhere(true);
  }, [sent]);

  const move = useMutation({
    mutationFn: ({ ids, cohortId }: { ids: string[]; cohortId: string | null }) =>
      setCohort(ids, cohortId),
    onSuccess: () => {
      setSelected(new Set());
      setMoveTo("");
      client.invalidateQueries({ queryKey: ["students"] });
      client.invalidateQueries({ queryKey: ["cohorts"] });
    },
  });

  const changes = useMemo(
    () => changesSince(stored.previous?.rows ?? [], stored.current?.rows ?? []),
    [stored],
  );
  const rows = useMemo(
    () => studentRows(students.data ?? [], stored.current?.rows ?? [], changes, syncedAt),
    [students.data, stored, changes, syncedAt],
  );

  const columns = useMemo(
    () => (layout ? visibleColumns(layout, allColumns) : []),
    [layout, allColumns],
  );
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
    return sortRows(applyFilters(searched, columns, filters), sort, allColumns);
  }, [rows, columns, filters, sort, query]);

  visibleRef.current = visible;

  const toggle = useCallback((studentId: string) => {
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
                { value: NO_COHORT, label: "Take out of their cohort" },
              ]}
              onChange={setMoveTo}
              disabled={!chosen.length}
            />
          </div>
          <button
            type="button"
            disabled={!chosen.length || !moveTo || move.isPending}
            onClick={() => move.mutate({ ids: chosen, cohortId: moveTo === NO_COHORT ? null : moveTo })}
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
          }}
        />
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TableFilterBar
          columns={columns}
          filters={filters}
          optionsFor={(column) => optionsFor(rows, column)}
          onChange={setFilters}
        />

        <label className="relative ml-auto block w-full sm:w-60">
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

        <button
          type="button"
          aria-pressed={everywhere}
          onClick={() => setEverywhere((current) => !current)}
          title={
            everywhere
              ? "Searching every student we hold. Click to go back to this view."
              : "Search every student we hold, not only this view"
          }
          className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
            everywhere
              ? "border-[#1f4e79] bg-[#1f4e79] text-white"
              : "border-[#b7bec8] bg-white text-[#344054] hover:bg-[#f8fafc]"
          }`}
        >
          <Globe size={15} aria-hidden="true" />
          {everywhere ? "All students" : "This view"}
        </button>

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

      <p className="mt-2 text-xs text-[#98a2b3]">
        {rows.length} student{rows.length === 1 ? "" : "s"} held
        {visible.length !== rows.length ? `, ${visible.length} shown` : ""}
        {stored.current ? (
          <>
            {". Names came from the portal in this browser. "}
            <button type="button" onClick={() => setConfirmForget(true)} className="underline">
              Forget stored rosters
            </button>
          </>
        ) : (
          ". No names held in this browser yet — sync to fill them in."
        )}
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
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={
          rows.length
            ? "Nobody matches those filters."
            : "No students yet. Sync with the portal to build the list."
        }
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
          forgetRosters();
          forgetHistory();
          setStored({});
          setHistory(loadHistory(viewId));
          setSyncedAt("");
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

/**
 * How every sorted list of text in this table compares.
 *
 * `numeric` so "10" follows "9" rather than "1". `sensitivity: "accent"` so case is
 * ignored — the registrar returns names and codes in whatever case it happens to hold,
 * and "MARTIN", "Martin" and "martin" are one name to a coordinator reading the list.
 * Accents still count: at Sorbonne, é is not e, and collapsing them would put French
 * names somewhere nobody expects. Values that differ only by case tie-break on the
 * student id, so the order never wobbles between renders.
 */
const COLLATION: Intl.CollatorOptions = { numeric: true, sensitivity: "accent" };

/**
 * Sort by what the column reads, whatever the column is.
 *
 * A column is not a property of the row: the portal's are reached through `portal`, under
 * ids like `portal:FULL_NAME`. Indexing the row by the column id worked for the handful
 * that happen to be properties and silently did nothing for the rest, which sorted every
 * portal column into id order.
 *
 * The accessor rather than the displayed text, because a date displays as "23 Aug 2026"
 * and that sorts alphabetically by month.
 */
function sortRows(rows: StudentRow[], sort: Sort, columns: StudentColumn[]): StudentRow[] {
  const direction = sort.ascending ? 1 : -1;
  const column = columns.find((candidate) => candidate.id === sort.key);
  const valueOf = (row: StudentRow) => String(column?.accessor(row) ?? "");
  return [...rows].sort((left, right) => {
    // Blanks last however the sort runs: a student with no major is not the first thing
    // you want to see when sorting by major.
    const a = valueOf(left);
    const b = valueOf(right);
    if (!a !== !b) return a ? -1 : 1;
    const compared = a.localeCompare(b, undefined, COLLATION);
    return (compared || left.studentId.localeCompare(right.studentId)) * direction;
  });
}
