import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { useStaffUser } from "@/components/useStaffUser";
import { describeFilter, type Filter } from "@/services/filterSummary";
import { recordPull } from "@/services/pullHistory";
import { rememberPull, rememberSync } from "@/services/rosterStore";
import { PortalError, fetchSchema, pullFilter, studentIdOf } from "@/services/scenRosters";
import {
  createView,
  deleteView,
  fetchViewLock,
  setViewPassphrase,
  syncView,
  type StudentView,
} from "@/services/studentDatabase";

/**
 * Which population the Students page is showing, and the one button that refreshes it.
 *
 * A view's filter was fixed when the view was made, so syncing asks the same question it
 * has always asked — which is the only reason "no longer in the portal" can be trusted.
 * There is deliberately no way to edit a filter: a different question is a different view.
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
  const lock = useQuery({ queryKey: ["view-lock"], queryFn: fetchViewLock });

  const [composing, setComposing] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [pendingDelete, setPendingDelete] = useState<StudentView | null>(null);
  const [managingLock, setManagingLock] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState("");

  const fields = schema.data?.fields ?? [];
  const view = views.find((candidate) => candidate.id === viewId) ?? null;
  const isAdmin = Boolean(user?.isAdmin);
  const needsPassphrase = Boolean(lock.data?.locked) && !isAdmin;

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["views"] });
    client.invalidateQueries({ queryKey: ["students"] });
    client.invalidateQueries({ queryKey: ["cohorts"] });
  };

  const sync = useMutation({
    mutationFn: async (target: StudentView) => {
      const roster = await pullFilter(target.filter as Filter, { name: target.name, expect: null });
      const report = await syncView(target.id, roster.rows.map(studentIdOf).filter(Boolean));
      rememberPull({ ...roster, presetId: target.id });
      rememberSync(report.syncedAt);
      // One history per view, so a student's changes read against the same question.
      recordPull(roster.rows, roster.fetchedAt);
      return report;
    },
    onSuccess: refresh,
  });

  const make = useMutation({
    mutationFn: () =>
      createView({ name: name.trim(), filter: composing ?? {}, passphrase }),
    onSuccess: (created) => {
      setComposing(null);
      setName("");
      setPassphrase("");
      onChoose(created.id);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (target: StudentView) => deleteView(target.id, passphrase),
    onSuccess: () => {
      onChoose("");
      refresh();
    },
  });

  const relock = useMutation({
    mutationFn: () => setViewPassphrase(newPassphrase),
    onSuccess: () => {
      setManagingLock(false);
      setNewPassphrase("");
      client.invalidateQueries({ queryKey: ["view-lock"] });
    },
  });

  const report = sync.data;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="w-64">
          <SelectMenu
            label="View"
            value={viewId}
            placeholder={views.length ? "Choose a view…" : "No views yet"}
            searchable={views.length > 12}
            options={views.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.name} · ${candidate.held}`,
            }))}
            onChange={onChoose}
          />
        </div>

        <button
          type="button"
          disabled={!view || sync.isPending}
          onClick={() => view && sync.mutate(view)}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {sync.isPending ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={16} aria-hidden="true" />
          )}
          {sync.isPending ? "Syncing…" : view?.lastSyncedAt ? "Sync this view" : "Seed this view"}
        </button>

        <button
          type="button"
          aria-label="New view"
          title="New view"
          onClick={() => {
            setComposing({});
            setName("");
            setPassphrase("");
          }}
          className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc] hover:text-[#344054]"
        >
          <Plus size={16} aria-hidden="true" />
        </button>

        {view ? (
          <button
            type="button"
            aria-label={`Delete ${view.name}`}
            title={`Delete ${view.name}`}
            onClick={() => {
              setPassphrase("");
              setPendingDelete(view);
            }}
            className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {sync.error ? (
        <p role="alert" className="max-w-md text-right text-xs text-[#a6292f]">
          {sync.error instanceof PortalError ? sync.error.message : (sync.error as Error).message}
        </p>
      ) : report ? (
        <p className="text-xs text-[#98a2b3]">
          {report.seen} returned · {report.added} added · {report.missing} no longer in this view
        </p>
      ) : view ? (
        <p className="max-w-md text-right text-xs text-[#98a2b3]">
          {describeFilter(view.filter as Filter, fields)}
          {view.gone ? ` · ${view.gone} no longer returned` : ""}
        </p>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          onClick={() => setManagingLock((current) => !current)}
          className="text-xs text-[#1f4e79] underline"
        >
          {lock.data?.locked ? "Views are locked" : "Views are open to everyone"}
        </button>
      ) : null}

      {managingLock ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            aria-label="New view passphrase"
            value={newPassphrase}
            onChange={(event) => setNewPassphrase(event.target.value)}
            placeholder="Blank to remove the lock"
            className="w-56 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={relock.isPending}
            onClick={() => relock.mutate()}
            className="rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-sm font-semibold text-[#344054] disabled:opacity-50"
          >
            {newPassphrase.trim() ? "Lock views" : "Unlock views"}
          </button>
        </div>
      ) : null}

      <Modal
        open={composing !== null}
        title="New view"
        description="A view is a population. Its filter is fixed now and cannot be changed afterwards — that is what lets it tell you who has left."
        onClose={() => setComposing(null)}
        footer={
          <>
            <input
              aria-label="View name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this view"
              className="w-56 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
            />
            {needsPassphrase ? (
              <input
                type="password"
                aria-label="Passphrase"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="Passphrase"
                className="w-40 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
              />
            ) : null}
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
              {make.isPending ? "Creating…" : "Create view"}
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
        title="Delete this view?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its record of who it returned will be removed for every coordinator. The students themselves stay — they are held whether or not a view returns them.`
            : ""
        }
        confirmLabel="Delete view"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
