import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { useStaffUser } from "@/components/useStaffUser";
import { describeFilter, filterLines, type Filter } from "@/services/filterSummary";
import {
  type ListKind,
  type PortalFilter,
  createPortalFilter,
  deletePortalFilter,
  fetchPortalFilters,
} from "@/services/portalLists";
import { fetchGridSchema } from "@/services/scenRosters";

const NOUNS: Record<ListKind, { one: string; many: string }> = {
  courses: { one: "course", many: "courses" },
  teachers: { one: "teacher", many: "teachers" },
  registrations: { one: "student", many: "students" },
};

/**
 * Which portal filter a list is showing, and what that filter asks the portal.
 *
 * The ViewBar for the three lists that are not students: the same saved-filter idea —
 * a question fixed when the filter was made, so "no longer returned" means something —
 * pointed at the portal's courses, teachers or registrations grid.
 *
 * Choosing, reading and keeping filters only. Asking the portal is Portal sync's, at the
 * foot of the pane: one button that syncs every list, so there is no longer a way to
 * refresh one page and leave the rest a week stale.
 */
export function PortalFilterBar({
  kind,
  filterId,
  onChoose,
}: {
  kind: ListKind;
  filterId: string;
  onChoose: (filterId: string) => void;
}) {
  const client = useQueryClient();
  const user = useStaffUser();
  const filters = useQuery({ queryKey: ["portal-filters", kind], queryFn: () => fetchPortalFilters(kind) });
  const schema = useQuery({ queryKey: ["portal-schema", kind], queryFn: () => fetchGridSchema(kind), staleTime: 60_000 });

  const [composing, setComposing] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PortalFilter | null>(null);
  const [showingFilter, setShowingFilter] = useState(false);
  const fields = schema.data?.fields ?? [];
  const available = filters.data ?? [];
  const chosen = available.find((candidate) => candidate.id === filterId) ?? null;
  const isAdmin = Boolean(user?.isAdmin);
  const noun = NOUNS[kind];

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["portal-filters", kind] });
    client.invalidateQueries({ queryKey: ["portal", kind] });
    if (kind === "registrations") client.invalidateQueries({ queryKey: ["registration-check"] });
  };

  const make = useMutation({
    mutationFn: () => createPortalFilter({ kind, name: name.trim(), filter: composing ?? {} }),
    onSuccess: (created) => {
      setComposing(null);
      setName("");
      onChoose(created.id);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (target: PortalFilter) => deletePortalFilter(target.id),
    onSuccess: () => {
      onChoose("");
      refresh();
    },
  });

  const button = "rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]";

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Aligned to the bottom: the picker carries a label above it, the buttons do not. */}
      <div className="flex flex-wrap items-end justify-end gap-2">
        {/* Whose list this is: the same words as the button at the foot of the pane, so
            the filter chosen here is plainly the one that button will ask about. */}
        <div className="w-64">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#1f4e79]">Portal sync</p>
          <SelectMenu
            label="Portal filter"
            value={filterId}
            placeholder={available.length ? "Choose a portal filter…" : "No portal filters yet"}
            searchable={available.length > 12}
            options={available.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
              badge: String(candidate.held),
              badgeTone: candidate.held ? ("accent" as const) : ("muted" as const),
            }))}
            onChange={onChoose}
          />
        </div>

        {chosen ? (
          <button
            type="button"
            aria-label={`What ${chosen.name} asks the portal`}
            title={`What ${chosen.name} asks the portal`}
            onClick={() => setShowingFilter(true)}
            className={button}
          >
            <Settings2 size={16} aria-hidden="true" />
          </button>
        ) : null}

        {isAdmin ? (
          <button
            type="button"
            aria-label="New portal filter"
            title="New portal filter"
            onClick={() => {
              setComposing({});
              setName("");
            }}
            className={button}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        ) : null}

        {isAdmin && chosen ? (
          <button
            type="button"
            aria-label={`Delete ${chosen.name}`}
            title={`Delete ${chosen.name}`}
            onClick={() => setPendingDelete(chosen)}
            className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {chosen ? (
        <p className="max-w-md text-right text-xs text-[#98a2b3]">
          {describeFilter(chosen.filter, fields)}
          {chosen.gone ? ` · ${chosen.gone} no longer returned` : ""}
          {chosen.lastSyncedAt ? ` · last synced ${new Date(chosen.lastSyncedAt).toLocaleString()}` : " · never synced"}
        </p>
      ) : null}

      <Modal
        open={showingFilter && chosen !== null}
        title={chosen ? `What ${chosen.name} asks the portal` : ""}
        description="Fixed when the portal filter was made and never edited since, which is what lets it tell you what has left."
        onClose={() => setShowingFilter(false)}
      >
        {chosen ? (
          <dl className="space-y-2 text-sm">
            {filterLines(chosen.filter, fields).length === 0 ? (
              <p className="text-[#667085]">No filters — everything the portal returns for the term.</p>
            ) : (
              filterLines(chosen.filter, fields).map((line) => (
                <div key={line.key} className="flex flex-wrap gap-x-3">
                  <dt className="font-semibold text-[#344054]">{line.field}</dt>
                  <dd className="text-[#667085]">{line.values.map((value) => value.label).join(", ")}</dd>
                </div>
              ))
            )}
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={composing !== null}
        title="New portal filter"
        description={`A portal filter is a fixed question to the portal's ${noun.many} list. It cannot be changed afterwards — that is what lets it tell you what has left.`}
        onClose={() => setComposing(null)}
        footer={
          <>
            <input
              aria-label="Filter name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this portal filter"
              className="w-56 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
            />
            <button type="button" onClick={() => setComposing(null)} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || make.isPending}
              onClick={() => make.mutate()}
              className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {make.isPending ? "Creating…" : "Create portal filter"}
            </button>
          </>
        }
      >
        {schema.data && !schema.data.ok ? (
          <p role="alert" className="mb-3 text-sm text-[#a6292f]">{schema.data.error}</p>
        ) : null}
        {make.error ? (
          <p role="alert" className="mb-3 text-sm text-[#a6292f]">{(make.error as Error).message}</p>
        ) : null}
        <FilterBuilder fields={fields} filter={composing ?? {}} trusted={false} onChange={setComposing} />
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this portal filter?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its record of what it returned will be removed for every coordinator. The ${noun.many} themselves stay.`
            : ""
        }
        confirmLabel="Delete portal filter"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
