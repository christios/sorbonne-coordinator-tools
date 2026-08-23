import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Eye, Loader2, Plus, SlidersHorizontal, Save, Trash2, X } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { describeFilter, type Filter } from "@/services/filterSummary";
import { displayNameOf, fetchSchema, pullFilter, studentIdOf, type RosterRow } from "@/services/scenRosters";
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  type SavedSearch,
} from "@/services/studentDatabase";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Looking at the portal, without touching the record.
 *
 * A saved search answers "what does the portal say about X right now". It is deliberately
 * read-only: nothing here adds, removes or restatuses a student, because who is a student
 * is decided by the sync alone. Several searches can be open at once as tabs, so two
 * populations can be compared side by side without either becoming the roster.
 */
export function PortalViews() {
  const client = useQueryClient();
  const searches = useQuery({ queryKey: ["saved-searches"], queryFn: fetchSavedSearches });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });

  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [composing, setComposing] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);

  const saved = searches.data ?? [];
  const fields = schema.data?.fields ?? [];
  const open = openIds
    .map((id) => saved.find((search) => search.id === id))
    .filter((search): search is SavedSearch => Boolean(search));
  const active = open.find((search) => search.id === activeId) ?? open[0] ?? null;

  const save = useMutation({
    mutationFn: () => createSavedSearch({ name: name.trim(), filter: composing ?? {} }),
    onSuccess: (search) => {
      setComposing(null);
      setName("");
      setOpenIds((current) => [...new Set([...current, search.id])]);
      setActiveId(search.id);
      client.invalidateQueries({ queryKey: ["saved-searches"] });
    },
  });
  const remove = useMutation({
    mutationFn: (search: SavedSearch) => deleteSavedSearch(search.id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["saved-searches"] });
    },
  });

  const unopened = saved.filter((search) => !openIds.includes(search.id));

  return (
    <>
      <p className="rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-4 py-2.5 text-sm text-[#1f4e79]">
        <Eye size={14} className="mr-1.5 inline align-[-2px]" aria-hidden="true" />
        These views only look at the portal. They never add, remove or restatus a student — the
        Students list is built by the sync alone.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-[#e4e8ef] pb-2">
        {open.map((search) => (
          <span
            key={search.id}
            className={`inline-flex items-center rounded-t-md border-b-2 ${
              search.id === active?.id ? "border-[#1f4e79]" : "border-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveId(search.id)}
              className={`px-3 py-1.5 text-sm ${
                search.id === active?.id ? "font-semibold text-[#1f4e79]" : "text-[#667085]"
              }`}
            >
              {search.name}
            </button>
            <button
              type="button"
              aria-label={`Close ${search.name}`}
              onClick={() => setOpenIds((current) => current.filter((id) => id !== search.id))}
              className="pr-2 text-[#98a2b3] hover:text-[#344054]"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}

        {unopened.length ? (
          <div className="w-56">
            <SelectMenu
              label="Open a view"
              value=""
              placeholder="Open a saved view…"
              searchable={unopened.length > 12}
              options={unopened.map((search) => ({ value: search.id, label: search.name }))}
              onChange={(id) => {
                setOpenIds((current) => [...current, id]);
                setActiveId(id);
              }}
            />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setComposing({});
            setName("");
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-[#b7bec8] px-2.5 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Plus size={14} aria-hidden="true" /> New view
        </button>

        {active ? (
          <button
            type="button"
            aria-label={`Delete ${active.name}`}
            onClick={() => setPendingDelete(active)}
            className="ml-auto rounded-md p-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {active ? (
        <PortalView key={active.id} search={active} fields={fields} />
      ) : (
        <p className="mt-6 text-sm text-[#667085]">
          No view open. Open a saved one, or compose a new one to look at a slice of the portal.
        </p>
      )}

      <Modal
        open={composing !== null}
        title="New portal view"
        description="A saved search for looking at portal data. It is shared with every coordinator, and it never changes the student list."
        onClose={() => setComposing(null)}
        footer={
          <>
            <input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this view"
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
              disabled={!name.trim() || !composing || Object.keys(composing).length === 0 || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Save size={15} aria-hidden="true" /> Save view
            </button>
          </>
        }
      >
        {save.error ? (
          <p role="alert" className="mb-3 text-sm text-[#a6292f]">
            {(save.error as Error).message}
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
            ? `${pendingDelete.name} will be removed for every coordinator. No student is affected.`
            : ""
        }
        confirmLabel="Delete view"
        onConfirm={() => {
          if (pendingDelete) {
            remove.mutate(pendingDelete);
            setOpenIds((current) => current.filter((id) => id !== pendingDelete.id));
          }
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}

/** One open view: pull it on demand, show what came back, keep none of it. */
function PortalView({
  search,
  fields,
}: {
  search: SavedSearch;
  fields: Parameters<typeof describeFilter>[1];
}) {
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [showFilter, setShowFilter] = useState(false);

  const pull = useMutation({
    mutationFn: () =>
      pullFilter(search.filter as Filter, { name: search.name, expect: search.expectedCount ?? null }),
    onSuccess: (roster) => setRows(roster.rows),
  });

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pull.isPending}
          onClick={() => pull.mutate()}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] disabled:opacity-50"
        >
          {pull.isPending ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={15} aria-hidden="true" />
          )}
          {pull.isPending ? "Looking…" : rows ? "Look again" : "Look at the portal"}
        </button>
        <button
          type="button"
          onClick={() => setShowFilter(true)}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-[#667085] hover:bg-[#f8fafc]"
        >
          <SlidersHorizontal size={14} aria-hidden="true" /> What this view asks for
        </button>
        {rows ? <span className="text-sm text-[#667085]">{rows.length} returned</span> : null}
      </div>

      {pull.error ? (
        <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {(pull.error as Error).message}
        </p>
      ) : null}

      <section className="mt-3 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-[#667085]">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Student</th>
              <th scope="col" className="px-4 py-3 font-semibold">Id</th>
              <th scope="col" className="px-4 py-3 font-semibold">Year</th>
              <th scope="col" className="px-4 py-3 font-semibold">Major</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={studentIdOf(row)} className="border-t border-[#eef1f5]">
                <td className="px-4 py-2 font-semibold text-[#171717]">{displayNameOf(row)}</td>
                <td className="px-4 py-2 tabular-nums text-[#344054]">{studentIdOf(row)}</td>
                <td className="px-4 py-2 text-[#667085]">{String(row.YEARLEVEL_CODE ?? "—")}</td>
                <td className="px-4 py-2 text-[#667085]">{String(row.MAJOR_CODE_DESC ?? "—")}</td>
              </tr>
            ))}
            {!rows || rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-sm text-[#667085]">
                  {rows ? "The portal returned nobody for this view." : "Look at the portal to fill this view."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <Modal
        open={showFilter}
        title={search.name}
        description="What this view asks the portal for. Editing a view is not supported yet — make a new one instead."
        onClose={() => setShowFilter(false)}
      >
        <p className="text-sm text-[#344054]">{describeFilter(search.filter as Filter, fields)}</p>
      </Modal>
    </>
  );
}
