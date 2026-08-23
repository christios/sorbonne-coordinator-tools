import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { FilterBuilder } from "@/components/FilterBuilder";
import { Modal } from "@/components/Modal";
import { useStaffUser } from "@/components/useStaffUser";
import type { Filter } from "@/services/filterSummary";
import { describeFilter } from "@/services/filterSummary";
import { fetchSchema } from "@/services/scenRosters";
import {
  fetchSyncSettings,
  saveSyncSettings,
  setSyncPassphrase,
  unlockSyncSettings,
} from "@/services/studentDatabase";

/**
 * What the roster's sync asks the portal for.
 *
 * This is the one setting that decides who counts as a student, so it is shared: every
 * coordinator's sync means the same thing, and "no longer in the portal" is a fact about
 * the same population however syncs.
 */
export function SyncSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const user = useStaffUser();
  const settings = useQuery({ queryKey: ["sync-settings"], queryFn: fetchSyncSettings });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  const [draft, setDraft] = useState<Filter | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [opened, setOpened] = useState(false);
  const [newPassphrase, setNewPassphrase] = useState("");
  const [changingLock, setChangingLock] = useState(false);

  // Opening the dialog starts from what is saved, not from the last thing that was typed,
  // and the passphrase has to be given again — an unlocked dialog left open is not a key.
  useEffect(() => {
    if (!open) return;
    setDraft(null);
    setPassphrase("");
    setOpened(false);
    setNewPassphrase("");
    setChangingLock(false);
  }, [open]);

  const fields = schema.data?.fields ?? [];
  const filter = draft ?? (settings.data?.filter as Filter) ?? {};
  const isAdmin = Boolean(user?.isAdmin);
  const locked = Boolean(settings.data?.locked) && !isAdmin && !opened;

  const unlock = useMutation({
    mutationFn: () => unlockSyncSettings(passphrase),
    onSuccess: () => setOpened(true),
  });

  const relock = useMutation({
    mutationFn: () => setSyncPassphrase(newPassphrase),
    onSuccess: () => {
      setChangingLock(false);
      setNewPassphrase("");
      client.invalidateQueries({ queryKey: ["sync-settings"] });
    },
  });

  const save = useMutation({
    mutationFn: () => saveSyncSettings(filter, passphrase),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["sync-settings"] });
      onClose();
    },
  });

  if (locked) {
    return (
      <Modal
        open={open}
        title="Sync settings are locked"
        description="An administrator has put a passphrase on the population the sync asks for."
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!passphrase || unlock.isPending}
              onClick={() => unlock.mutate()}
              className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {unlock.isPending ? "Checking…" : "Unlock"}
            </button>
          </>
        }
      >
        <label className="block text-sm font-semibold text-[#344054]" htmlFor="sync-passphrase">
          Passphrase
        </label>
        <input
          id="sync-passphrase"
          type="password"
          autoFocus
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && passphrase) unlock.mutate();
          }}
          className="mt-1 w-full max-w-sm rounded-md border border-[#b7bec8] px-3 py-2 text-sm"
        />
        {unlock.error ? (
          <p role="alert" className="mt-2 text-sm text-[#a6292f]">
            {(unlock.error as Error).message}
          </p>
        ) : null}
      </Modal>
    );
  }

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

      {isAdmin ? (
        <div className="mb-3 rounded-md border border-[#e4e8ef] bg-[#f8fafc] px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-[#344054]">
              {settings.data?.locked ? "Locked with a passphrase" : "Not locked"}
            </span>
            <span className="text-xs text-[#667085]">
              {settings.data?.locked
                ? "Anybody who is not an administrator needs the passphrase to change these settings."
                : "Anybody signed in can change these settings."}
            </span>
            <button
              type="button"
              onClick={() => setChangingLock((current) => !current)}
              className="ml-auto text-sm text-[#1f4e79] underline"
            >
              {settings.data?.locked ? "Change or remove" : "Set a passphrase"}
            </button>
          </div>

          {changingLock ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="password"
                aria-label="New sync passphrase"
                value={newPassphrase}
                onChange={(event) => setNewPassphrase(event.target.value)}
                placeholder="Leave blank to remove the lock"
                className="w-64 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={relock.isPending}
                onClick={() => relock.mutate()}
                className="rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-sm font-semibold text-[#344054] disabled:opacity-50"
              >
                {relock.isPending ? "Saving…" : newPassphrase.trim() ? "Set passphrase" : "Remove lock"}
              </button>
              {relock.error ? (
                <span role="alert" className="text-sm text-[#a6292f]">
                  {(relock.error as Error).message}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
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
