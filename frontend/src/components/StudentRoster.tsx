import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Filter } from "@/services/filterSummary";
import { PortalFilterFields } from "@/components/PortalFilterFields";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SearchBar } from "@/components/SearchBar";
import { PortalError, pullFilter } from "@/services/scenRosters";
import {
  changesSince,
  choices,
  countBy,
  filterRows,
  sortRows,
  studentRows,
  NO_FILTERS,
  type Membership,
  type SortKey,
} from "@/services/rosterView";
import {
  forgetRosters,
  lastPulled,
  loadPull,
  rememberPull,
  type StoredPreset,
} from "@/services/rosterStore";
import { addMembers, fetchMembers, removeMembers, type Cohort } from "@/services/studentDatabase";

/** A saved search's name is its store key; two searches keep two rosters. */
function keyFor(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60) || "last-pull";
}

const MEMBERSHIPS: { id: Membership | "all" | "changed"; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "new", label: "New" },
  { id: "left", label: "Left" },
  { id: "changed", label: "Changed" },
  { id: "stayed", label: "In the cohort" },
];

/**
 * The registrar's roster, and what it says about one cohort.
 *
 * Names, e-mail addresses and year levels come from the SCEN Rosters extension and are
 * kept in this browser's own storage — see services/rosterStore.ts, which is also what
 * makes "changed" answerable. What is sent to us is a list of student ids against a
 * cohort: nothing else, ever.
 */
