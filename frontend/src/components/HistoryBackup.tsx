import { AlertTriangle, Check, FolderOpen, HardDriveDownload, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Modal } from "@/components/Modal";
import {
  backUpHistory,
  backupWrittenAt,
  canWriteToFolder,
  chooseFolder,
  chosenFolder,
  folderPermission,
  forgetFolder,
  restoreFrom,
  setBackupFilename,
  backupFilename,
  DEFAULT_FILENAME,
} from "@/services/historyBackup";
import { describeAge } from "@/services/rosterStore";

/**
 * Keeping the diff history somewhere it survives this browser.
 *
 * Everything else here can be rebuilt: ids and cohorts are the server's, and names come
 * back with a sync. What the portal said last month, and what changed since, exists in
 * this browser alone — so clearing site data ends it. This writes it to a folder after
 * every sync and reads it back when there is nothing to read.
 */
export function HistoryBackup({ onRestored }: { onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt" | null>(null);
  const [writtenAt, setWrittenAt] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [filename, setFilename] = useState(DEFAULT_FILENAME);
  const [badName, setBadName] = useState(false);
  const [said, setSaid] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const look = async () => {
    const handle = await chosenFolder();
    setFolder(handle?.name ?? null);
    setPermission(handle ? await folderPermission(handle, false) : null);
    setWrittenAt(await backupWrittenAt());
    setFilename(await backupFilename());
  };

  useEffect(() => {
    if (open) void look();
  }, [open]);

  const pick = async () => {
    setBusy("picking");
    const handle = await chooseFolder();
    setBusy("");
    if (!handle) return;
    await look();
    // Write immediately: a folder chosen and then left empty until the next sync looks
    // like it did not work.
    await save();
  };

  const save = async () => {
    setBusy("saving");
    const result = await backUpHistory();
    setBusy("");
    setSaid(
      result.ok
        ? "Saved."
        : result.reason === "no_permission"
          ? "Chrome needs you to allow the folder again."
          : result.reason === "no_folder"
            ? "Choose a folder first."
            : "That folder could not be written to.",
    );
    await look();
  };

  const regrant = async () => {
    const handle = await chosenFolder();
    if (!handle) return;
    await folderPermission(handle, true);
    await look();
  };

  const restore = async (chosen: File) => {
    setBusy("restoring");
    const result = await restoreFrom(await chosen.text());
    setBusy("");
    setSaid(
      result.ok
        ? `Restored ${result.views} portal filter${result.views === 1 ? "" : "'s"} history.`
        : result.reason === "not_a_backup"
          ? "That is not a history backup file."
          : "That file could not be read.",
    );
    if (result.ok) onRestored();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[#1f4e79] underline"
      >
        Back up the history
      </button>

      <Modal
        open={open}
        title="Keep a copy of the history"
        description="What the portal has said, pull by pull, lives in this browser alone — the server is never told a student's name. Clearing site data ends it, and so does a new machine. This keeps a copy in a folder of your choosing."
        onClose={() => {
          setOpen(false);
          setSaid("");
        }}
      >
        <div className="flex items-start gap-2 rounded-md border border-[#f0d8a8] bg-[#fdf8ef] px-3 py-2 text-sm text-[#7a5b16]">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            The file holds student names, university e-mail addresses and majors — that is
            what the history is. A folder that syncs to iCloud, OneDrive or Google Drive
            will copy it off this machine.
          </p>
        </div>

        {canWriteToFolder() ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-[#344054]">Folder</p>
            {folder ? (
              <p className="mt-1 text-sm text-[#344054]">
                <span className="font-medium">{folder}</span>
                <span className="text-[#98a2b3]">
                  {" "}
                  · {filename}
                  {writtenAt ? ` · saved ${describeAge(writtenAt)}` : " · nothing written yet"}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-[#98a2b3]">No folder chosen, so nothing is being kept.</p>
            )}

            {folder && permission !== "granted" ? (
              <p className="mt-2 text-sm text-[#a6292f]">
                Chrome has not kept permission for this folder this session.{" "}
                <button type="button" onClick={regrant} className="underline">
                  Allow it again
                </button>
                .
              </p>
            ) : null}

            <label className="mt-3 block">
              <span className="text-sm font-medium text-[#344054]">File name</span>
              <input
                aria-label="Backup file name"
                value={filename}
                onChange={(event) => {
                  setFilename(event.target.value);
                  setBadName(false);
                }}
                onBlur={async (event) => {
                  const settled = await setBackupFilename(event.target.value);
                  if (!settled) return setBadName(true);
                  // Shown as it was stored: .json added, spaces trimmed.
                  setFilename(settled);
                  await look();
                }}
                className="mt-1 w-full rounded border border-[#cbd5e1] px-2 py-1.5 text-sm"
              />
            </label>
            {badName ? (
              <p role="alert" className="mt-1 text-sm text-[#a6292f]">
                That is not a name a file can have. Leave out slashes — the file goes in
                the folder above.
              </p>
            ) : (
              <p className="mt-1 text-xs text-[#98a2b3]">
                Renaming writes to the new name from the next save. Anything written under
                the old name stays in the folder — take it away yourself if you do not
                want it.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={pick}
                disabled={Boolean(busy)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
              >
                <FolderOpen size={15} aria-hidden="true" />
                {folder ? "Choose a different folder" : "Choose a folder"}
              </button>
              {folder ? (
                <>
                  <button
                    type="button"
                    onClick={save}
                    disabled={Boolean(busy)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
                  >
                    <HardDriveDownload size={15} aria-hidden="true" />
                    {busy === "saving" ? "Saving…" : "Save now"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await forgetFolder();
                      await look();
                    }}
                    className="rounded-md px-2 py-1.5 text-sm text-[#667085] underline"
                  >
                    Stop keeping a copy
                  </button>
                </>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-[#98a2b3]">
              Once a folder is chosen the copy is rewritten after every sync, without asking.
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm text-[#667085]">
            This browser cannot write to a folder. Chrome and Edge can — and the portal
            extension already needs Chrome. You can still restore from a file below.
          </p>
        )}

        <div className="mt-5 border-t border-[#eef1f5] pt-4">
          <p className="text-sm font-medium text-[#344054]">Restore</p>
          <p className="mt-1 text-sm text-[#667085]">
            Reads a saved file back in, alongside whatever this browser already has. Pulls
            it already knows are left alone, so restoring twice changes nothing.
          </p>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen) void restore(chosen);
            }}
          />
          <button
            type="button"
            onClick={() => file.current?.click()}
            disabled={Boolean(busy)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            <RotateCcw size={15} aria-hidden="true" />
            {busy === "restoring" ? "Restoring…" : "Restore from a file"}
          </button>
        </div>

        {said ? (
          <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-[#344054]">
            <Check size={14} className="text-[#256237]" aria-hidden="true" />
            {said}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
