import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { useStaffUser } from "@/components/useStaffUser";
import { describeFilter, filterLines, type Filter } from "@/services/filterSummary";
import { fetchSchema, type PortalField } from "@/services/scenRosters";
import { createView, deleteView, type StudentView } from "@/services/studentDatabase";

/**
 * Which population the Students page is showing, and what that view asks the portal.
 *
 * A view's filter was fixed when the view was made, so syncing asks the same question it
 * has always asked — which is the only reason "no longer in the portal" can be trusted.
 * There is deliberately no way to edit a filter: a different question is a different view.
 *
 * Making one and throwing one away are an administrator's, because both settle what a
 * population is. Asking the portal is Portal sync's, at the foot of the pane: one button
 * that syncs every list, so no page can be refreshed while the rest go stale.
 */
export function ViewBar({
  views,
  viewId,
  onChoose,
}: {
  views: StudentView[];
  viewId: string;
  onChoose: (viewId: string) => void;
}) {
  const client = useQueryClient();
  const user = useStaffUser();
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });

  const [composing, setComposing] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<StudentView | null>(null);
  const [showingFilter, setShowingFilter] = useState(false);
  const fields = schema.data?.fields ?? [];
  const view = views.find((candidate) => candidate.id === viewId) ?? null;
  const isAdmin = Boolean(user?.isAdmin);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["views"] });
    client.invalidateQueries({ queryKey: ["students"] });
    client.invalidateQueries({ queryKey: ["cohorts"] });
  };

  const make = useMutation({
    mutationFn: () => createView({ name: name.trim(), filter: composing ?? {} }),
    onSuccess: (created) => {
      setComposing(null);
      setName("");
      onChoose(created.id);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (target: StudentView) => deleteView(target.id),
    onSuccess: () => {
      onChoose("");
      refresh();
    },
  });

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Aligned to the bottom: the picker carries a label above it, the buttons do not. */}
      <div className="flex flex-wrap items-end justify-end gap-2">
        {/* Whose list this is: the same words as the button at the foot of the pane, so
            the filter chosen here is plainly the one that button will ask about. */}
        <div className="w-64">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#1f4e79]">Portal sync</p>
          <SelectMenu
            label="View"
            value={viewId}
            placeholder={views.length ? "Choose a portal filter…" : "No portal filters yet"}
            searchable={views.length > 12}
            options={views.map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
              // How many students the view holds. Muted at nothing, which is what a view
              // that has never been seeded looks like.
              badge: String(candidate.held),
              badgeTone: candidate.held ? ("accent" as const) : ("muted" as const),
              searchText: String(candidate.held),
            }))}
            onChange={onChoose}
          />
        </div>

        {view ? (
          <button
            type="button"
            aria-label={`What ${view.name} asks the portal`}
            title={`What ${view.name} asks the portal`}
            onClick={() => setShowingFilter(true)}
            className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
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
            className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        ) : null}

        {isAdmin && view ? (
          <button
            type="button"
            aria-label={`Delete ${view.name}`}
            title={`Delete ${view.name}`}
            onClick={() => setPendingDelete(view)}
            className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {view ? (
        <p className="max-w-md text-right text-xs text-[#98a2b3]">
          {describeFilter(view.filter as Filter, fields)}
          {view.gone ? ` · ${view.gone} no longer returned` : ""}
        </p>
      ) : null}

      <Modal
        open={showingFilter && view !== null}
        title={view ? `What ${view.name} asks the portal` : ""}
        description="Fixed when the portal filter was made and never edited since, which is what lets it tell you who has left. A different question would be a different portal filter."
        onClose={() => setShowingFilter(false)}
      >
        {view ? <FilterReading filter={view.filter as Filter} fields={fields} /> : null}
      </Modal>

      <Modal
        open={composing !== null}
        title="New portal filter"
        description="A portal filter is a population. What it asks the portal is fixed now and cannot be changed afterwards — that is what lets it tell you who has left."
        onClose={() => setComposing(null)}
        footer={
          <>
            <input
              aria-label="View name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this portal filter"
              className="w-56 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => setComposing(null)}
              className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]"
            >
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
        <p className="mb-3 rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-3 py-2 text-sm text-[#1f4e79]">
          Leave everything blank for every student the portal returns. Whatever you choose here
          is what this view will ask for every time it is synced, so a student outside it will be
          shown as no longer in this view.
        </p>

        {make.error ? (
          <p role="alert" className="mb-3 text-sm text-[#a6292f]">
            {(make.error as Error).message}
          </p>
        ) : null}

        <FilterBuilder
          fields={fields}
          filter={composing ?? {}}
          trusted={schema.data?.source === "portal"}
          onChange={setComposing}
        />
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this portal filter?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its record of who it returned will be removed for every coordinator. The students themselves stay — they are held whether or not a portal filter returns them.`
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

/**
 * A view's filter, laid out field by field.
 *
 * Both the portal's word and the portal's code, because they answer different questions:
 * the label says what the view means, the code is what a registrar would have to type to
 * ask the same thing anywhere else.
 */
function FilterReading({ filter, fields }: { filter: Filter; fields: PortalField[] }) {
  const lines = filterLines(filter, fields);

  if (lines.length === 0) {
    return (
      <p className="text-sm leading-6 text-[#667085]">
        No filters — this view asks for every student the portal will return.
      </p>
    );
  }

  return (
    <dl className="divide-y divide-[#eef1f5]">
      {lines.map((line) => (
        <div key={line.key} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
          <dt className="w-44 shrink-0">
            <span className="text-sm font-semibold text-[#344054]">{line.field}</span>
            {line.unknownField ? null : (
              <span className="mt-0.5 block font-mono text-[11px] text-[#98a2b3]">{line.key}</span>
            )}
          </dt>
          <dd className="flex min-w-0 flex-wrap gap-1.5">
            {line.values.map((value) => (
              <span
                key={value.value}
                className="inline-flex items-baseline gap-1.5 rounded-full bg-[#eef2f7] px-2.5 py-1 text-sm text-[#344054]"
              >
                {value.label}
                {value.label === value.value ? null : (
                  <span className="font-mono text-[11px] text-[#98a2b3]">{value.value}</span>
                )}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
