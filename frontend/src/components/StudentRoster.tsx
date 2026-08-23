import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FolderInput, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { Filter } from "@/services/filterSummary";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SearchBar } from "@/components/SearchBar";
import { SelectMenu } from "@/components/SelectMenu";
import { PortalError, pullFilter, studentIdOf } from "@/services/scenRosters";
import {
  changesSince,
  choices,
  countBy,
  filterRows,
  sortRows,
  studentRows,
  NO_FILTERS,
  type SortKey,
  type StatusFilter,
  type StudentRow,
} from "@/services/rosterView";
import {
  forgetRosters,
  lastPulled,
  lastSync,
  loadPull,
  rememberPull,
  rememberSync,
  type StoredPreset,
} from "@/services/rosterStore";
import { fetchStudents, setCohort, syncStudents, type Cohort } from "@/services/studentDatabase";

/** A saved search's name is its store key; two searches keep two rosters. */
function keyFor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60) || "last-pull";
}

const STATUSES: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "in_portal", label: "In portal" },
  { id: "not_in_portal", label: "Not in portal" },
  { id: "new", label: "New" },
  { id: "changed", label: "Changed" },
];

/** Where a student goes when the picker is used, with "no cohort" as a real choice. */
const NO_COHORT = "__none__";

/**
 * Every student we hold, and what the portal last said about them.
 *
 * The list is persistent and lives on our side as ids: syncing sets each student's status
 * to found or no-longer-found, and a cohort is a column on the student rather than a
 * separate membership to reconcile. Names, e-mail addresses and year levels come from the
 * SCEN Rosters extension and are kept in this browser alone — see services/rosterStore.ts.
 */
