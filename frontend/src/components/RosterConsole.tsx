import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, Download, Loader2, Search, UserPlus, UserX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
import {
  chosenCrn,
  courseFamilies,
  reconcile,
  withGroup,
  type ReconcileRow,
  type RowStatus,
} from "@/services/rosterReconcile";
import {
  PortalError,
  isExtensionInstalled,
  listPresets,
  pullRoster,
  type PortalRoster,
  type RosterPreset,
} from "@/services/scenRosters";
import {
  AssignmentConflictError,
  fetchRoster,
  saveStudentAssignment,
  type TimetableTerm,
} from "@/services/timetables";

const FILTERS: { id: RowStatus | "all"; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "joined", label: "Joined" },
  { id: "left", label: "Left" },
  { id: "assigned", label: "In the term" },
];

/**
 * Reconcile one semester against the registrar portal.
 *
 * The names on this screen come from the SCEN Rosters extension and stay in this tab:
 * they are held in component state, and only the student id and the CRNs they hold are
 * ever sent to our API. Reloading the page loses the names, which is the point.
 */
export function RosterConsole({ term, onBack }: { term: TimetableTerm; onBack: () => void }) {
  const client = useQueryClient();
  const roster = useQuery({ queryKey: ["roster", term.id], queryFn: () => fetchRoster(term.id) });

  const [portal, setPortal] = useState<PortalRoster | null>(null);
  const [presets, setPresets] = useState<RosterPreset[] | null>(null);
  const [preset, setPreset] = useState("");
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [conflict, setConflict] = useState<{ studentId: string; message: string } | null>(null);
  const [savingId, setSavingId] = useState("");

  useEffect(() => {
    // Ask once, on arrival: an absent extension is a normal state, not an error.
    let cancelled = false;
    void (async () => {
      const installed = await isExtensionInstalled();
      if (cancelled) return;
      const available = installed ? await listPresets() : [];
      if (cancelled) return;
      setPresets(available);
      setPreset((current) => current || available[0]?.id || "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pull = useMutation({
    mutationFn: () => pullRoster(preset),
    onSuccess: setPortal,
  });

  const save = useMutation({
    mutationFn: (input: { studentId: string; crns: string[]; version: number }) =>
      saveStudentAssignment({ termId: term.id, ...input }),
    onMutate: ({ studentId }) => {
      setSavingId(studentId);
      setConflict(null);
    },
    onSettled: () => setSavingId(""),
    onSuccess: () => client.invalidateQueries({ queryKey: ["roster", term.id] }),
    onError: (error, { studentId }) => {
      if (error instanceof AssignmentConflictError) {
        setConflict({
          studentId,
          message: `${error.updatedBy} changed this student ${relativeTime(error.updatedAt)}. Their version is now shown.`,
        });
        void client.invalidateQueries({ queryKey: ["roster", term.id] });
      }
    },
  });

  const families = useMemo(() => courseFamilies(roster.data?.courses ?? []), [roster.data]);
  const { rows, counts } = useMemo(
    () => reconcile(roster.data?.students ?? [], portal?.rows ?? []),
    [roster.data, portal],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (filter === "all" || row.status === filter) &&
        (!needle ||
          row.studentId.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle)),
    );
  }, [rows, filter, query]);

  if (roster.isLoading) return <ScreenLoading label="Loading the semester…" />;
  if (roster.error) {
    return (
      <div className="mx-auto max-w-[86rem] px-4 py-10">
        <p role="alert" className="text-sm text-[#a6292f]">
          {(roster.error as Error).message}
        </p>
      </div>
    );
  }

  const setGroup = (row: ReconcileRow, familyKey: string, crn: string) => {
    const family = families.find((candidate) => candidate.key === familyKey);
    if (!family) return;
    save.mutate({ studentId: row.studentId, crns: withGroup(family, row.crns, crn), version: row.version });
  };

  return (
    <div className="mx-auto max-w-[86rem] px-4 py-6 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f4e79]"
      >
        <ArrowLeft size={17} aria-hidden="true" /> Back to semesters
      </button>

      <header className="mt-4 flex flex-col justify-between gap-4 border-b border-[#d9dee7] pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-[#a6292f]">Student groups</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#171717]">{term.name}</h2>
          <p className="mt-1 text-sm text-[#667085]">
            Names come from the registrar portal and stay in this tab. Only the student id and their
            groups are saved.
          </p>
        </div>
        <PortalControls
          presets={presets}
          preset={preset}
          onPreset={setPreset}
          onPull={() => pull.mutate()}
          pulling={pull.isPending}
          portal={portal}
          error={pull.error}
        />
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              filter === option.id
                ? "bg-[#e8edf3] text-[#1f4e79]"
                : "border border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
            }`}
          >
            {option.label}
            <span className="ml-2 tabular-nums text-xs text-[#667085]">
              {option.id === "all" ? rows.length : counts[option.id]}
            </span>
          </button>
        ))}
        <label className="relative ml-auto block w-full sm:w-72">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label="Search students"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search id or name"
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>
      </div>

      {save.error && !(save.error instanceof AssignmentConflictError) ? (
        <p role="alert" className="mt-4 text-sm text-[#a6292f]">
          {(save.error as Error).message}
        </p>
      ) : null}

      <section className="mt-4 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Student</th>
              {families.map((family) => (
                <th key={family.key} scope="col" className="px-3 py-3 font-semibold">
                  {family.label}
                  <span className="mt-0.5 block text-[11px] font-normal normal-case text-[#98a2b3]">
                    {family.title}
                  </span>
                </th>
              ))}
              <th scope="col" className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.studentId} className="border-t border-[#e4e8ef] align-top">
                <td className="px-5 py-3">
                  <StatusBadge status={row.status} />
                  <span className="mt-1 block font-semibold text-[#171717]">
                    {row.name || row.studentId}
                  </span>
                  <span className="block text-xs text-[#667085]">
                    {row.name ? row.studentId : "no name until you pull the roster"}
                    {row.yearLevel ? ` · ${row.yearLevel}` : ""}
                  </span>
                  {row.updatedBy ? (
                    <span className="mt-1 block text-xs text-[#667085]">
                      last changed by {row.updatedBy}
                    </span>
                  ) : null}
                  {conflict?.studentId === row.studentId ? (
                    <span role="alert" className="mt-1 block text-xs font-semibold text-[#a6292f]">
                      {conflict.message}
                    </span>
                  ) : null}
                </td>
                {families.map((family) => (
                  <td key={family.key} className="px-3 py-3">
                    <select
                      aria-label={`${family.label} for ${row.name || row.studentId}`}
                      value={chosenCrn(family, row.crns)}
                      disabled={savingId === row.studentId}
                      onChange={(event) => setGroup(row, family.key, event.target.value)}
                      className="w-full rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm disabled:opacity-50"
                    >
                      <option value="">—</option>
                      {family.options.map((option) => (
                        <option key={option.crn} value={option.crn}>
                          {option.group}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td className="px-5 py-3 text-right">
                  {savingId === row.studentId ? (
                    <Loader2 size={16} className="ml-auto animate-spin text-[#667085]" aria-label="Saving" />
                  ) : row.crns.length ? (
                    <button
                      type="button"
                      onClick={() =>
                        save.mutate({ studentId: row.studentId, crns: [], version: row.version })
                      }
                      className="rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={families.length + 2} className="grid min-h-40 place-items-center px-5 py-10 text-sm text-[#667085]">
                  {rows.length ? "Nobody matches that filter." : "This semester has no students yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  if (status === "joined") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#256237]">
        <UserPlus size={12} aria-hidden="true" /> Joined
      </span>
    );
  }
  if (status === "left") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">
        <UserX size={12} aria-hidden="true" /> Left the portal
      </span>
    );
  }
  return <span className="text-xs text-[#667085]">In the term</span>;
}

function PortalControls({
  presets,
  preset,
  onPreset,
  onPull,
  pulling,
  portal,
  error,
}: {
  presets: RosterPreset[] | null;
  preset: string;
  onPreset: (id: string) => void;
  onPull: () => void;
  pulling: boolean;
  portal: PortalRoster | null;
  error: unknown;
}) {
  if (presets === null) {
    return <p className="text-sm text-[#667085]">Looking for the SCEN Rosters extension…</p>;
  }
  if (presets.length === 0) {
    return (
      <p className="max-w-sm text-sm text-[#667085]">
        The SCEN Rosters extension is not answering, so this screen can only show the ids the
        semester already holds. Install or enable it, then reload.
      </p>
    );
  }

  return (
    <div className="w-full sm:w-auto">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Saved portal search"
          value={preset}
          onChange={(event) => onPreset(event.target.value)}
          className="rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
        >
          {presets.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onPull}
          disabled={pulling || !preset}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pulling ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          {pulling ? "Pulling…" : "Pull from portal"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 max-w-sm text-sm text-[#a6292f]">
          {error instanceof PortalError ? error.message : (error as Error).message}
        </p>
      ) : portal ? (
        <p className="mt-2 text-sm text-[#667085]">
          {portal.warning === "zero_rows" ? (
            <span className="inline-flex items-center gap-1 font-semibold text-[#a6292f]">
              <AlertTriangle size={14} aria-hidden="true" /> The portal returned nobody — check the saved search.
            </span>
          ) : portal.warning === "count_drift" ? (
            <span className="inline-flex items-center gap-1 font-semibold text-[#8a6d00]">
              <AlertTriangle size={14} aria-hidden="true" /> {portal.count} students, expected about {portal.expect}.
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Check size={14} className="text-[#256237]" aria-hidden="true" /> {portal.count} students from{" "}
              {portal.name}.
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}

function relativeTime(iso: string): string {
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return "a moment ago";
  const minutes = Math.round((Date.now() - when) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
