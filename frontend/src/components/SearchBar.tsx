import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { describeFilter, type Filter } from "@/services/filterSummary";
import { describeAge, type StoredPreset } from "@/services/rosterStore";
import { fetchSchema, listPresets } from "@/services/scenRosters";
import {
  createSavedSearch,
  deleteSavedSearch,
  fetchSavedSearches,
  updateSavedSearch,
  type SavedSearch,
} from "@/services/studentDatabase";

/**
 * Syncing the student record with the portal.
 *
 * The ordinary act is one button: pull everyone and reconcile. A saved search narrows the
 * pull when that is what you want, and because a narrow pull is not a census it can add
 * and refresh students but never mark anybody as gone.
 *
 * Composing a search needs room — nineteen fields, some with long code tables — so it
 * happens in a dialog rather than pushing the table down the page.
 */
export function SearchBar({
  stored,
  onPull,
  pulling,
  onForget,
}: {
  stored: StoredPreset;
  onPull: (filter: Filter, meta: { name: string; expect: number | null; full: boolean }) => void;
  pulling: boolean;
  onForget: () => void;
}) {
  const client = useQueryClient();
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  const searches = useQuery({ queryKey: ["saved-searches"], queryFn: fetchSavedSearches });

  const [chosenId, setChosenId] = useState("");
  // What is being edited, and what is in use. Closing the dialog keeps the work: it is a
  // filter editor, not a form, and there is nothing destructive to undo.
  const [draft, setDraft] = useState<Filter | null>(null);
  const [applied, setApplied] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);

  const saved = searches.data ?? [];
  const chosen = saved.find((search) => search.id === chosenId) ?? null;
  const fields = schema.data?.fields ?? [];
  const filter = draft ?? applied ?? chosen?.filter ?? {};
  const editing = draft !== null;

  const refresh = () => client.invalidateQueries({ queryKey: ["saved-searches"] });
  const save = useMutation({
    mutationFn: () =>
      chosen && chosen.name === name.trim()
        ? updateSavedSearch(chosen.id, { name: name.trim(), filter })
        : createSavedSearch({ name: name.trim(), filter }),
    onSuccess: (search) => {
      setChosenId(search.id);
      setDraft(null);
      setApplied(null);
      setName("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (search: SavedSearch) => deleteSavedSearch(search.id),
    onSuccess: () => {
      setChosenId("");
      refresh();
    },
  });
  const importPresets = useMutation({
    mutationFn: async () => {
      const existing = new Set(saved.map((search) => search.name));
      const presets = (await listPresets()).filter(
        (preset) => preset.filter && !existing.has(preset.name),
      );
      for (const preset of presets) {
        await createSavedSearch({
          name: preset.name,
          filter: preset.filter as Filter,
          expectedCount: preset.expect ?? 0,
        });
      }
      return presets.length;
    },
    onSuccess: refresh,
  });

  /** Take the composed filter into use and close the dialog. */
  const keep = () => {
    setApplied(draft);
    setDraft(null);
  };

  const current = stored.current;
  const empty = Object.keys(filter).length === 0;
  const error = save.error ?? remove.error ?? importPresets.error ?? searches.error;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64">
          <SelectMenu
            label="Search"
            value={chosenId}
            placeholder={saved.length ? "Choose a saved search…" : "No saved searches yet"}
            searchable={saved.length > 12}
            options={saved.map((search) => ({ value: search.id, label: search.name }))}
            onChange={(id) => {
              setChosenId(id);
              setDraft(null);
              setApplied(null);
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setDraft({ ...filter });
            setName(chosen?.name ?? "");
          }}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <SlidersHorizontal size={15} aria-hidden="true" /> Filters
        </button>

        <button
          type="button"
          disabled={pulling}
          onClick={() =>
            onPull(filter, {
              name: empty ? "Everyone" : (chosen?.name ?? describeFilter(filter, fields)),
              expect: chosen?.expectedCount ?? null,
              // Only a pull with nothing filtering it is a census of the whole population,
              // and only a census may decide that somebody is no longer in the portal.
              full: empty,
            })
          }
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pulling ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={16} aria-hidden="true" />
          )}
          {pulling ? "Syncing…" : empty ? "Sync all students" : "Sync this search"}
        </button>

        {chosen ? (
          <button
            type="button"
            aria-label={`Delete ${chosen.name}`}
            title={`Delete ${chosen.name}`}
            onClick={() => setPendingDelete(chosen)}
            className="rounded-md p-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-[#98a2b3]">
        {empty
          ? "Everyone the portal returns. A full sync is what decides who has left."
          : `${describeFilter(filter, fields)} · a narrowed sync adds and refreshes, but marks nobody as gone`}
        {current ? (
          <>
            {` · ${current.count} pulled ${describeAge(current.fetchedAt)}${
              stored.previous ? `, compared with ${describeAge(stored.previous.fetchedAt)}` : ""
            }. `}
            <button type="button" onClick={onForget} className="underline">
              Forget stored rosters
            </button>
          </>
        ) : (
          " · no names held in this browser yet"
        )}
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">
          {(error as Error).message}
        </p>
      ) : null}

      <Modal
        open={editing}
        title="Filters"
        description="Pick the students the portal should return. A saved search is shared with every coordinator."
        onClose={keep}
        footer={
          <>
            {saved.length === 0 ? (
              <button
                type="button"
                onClick={() => importPresets.mutate()}
                disabled={importPresets.isPending}
                className="mr-auto text-sm text-[#1f4e79] underline"
              >
                {importPresets.isPending ? "Importing…" : "Import the extension's presets"}
              </button>
            ) : null}
            <input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this search"
              className="w-56 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={keep}
              className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]"
            >
              Done
            </button>
            <button
              type="button"
              disabled={!name.trim() || empty || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Save size={15} aria-hidden="true" />
              {chosen && chosen.name === name.trim() ? "Save changes" : "Save for everyone"}
            </button>
          </>
        }
      >
        {schema.data && !schema.data.ok ? (
          <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {schema.data.error}
          </p>
        ) : schema.data?.source === "built-in" ? (
          <p className="mb-3 rounded-md border border-[#f0e0b8] bg-[#fffaf0] px-3 py-2 text-sm text-[#8a6d00]">
            These codes are the extension's built-in list. Open the portal's Student Search page once
            and they are replaced by the portal's own.
          </p>
        ) : null}

        <FilterBuilder
          fields={fields}
          filter={filter}
          trusted={schema.data?.source === "portal"}
          onChange={setDraft}
        />
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this saved search?"
        description={
          pendingDelete
            ? `${pendingDelete.name} will be removed for every coordinator, not just for you.`
            : ""
        }
        confirmLabel="Delete search"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
