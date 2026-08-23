import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderInput, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ColumnMenu } from "@/components/ColumnMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentTable, type Sort } from "@/components/StudentTable";
import { TableFilterBar } from "@/components/TableFilterBar";
import { changesSince, studentRows, type StudentRow } from "@/services/rosterView";
import { PortalError } from "@/services/scenRosters";
import {
  forgetRosters,
  lastPulled,
  lastSync,
  loadPull,
  type StoredPreset,
} from "@/services/rosterStore";
import {
  loadLayout,
  optionsFor,
  resizeColumn,
  saveLayout,
  visibleColumns,
  type ColumnLayout,
} from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import { fetchStudents, setCohort, type Cohort } from "@/services/studentDatabase";

/** Where a student goes when the picker is used, with "no cohort" as a real choice. */
const NO_COHORT = "__none__";

/**
 * Every student we hold, and what the portal last said about them.
 *
 * The list comes from one place — the sync, whose population is set in Sync settings.
 * Nothing on this page changes who is a student: the filters here narrow what is *shown*,
 * and saved searches live on the Portal views tab, where they look at portal data without
 * touching the record.
 *
 * Names, e-mail addresses and year levels come from the SCEN Rosters extension and are
 * kept in this browser alone — see services/rosterStore.ts.
 */
export function StudentRoster({ cohorts }: { cohorts: Cohort[] }) {
  const client = useQueryClient();
  const students = useQuery({ queryKey: ["students"], queryFn: fetchStudents });

  const [stored, setStored] = useState<StoredPreset>({});
  const [syncedAt, setSyncedAt] = useState("");
  const [layout, setLayout] = useState<ColumnLayout>(loadLayout);
  const [filters, setFilters] = useState<FilterModel[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "studentId", ascending: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [confirmForget, setConfirmForget] = useState(false);

  // The names live in this browser, so they are read back on mount rather than fetched.
  useEffect(() => {
    setStored(loadPull(lastPulled()));
    setSyncedAt(lastSync());
  }, [students.dataUpdatedAt]);

  const arrange = (next: ColumnLayout) => {
    setLayout(next);
    saveLayout(next);
  };

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

  const columns = useMemo(() => visibleColumns(layout), [layout]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? rows.filter(
          (row) =>
            row.studentId.toLowerCase().includes(needle) ||
            row.name.toLowerCase().includes(needle) ||
            row.email.toLowerCase().includes(needle),
        )
      : rows;
    return sortRows(applyFilters(searched, columns, filters), sort);
  }, [rows, columns, filters, sort, query]);

  if (students.isLoading) return <ScreenLoading label="Loading the students…" />;

  const chosen = [...selected];
  const error = move.error ?? students.error;

  const toggle = (studentId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });

  const allShown = visible.length > 0 && visible.every((row) => selected.has(row.studentId));

  return (
    <>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error instanceof PortalError ? error.message : (error as Error).message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
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
            placeholder="Search id, name or e-mail"
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>

        <ColumnMenu layout={layout} onChange={arrange} />
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

      <StudentTable
        rows={visible}
        columns={columns}
        layout={layout}
        sort={sort}
        selected={selected}
        onSort={(key) =>
          setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }))
        }
        onResize={(id, width) => arrange(resizeColumn(layout, id, width))}
        onToggle={toggle}
        onToggleAll={() =>
          setSelected(allShown ? new Set() : new Set(visible.map((row) => row.studentId)))
        }
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

function sortRows(rows: StudentRow[], sort: Sort): StudentRow[] {
  const direction = sort.ascending ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = String(left[sort.key as keyof StudentRow] ?? "");
    const b = String(right[sort.key as keyof StudentRow] ?? "");
    const compared = a.localeCompare(b, undefined, { numeric: true });
    return (compared || left.studentId.localeCompare(right.studentId)) * direction;
  });
}
