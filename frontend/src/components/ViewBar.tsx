import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { useStaffUser } from "@/components/useStaffUser";
import { describeFilter, filterLines, type Filter } from "@/services/filterSummary";
import { backUpHistory, type BackupOutcome } from "@/services/historyBackup";
import { recordPull } from "@/services/pullHistory";
import { rememberPull, rememberSync, storageReport, type StorageReport } from "@/services/rosterStore";
import {
  PortalError,
  fetchSchema,
  pullFilter,
  studentIdOf,
  type PortalField,
  type PullProgress,
} from "@/services/scenRosters";
import { createView, deleteView, syncView, type StudentView } from "@/services/studentDatabase";

/**
 * Which population the Students page is showing, and the one button that refreshes it.
 *
 * A view's filter was fixed when the view was made, so syncing asks the same question it
 * has always asked — which is the only reason "no longer in the portal" can be trusted.
 * There is deliberately no way to edit a filter: a different question is a different view.
 *
 * Making one and throwing one away are an administrator's, because both settle what a
 * population is. Syncing is everybody's: it re-asks a question already settled.
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
  // How far the pull has got. A whole term is thousands of students and several minutes;
  // a button that only says "Syncing…" for that long is indistinguishable from a hang.
  const [pulled, setPulled] = useState<PullProgress | null>(null);
  // Whether the names actually reached this browser's storage. They are read back from
  // there, so a refused write is a table with no names in it rather than a slower page.
  const [storage, setStorage] = useState<StorageReport | null>(null);
  // Whether the copy on disk kept up. Null until a sync has tried.
  const [backup, setBackup] = useState<BackupOutcome | null>(null);

  const fields = schema.data?.fields ?? [];
  const view = views.find((candidate) => candidate.id === viewId) ?? null;
  const isAdmin = Boolean(user?.isAdmin);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["views"] });
    client.invalidateQueries({ queryKey: ["students"] });
    client.invalidateQueries({ queryKey: ["cohorts"] });
  };

  const sync = useMutation({
    mutationFn: async (target: StudentView) => {
      setPulled(null);
      const roster = await pullFilter(
        target.filter as Filter,
        { name: target.name, expect: null },
        setPulled,
      );
      const report = await syncView(target.id, roster.rows.map(studentIdOf).filter(Boolean));
      // Awaited, not fired off: the browser answers for its own disk asynchronously, and
      // the report below is only true once the write has actually landed.
      await rememberPull({ ...roster, presetId: target.id });
      setStorage(storageReport());
      rememberSync(target.id, report.syncedAt);
      // One history per view, so a student's changes read against the same question.
      await recordPull(target.id, roster.rows, roster.fetchedAt);
      /*
       * The history is the one thing here that cannot be rebuilt from the server, so the
       * copy on disk is rewritten while we know it has just changed. It does nothing
       * until a folder has been chosen.
       *
       * Awaited and reported rather than fired off: a backup that quietly stopped working
       * is worse than no backup, because it is only discovered when it is needed. A
       * failure still must not fail the sync — the students are synced either way.
       */
      setBackup(await backUpHistory());
      return report;
    },
    onSettled: () => setPulled(null),
    onSuccess: refresh,
  });

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

  const report = sync.data;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="w-64">
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
          {sync.isPending
            ? pulled
              ? `${pulled.fetched.toLocaleString()}${pulled.total ? ` of ${pulled.total.toLocaleString()}` : ""}…`
              : "Syncing…"
            : view?.lastSyncedAt
              ? "Sync this filter"
              : "Seed this filter"}
        </button>

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

      {sync.error ? (
        <p role="alert" className="max-w-md text-right text-xs text-[#a6292f]">
          {sync.error instanceof PortalError ? sync.error.message : (sync.error as Error).message}
        </p>
      ) : backup && !backup.ok && backup.reason !== "no_folder" ? (
        <p role="alert" className="max-w-md text-right text-xs text-[#a6292f]">
          {backup.reason === "no_permission"
            ? "Synced, but the history was not copied to your folder — Chrome needs you to allow it again."
            : "Synced, but the history could not be written to your folder."}
        </p>
      ) : storage && !storage.stored ? (
        <p role="alert" className="max-w-md text-right text-xs text-[#a6292f]">
          The students synced, but this browser had no room to keep their names, so the
          table will show ids only. Use “Forget stored rosters” on the Students page to
          clear the older pulls, then sync again.
        </p>
      ) : storage && storage.shed.length ? (
        <p className="max-w-md text-right text-xs text-[#98a2b3]">
          Synced. This browser was full, so it gave up {storage.shed[0]}
          {storage.shed.length > 1 ? ` and ${storage.shed.length - 1} more` : ""} to keep
          this roster.
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
