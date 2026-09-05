import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { Modal } from "@/components/Modal";
import { ScreenLoading } from "@/components/ScreenLoading";
import {
  type ActiveTeacher,
  type PartTimeTeacher,
  addActiveTeachers,
  fetchActiveTeachers,
  fetchPartTimeTeachers,
  removeActiveTeacher,
} from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

const COLUMNS: GridColumn<ActiveTeacher>[] = [
  { id: "fullName", displayName: "Name", type: "text", accessor: (row) => row.fullName, required: true, defaultWidth: 220 },
  { id: "email", displayName: "E-mail", type: "text", accessor: (row) => row.email, defaultWidth: 240 },
  {
    id: "source",
    displayName: "Source",
    type: "option",
    accessor: (row) => (row.source === "both" ? "Portal and part-time DB" : row.source === "portal" ? "Portal" : "Part-time DB"),
    defaultWidth: 180,
  },
  { id: "type", displayName: "Type", type: "option", accessor: (row) => row.type, defaultWidth: 200 },
  { id: "category", displayName: "Category", type: "option", accessor: (row) => row.category, defaultWidth: 120 },
  { id: "department", displayName: "Dept.", type: "option", accessor: (row) => row.department, defaultWidth: 110 },
  { id: "courses", displayName: "Courses", type: "text", accessor: (row) => row.courses, defaultWidth: 220 },
  { id: "lastTerm", displayName: "Last term", type: "option", accessor: (row) => row.lastTerm, defaultWidth: 100 },
  { id: "rank", displayName: "Rank", type: "text", accessor: (row) => row.rank, defaultWidth: 180 },
  { id: "institution", displayName: "Institution", type: "text", accessor: (row) => row.institution, defaultWidth: 220 },
  { id: "portalTeacherId", displayName: "Portal ID", type: "text", accessor: (row) => row.portalTeacherId, defaultWidth: 110 },
  { id: "addedAt", displayName: "Added", type: "date", accessor: (row) => row.addedAt, display: (row) => row.addedAt.slice(0, 10), defaultWidth: 110 },
  { id: "addedBy", displayName: "Added by", type: "text", accessor: (row) => row.addedBy, defaultWidth: 200 },
];
const SHOWN = ["fullName", "email", "source", "type", "department", "courses", "lastTerm"];

const idOf = (row: ActiveTeacher) => row.id;
const labelOf = (row: ActiveTeacher) => row.fullName || row.email || row.id;
const renderCell = (row: ActiveTeacher, column: GridColumn<ActiveTeacher>) =>
  column.id === "source" ? (
    <span className="flex flex-wrap gap-1">
      {row.portalTeacherId ? <StatePill tone="muted">Portal</StatePill> : null}
      {row.partTimeTeacherId ? <StatePill tone="muted">Part-time DB</StatePill> : null}
    </span>
  ) : undefined;

/**
 * The department's own list of teachers.
 *
 * The portal lists every teacher the university has ever paid; the department deals
 * with a few dozen. They are chosen from the Teachers page, or brought from the
 * Part-time Teacher Database here — and a person on both sides is one row.
 */
export function ActiveTeachers() {
  const client = useQueryClient();
  const active = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: ["active-teachers"] });
  const add = useMutation({
    mutationFn: (records: PartTimeTeacher[]) => addActiveTeachers({ partTime: records }),
    onSuccess: () => {
      setPicking(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await removeActiveTeacher(id);
    },
    onSuccess: () => {
      setSelected(new Set());
      setConfirmRemove(false);
      refresh();
    },
  });

  const error = add.error?.message ?? remove.error?.message ?? null;

  return (
    <section>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">{error}</p>
      ) : null}
      {add.data ? (
        <p className="mb-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {add.data.added} added{add.data.linked ? `, ${add.data.linked} joined to a teacher already here` : ""}
          {add.data.skipped ? `, ${add.data.skipped} already here` : ""}.
        </p>
      ) : null}

      {active.isLoading ? (
        <ScreenLoading label="Loading active teachers…" />
      ) : active.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(active.error as Error).message}</p>
      ) : (
        <ListGrid
          columns={COLUMNS}
          rows={active.data ?? []}
          idOf={idOf}
          labelOf={labelOf}
          layoutKey="scen-columns:active-teachers:v1"
          presetKey="scen-copy-presets:active-teachers:v1"
          shown={SHOWN}
          initialSort={{ key: "fullName", ascending: true }}
          searchLabel="Search active teachers"
          noun="teachers"
          selected={selected}
          onSelectedChange={setSelected}
          renderCell={renderCell}
          empty="Nobody yet. Choose teachers on the Teachers page, or add them from the part-time database."
          toolbar={
            <>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
              >
                <UserPlus size={15} aria-hidden="true" /> Add from part-time database
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || remove.isPending}
                onClick={() => setConfirmRemove(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:opacity-50"
              >
                <Trash2 size={15} aria-hidden="true" /> {selected.size ? `Remove ${selected.size}` : "Remove"}
              </button>
            </>
          }
        />
      )}

      <PartTimePicker
        open={picking}
        already={new Set((active.data ?? []).map((row) => row.partTimeTeacherId).filter(Boolean))}
        busy={add.isPending}
        onAdd={(records) => add.mutate(records)}
        onClose={() => setPicking(false)}
      />

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${selected.size} from active teachers?`}
        description="They stay in the portal's list and in the part-time database; only the department's list forgets them."
        confirmLabel="Remove"
        onConfirm={() => remove.mutate([...selected])}
        onClose={() => setConfirmRemove(false)}
      />
    </section>
  );
}

/** The part-time teacher database's records that are not active yet, to pick from. */
function PartTimePicker({
  open,
  already,
  busy,
  onAdd,
  onClose,
}: {
  open: boolean;
  already: Set<string>;
  busy: boolean;
  onAdd: (records: PartTimeTeacher[]) => void;
  onClose: () => void;
}) {
  const partTime = useQuery({ queryKey: ["part-time-teachers"], queryFn: fetchPartTimeTeachers, enabled: open });
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (partTime.data ?? [])
      .filter((record) => !already.has(record.id))
      .filter((record) => !needle || `${record.fullName} ${record.email}`.toLowerCase().includes(needle))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [partTime.data, already, query]);

  return (
    <Modal
      open={open}
      title="Add from the part-time teacher database"
      description="Tick the teachers to add. One whose university e-mail is already on the list is joined to that row rather than added twice."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
          <button
            type="button"
            disabled={picked.size === 0 || busy}
            onClick={() => onAdd((partTime.data ?? []).filter((record) => picked.has(record.id)))}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            Add {picked.size || ""}
          </button>
        </div>
      }
    >
      <input
        aria-label="Search the part-time database"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by name or e-mail"
        className="mb-3 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
      />
      {partTime.isLoading ? (
        <p className="text-sm text-[#667085]">Reading the part-time database…</p>
      ) : partTime.error ? (
        <p className="text-sm text-[#a6292f]">{(partTime.error as Error).message}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-[#667085]">Everyone in the part-time database is already active.</p>
      ) : (
        <ul className="max-h-80 divide-y divide-[#eef1f5] overflow-y-auto text-sm" aria-label="Part-time teachers">
          {candidates.map((record) => (
            <li key={record.id}>
              <label className="flex cursor-pointer items-center gap-3 px-1 py-2">
                <input
                  type="checkbox"
                  checked={picked.has(record.id)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (next.has(record.id)) next.delete(record.id);
                      else next.add(record.id);
                      return next;
                    })
                  }
                />
                <span className="font-semibold text-[#171717]">{record.fullName}</span>
                <span className="text-xs text-[#667085]">{record.email}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