export function StudentRoster({ cohorts }: { cohorts: Cohort[] }) {
  const client = useQueryClient();
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? "");
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? cohorts[0] ?? null;

  const [stored, setStored] = useState<StoredPreset>({});
  // One store per saved search, so switching search does not lose either roster.
  const [storeKey, setStoreKey] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "membership",
    ascending: true,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const members = useQuery({
    queryKey: ["cohort-members", cohort?.id],
    queryFn: () => fetchMembers(cohort?.id ?? ""),
    enabled: Boolean(cohort),
  });

  // Reading the store on mount is what makes the roster survive changing page, and
  // keeping the pull before it is what makes "changed" answerable tomorrow.
  useEffect(() => setStored(loadPull(storeKey || lastPulled())), [storeKey]);

  const pull = useMutation({
    mutationFn: ({ filter, meta }: { filter: Filter; meta: { name: string; expect: number | null } }) =>
      pullFilter(filter, meta),
    onSuccess: (roster) => {
      const key = keyFor(roster.name);
      setStoreKey(key);
      setStored(rememberPull({ ...roster, presetId: key }));
    },
  });
  const refreshMembers = () => client.invalidateQueries({ queryKey: ["cohort-members", cohort?.id] });
  const add = useMutation({
    mutationFn: (ids: string[]) => addMembers(cohort?.id ?? "", ids),
    onSuccess: () => {
      setSelected(new Set());
      refreshMembers();
      client.invalidateQueries({ queryKey: ["cohorts"] });
    },
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => removeMembers(cohort?.id ?? "", ids),
    onSuccess: () => {
      setSelected(new Set());
      refreshMembers();
      client.invalidateQueries({ queryKey: ["cohorts"] });
    },
  });

  const changes = useMemo(
    () => changesSince(stored.previous?.rows ?? [], stored.current?.rows ?? []),
    [stored],
  );
  const rows = useMemo(
    () =>
      studentRows(
        stored.current?.rows ?? [],
        (members.data ?? []).map((member) => member.studentId),
        changes,
      ),
    [stored, members.data, changes],
  );
  const counts = useMemo(() => countBy(rows), [rows]);
  const visible = useMemo(
    () => sortRows(filterRows(rows, filters), sort.key, sort.ascending),
    [rows, filters, sort],
  );

  if (cohorts.length === 0) {
    return (
      <p className="text-sm text-[#667085]">
        Create a cohort first — the roster is always read against one.
      </p>
    );
  }
  if (members.isLoading) return <ScreenLoading label="Loading the cohort…" />;

  const chosen = [...selected];
  const toAdd = chosen.filter((id) => rows.find((row) => row.studentId === id)?.membership !== "stayed");
  const toRemove = chosen.filter((id) => rows.find((row) => row.studentId === id)?.membership !== "new");
  const error = pull.error ?? add.error ?? remove.error ?? members.error;

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
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4">
        <label className="text-sm font-semibold text-[#344054]">
          Against cohort
          <select
            value={cohort?.id ?? ""}
            onChange={(event) => {
              setCohortId(event.target.value);
              setSelected(new Set());
            }}
            className="ml-2 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          >
            {cohorts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.term ? ` — ${candidate.term}` : ""}
              </option>
            ))}
          </select>
        </label>

      </div>

      <SearchBar
        stored={stored}
        pulling={pull.isPending}
        onPull={(filter, meta) => pull.mutate({ filter, meta })}
        onForget={() => {
          forgetRosters();
          setStored({});
        }}
      />

      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error instanceof PortalError ? error.message : (error as Error).message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {MEMBERSHIPS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilters({ ...filters, membership: option.id })}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              filters.membership === option.id
                ? "bg-[#e8edf3] text-[#1f4e79]"
                : "border border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
            }`}
          >
            {option.label}
            <span className="ml-2 tabular-nums text-xs text-[#667085]">{counts[option.id]}</span>
          </button>
        ))}

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
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-4 py-3 text-sm">
          <span className="font-semibold text-[#1f4e79]">{chosen.length} selected</span>
          <button
            type="button"
            disabled={!toAdd.length || add.isPending}
            onClick={() => add.mutate(toAdd)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            <UserPlus size={15} aria-hidden="true" /> Add {toAdd.length} to {cohort?.name}
          </button>
          <button
            type="button"
            disabled={!toRemove.length || remove.isPending}
            onClick={() => remove.mutate(toRemove)}
            className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 font-semibold text-[#a6292f] disabled:opacity-50"
          >
            <UserMinus size={15} aria-hidden="true" /> Remove {toRemove.length}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-[#667085] underline">
            Clear
          </button>
        </div>
      ) : null}

      <section className="mt-4 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[48rem] text-left text-sm">
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
              <SortHeader label="Status" column="membership" sort={sort} onSort={sortBy} />
              <SortHeader label="Student" column="name" sort={sort} onSort={sortBy} />
              <SortHeader label="Id" column="studentId" sort={sort} onSort={sortBy} />
              <SortHeader label="Year" column="yearLevel" sort={sort} onSort={sortBy} />
              <SortHeader label="Major" column="major" sort={sort} onSort={sortBy} />
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
                  <MembershipBadge membership={row.membership} />
                  {row.changes.length ? (
                    <span className="mt-1 block rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#8a6d00]">
                      Changed
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 font-semibold text-[#171717]">
                  {row.name || <span className="font-normal text-[#98a2b3]">not in today's pull</span>}
                  {row.changes.length ? (
                    <span className="mt-0.5 block text-xs font-normal text-[#8a6d00]">
                      {row.changes.join(" · ")}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 tabular-nums text-[#344054]">{row.studentId}</td>
                <td className="px-4 py-2 text-[#667085]">{row.yearLevel || "—"}</td>
                <td className="px-4 py-2 text-[#667085]">{row.major || "—"}</td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-[#667085]">
                  {rows.length
                    ? "Nobody matches those filters."
                    : "Pull the roster to see students, or add the cohort's members first."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <PortalFilterFields />
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
    <label className="text-sm text-[#344054]">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm"
      >
        <option value="">{label}: any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MembershipBadge({ membership }: { membership: Membership }) {
  if (membership === "new") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#256237]">
        New
      </span>
    );
  }
  if (membership === "left") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">
        Left
      </span>
    );
  }
  return <span className="text-xs text-[#667085]">In the cohort</span>;
}
