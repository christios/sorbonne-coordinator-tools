import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import type { Filter } from "@/services/filterSummary";
import { describeFilter } from "@/services/filterSummary";
import { fetchSchema } from "@/services/scenRosters";
import { fetchSyncSettings, saveSyncSettings } from "@/services/studentDatabase";

/**
 * What the roster's sync asks the portal for.
 *
 * This is the one setting that decides who counts as a student, so it is shared: every
 * coordinator's sync means the same thing, and "no longer in the portal" is a fact about
 * the same population however syncs.
 */
export function SyncSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ["sync-settings"], queryFn: fetchSyncSettings });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  const [draft, setDraft] = useState<Filter | null>(null);

  // Opening the dialog starts from what is saved, not from the last thing that was typed.
  useEffect(() => {
    if (open) setDraft(null);
  }, [open]);

  const fields = schema.data?.fields ?? [];
  const filter = draft ?? (settings.data?.filter as Filter) ?? {};

  const save = useMutation({
    mutationFn: () => saveSyncSettings(filter),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["sync-settings"] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title="Sync settings"
      description="Which students the portal should be asked for. Everything on the Students page is built from this, and it is shared with every coordinator."
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-[#98a2b3]">
            {Object.keys(filter).length === 0
              ? "Everyone the portal returns."
              : describeFilter(filter, fields)}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save for everyone"}
          </button>
        </>
      }
    >
      <p className="mb-3 rounded-md border border-[#cfe0ef] bg-[#f2f7fb] px-3 py-2 text-sm text-[#1f4e79]">
        Leave everything blank to sync every student the portal returns. Narrowing this means a
        student outside it will be marked as no longer in the portal, so narrow it only to a
        population you are willing to define that way.
      </p>

      {save.error ? (
        <p role="alert" className="mb-3 text-sm text-[#a6292f]">
          {(save.error as Error).message}
        </p>
      ) : null}

      <FilterBuilder
        fields={fields}
        filter={filter}
        trusted={schema.data?.source === "portal"}
        onChange={setDraft}
      />
    </Modal>
  );
}