export function StudentRoster({ cohorts }: { cohorts: Cohort[] }) {
  const client = useQueryClient();
  const students = useQuery({ queryKey: ["students"], queryFn: fetchStudents });

  const [stored, setStored] = useState<StoredPreset>({});
  // One store per saved search, so switching search does not lose either roster.
  const [storeKey, setStoreKey] = useState("");
  const [syncedAt, setSyncedAt] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "studentId",
    ascending: true,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);

  // Reading the store on mount is what makes the names survive changing page, and keeping
  // the pull before it is what makes "changed" answerable tomorrow.
  useEffect(() => setStored(loadPull(storeKey || lastPulled())), [storeKey]);
  useEffect(() => setSyncedAt(lastSync()), []);

  const sync = useMutation({
    mutationFn: async ({
      filter,
      meta,
    }: {
      filter: Filter;
      meta: { name: string; expect: number | null; full: boolean };
    }) => {
      const roster = await pullFilter(filter, meta);
      const ids = roster.rows.map(studentIdOf).filter(Boolean);
      const report = await syncStudents(ids, meta.full);
      return { roster, report };
    },
    onSuccess: ({ roster, report }) => {
      const key = keyFor(roster.name);
      setStoreKey(key);
      setStored(rememberPull({ ...roster, presetId: key }));
      rememberSync(report.syncedAt);
      setSyncedAt(report.syncedAt);
      client.invalidateQueries({ queryKey: ["students"] });
      client.invalidateQueries({ queryKey: ["cohorts"] });
    },
  });

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
  const counts = useMemo(() => countBy(rows), [rows]);
  const visible = useMemo(
    () => sortRows(filterRows(rows, filters), sort.key, sort.ascending),
    [rows, filters, sort],
  );

  if (students.isLoading) return <ScreenLoading label="Loading the students…" />;

  const chosen = [...selected];
  const error = sync.error ?? move.error ?? students.error;

  const toggle = (studentId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.studentId));

  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }));

  return (
    <>
      {/* SearchBar lays out its own row and summary; wrapping it in a flex row would
          drag the summary up beside the buttons. */}
      <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
        <SearchBar
          stored={stored}
          pulling={sync.isPending}
          onPull={(filter, meta) => sync.mutate({ filter, meta })}
          onForget={() => setConfirmForget(true)}
        />
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error instanceof PortalError ? error.message : (error as Error).message}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2">
        {STATUSES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilters({ ...filters, status: option.id })}
            className={`rounded-md px-2.5 py-1.5 text-sm ${
              filters.status === option.id
                ? "bg-[#e8edf3] font-semibold text-[#1f4e79]"
                : "text-[#667085] hover:bg-[#f2f7fb]"
            }`}
          >
            {option.label}
            <span className="ml-1.5 tabular-nums text-xs text-[#98a2b3]">{counts[option.id]}</span>
          </button>
        ))}

        <span className="mx-1 text-[#e4e8ef]">|</span>

        <div className="w-44">
          <SelectMenu
            label="Cohort"
            value={filters.cohort}
            placeholder="Cohort: any"
            searchable={cohorts.length > 12}
            options={[
              { value: "", label: "Cohort: any" },
              { value: "none", label: "No cohort yet" },
              ...cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name })),
            ]}
            onChange={(cohort) => setFilters({ ...filters, cohort })}
          />
        </div>
        <Choice
          label="Year"
          value={filters.yearLevel}
          options={choices(rows, "yearLevel")}
          onChange={(yearLevel) => setFilters({ ...filters, yearLevel })}
        />
        <Choice
          label="Major"
          value={filters.major}
          options={choices(rows, "major")}
          onChange={(major) => setFilters({ ...filters, major })}
        />

        <label className="relative ml-auto block w-full sm:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label="Search students"
            type="search"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Search id, name or e-mail"
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {chosen.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-4 py-2.5 text-sm">
          <span className="font-semibold text-[#1f4e79]">{chosen.length} selected</span>
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
            />
          </div>
          <button
            type="button"
            disabled={!moveTo || move.isPending}
            onClick={() => move.mutate({ ids: chosen, cohortId: moveTo === NO_COHORT ? null : moveTo })}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            <FolderInput size={15} aria-hidden="true" /> Move {chosen.length}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-[#667085] underline">
            Clear
          </button>
        </div>
      ) : null}

      <section className="mt-3 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th scope="col" className="px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select everyone shown"
                  checked={allVisibleSelected}
                  onChange={() =>
                    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.studentId)))
                  }
                />
              </th>
              <SortHeader label="Status" column="status" sort={sort} onSort={sortBy} />
              <SortHeader label="Student" column="name" sort={sort} onSort={sortBy} />
              <SortHeader label="Id" column="studentId" sort={sort} onSort={sortBy} />
              <SortHeader label="Year" column="yearLevel" sort={sort} onSort={sortBy} />
              <SortHeader label="Major" column="major" sort={sort} onSort={sortBy} />
              <SortHeader label="Cohort" column="cohortName" sort={sort} onSort={sortBy} />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.studentId} className="border-t border-[#eef1f5]">
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name || row.studentId}`}
                    checked={selected.has(row.studentId)}
                    onChange={() => toggle(row.studentId)}
                  />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge row={row} />
                </td>
                <td className="px-4 py-2 font-semibold text-[#171717]">
                  {row.name || <span className="font-normal text-[#98a2b3]">name not pulled yet</span>}
                  {row.changes.length ? (
                    <span className="mt-0.5 block text-xs font-normal text-[#8a6d00]">
                      {row.changes.join(" · ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums text-[#344054]">{row.studentId}</td>
                <td className="px-4 py-2 text-[#667085]">{row.yearLevel || "—"}</td>
                <td className="px-4 py-2 text-[#667085]">{row.major || "—"}</td>
                <td className="px-4 py-2 text-[#667085]">
                  {row.cohortName || <span className="text-[#98a2b3]">—</span>}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm text-[#667085]">
                  {rows.length
                    ? "Nobody matches those filters."
                    : "No students yet. Sync with the portal to build the list."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <ConfirmDialog
        open={confirmForget}
        title="Forget the rosters stored in this browser?"
        description={
          "The names, e-mail addresses and year levels pulled from the portal are held in this " +
          "browser and will be cleared. No student leaves the list and no cohort changes — the " +
          "ids we keep are on the server and are not touched. Sync again and the names come back."
        }
        confirmLabel="Forget rosters"
        onConfirm={() => {
          forgetRosters();
          setStored({});
          setSyncedAt("");
          setConfirmForget(false);
        }}
        onClose={() => setConfirmForget(false)}
      />
    </>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; ascending: boolean };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === column;
  return (
    <th scope="col" className="px-4 py-3 font-semibold">
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 ${active ? "text-[#1f4e79]" : ""}`}
      >
        {label}
        {active ? (
          sort.ascending ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : (
            <ArrowDown size={12} aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="w-36">
      <SelectMenu
        label={label}
        value={value}
        placeholder={`${label}: any`}
        searchable={options.length > 12}
        options={[{ value: "", label: `${label}: any` }, ...options.map((option) => ({ value: option, label: option }))]}
        onChange={onChange}
      />
    </div>
  );
}

function StatusBadge({ row }: { row: StudentRow }) {
  return (
    <>
      {row.status === "not_in_portal" ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">
          Not in portal
        </span>
      ) : (
        <span className="text-xs text-[#667085]">In portal</span>
      )}
      {row.isNew ? (
        <span className="mt-1 block rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#256237]">
          New
        </span>
      ) : null}
      {row.changes.length ? (
        <span className="mt-1 block rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#8a6d00]">
          Changed
        </span>
      ) : null}
    </>
  );
}
