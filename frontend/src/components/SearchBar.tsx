import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FilterBuilder } from "@/components/FilterBuilder";
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
 * Choosing, composing and saving a registrar search.
 *
 * A search is a set of portal codes. Saved ones live in our database and are shared, so
 * a search written once is everybody's; the extension checks whatever is composed here
 * against the portal's own schema before it asks for anything.
 */
export function SearchBar({
  stored,
  onPull,
  pulling,
  onForget,
}: {
  stored: StoredPreset;
  onPull: (filter: Filter, meta: { name: string; expect: number | null }) => void;
  pulling: boolean;
  onForget: () => void;
}) {
  const client = useQueryClient();
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  const searches = useQuery({ queryKey: ["saved-searches"], queryFn: fetchSavedSearches });

  const [chosenId, setChosenId] = useState("");
  const [draft, setDraft] = useState<Filter | null>(null);
  const [name, setName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null);

  const saved = searches.data ?? [];
  const chosen = saved.find((search) => search.id === chosenId) ?? null;
  const fields = schema.data?.fields ?? [];
  const filter = draft ?? chosen?.filter ?? {};
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
      const presets = await listPresets();
      const importable = presets.filter((preset) => preset.filter);
      const existing = new Set(saved.map((search) => search.name));
      let added = 0;
      for (const preset of importable) {
        if (existing.has(preset.name)) continue;
        await createSavedSearch({
          name: preset.name,
          filter: preset.filter as Filter,
          expectedCount: preset.expect ?? 0,
        });
        added += 1;
      }
      return added;
    },
    onSuccess: refresh,
  });

  const current = stored.current;
  const empty = Object.keys(filter).length === 0;
  const error = save.error ?? remove.error ?? importPresets.error ?? searches.error;

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-[#344054]">
          Search
          <select
            value={chosenId}
            onChange={(event) => {
              setChosenId(event.target.value);
              setDraft(null);
            }}
            className="ml-2 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          >
            <option value="">Choose a saved search…</option>
            {saved.map((search) => (
              <option key={search.id} value={search.id}>
                {search.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setDraft(editing ? null : { ...filter })}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f8fafc]"
        >
          <Pencil size={15} aria-hidden="true" /> {editing ? "Done editing" : "Edit filters"}
        </button>

        <button
          type="button"
          disabled={pulling || empty}
          onClick={() =>
            onPull(filter, { name: chosen?.name ?? describeFilter(filter, fields), expect: chosen?.expectedCount ?? null })
          }
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pulling ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Download size={16} aria-hidden="true" />
          )}
          {pulling ? "Pulling…" : current ? "Pull again" : "Pull from portal"}
        </button>

        {chosen ? (
          <button
            type="button"
            aria-label={`Delete ${chosen.name}`}
            onClick={() => setPendingDelete(chosen)}
            className="rounded-md p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        ) : null}

        {saved.length === 0 ? (
          <button
            type="button"
            onClick={() => importPresets.mutate()}
            disabled={importPresets.isPending}
            className="ml-auto text-sm text-[#1f4e79] underline"
          >
            {importPresets.isPending ? "Importing…" : "Import the extension's presets"}
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-[#667085]">
        <span className="font-medium text-[#344054]">{describeFilter(filter, fields)}</span>
        {current ? (
          <>
            {` · ${current.count} students pulled ${describeAge(current.fetchedAt)}${
              stored.previous ? `, compared with ${describeAge(stored.previous.fetchedAt)}` : ""
            }. `}
            <button type="button" onClick={onForget} className="underline">
              Forget stored rosters
            </button>
          </>
        ) : (
          " · nothing pulled yet on this machine"
        )}
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
          {(error as Error).message}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <FilterBuilder
            fields={fields}
            filter={filter}
            trusted={schema.data?.source === "portal"}
            onChange={setDraft}
          />

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-sm font-semibold text-[#344054]">
              Save as
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={chosen?.name ?? "SCEN — First Year (active)"}
                className="ml-2 w-64 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
            </label>
            <button
              type="button"
              disabled={!name.trim() || empty || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Save size={15} aria-hidden="true" /> Save for everyone
            </button>
            {chosen ? (
              <button
                type="button"
                onClick={() => setName(chosen.name)}
                className="text-sm text-[#667085] underline"
              >
                Overwrite {chosen.name}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {schema.data && schema.data.source === "built-in" ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[#8a6d00]">
          <AlertTriangle size={12} aria-hidden="true" />
          These codes were written by hand and only partly confirmed — type any the list is
          missing. Visiting the portal once replaces them with its own.
        </p>
      ) : schema.data?.source === "portal" ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-[#98a2b3]">
          <Check size={12} aria-hidden="true" /> Filters read from the portal itself.
        </p>
      ) : null}

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
    </section>
  );
}
