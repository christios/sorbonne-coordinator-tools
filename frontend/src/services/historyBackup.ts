/**
 * A copy of the diff history that outlives this browser.
 *
 * The history of what the portal has said — who changed, field by field, pull by pull —
 * exists only in this browser, because the server is never told a student's name. That
 * makes it the one thing here that cannot be rebuilt: ids, cohorts and who was returned
 * when all live on the server, but "their major changed on the 14th" does not. Clearing
 * "Cookies and other site data" takes it, and so does a new machine.
 *
 * So it is written to a folder the coordinator chooses, after every sync, and can be read
 * back in. The folder handle is kept in the same database as everything else, which means
 * a wipe loses the *link* to the folder rather than the files in it — re-pick it once and
 * the record is still there.
 *
 * What is written is personal data: names, university e-mail addresses, majors. The
 * coordinator is told so before choosing where it goes, because a folder that syncs to
 * iCloud or OneDrive should be a decision rather than an accident.
 */

import * as browser from "@/services/browserStore";
import { historyForBackup, restoreHistories, type HistoryBackup } from "@/services/pullHistory";

const HANDLE_KEY = "scen-history-backup-folder";
const FILENAME_KEY = "scen-history-backup-filename";
export const DEFAULT_FILENAME = "scen-pull-history.json";

/**
 * A name the file system will accept, or null when there is nothing usable in it.
 *
 * A folder separator would mean writing somewhere other than the folder that was granted,
 * which is not ours to do; the rest is tidying. The extension is added rather than
 * demanded, because a coordinator naming a file should not have to think about it, and a
 * file called `.json` is a hidden file rather than a backup.
 */
export function cleanFilename(input: string): string | null {
  // eslint-disable-next-line no-control-regex
  const trimmed = input.replace(/[\u0000-\u001f]/g, "").trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return null;
  if (/[/\\]/.test(trimmed)) return null;
  const named = trimmed.length > 100 ? trimmed.slice(0, 100) : trimmed;
  const withExtension = named.toLowerCase().endsWith(".json") ? named : `${named}.json`;
  return withExtension === ".json" ? null : withExtension;
}

/** The name to write under. The default until somebody chooses otherwise. */
export async function backupFilename(): Promise<string> {
  return (await browser.read<string>(FILENAME_KEY)) || DEFAULT_FILENAME;
}

/** Returns the name actually stored, so the caller can show what it settled on. */
export async function setBackupFilename(input: string): Promise<string | null> {
  const named = cleanFilename(input);
  if (!named) return null;
  await browser.write(FILENAME_KEY, named);
  return named;
}

/** Chrome and Edge have it; Safari and Firefox do not. */
export function canWriteToFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

type Handle = FileSystemDirectoryHandle;

export async function chosenFolder(): Promise<Handle | null> {
  return browser.read<Handle>(HANDLE_KEY);
}

/** Ask for a folder. Returns null when the picker is dismissed. */
export async function chooseFolder(): Promise<Handle | null> {
  if (!canWriteToFolder()) return null;
  let handle: Handle;
  try {
    handle = await (window as unknown as {
      showDirectoryPicker: (options?: { mode?: string }) => Promise<Handle>;
    }).showDirectoryPicker({ mode: "readwrite" });
  } catch {
    // Dismissed, or refused. Not an error worth surfacing as one.
    return null;
  }
  await browser.write(HANDLE_KEY, handle);
  return handle;
}

export async function forgetFolder(): Promise<void> {
  await browser.drop(HANDLE_KEY);
}

type Permission = "granted" | "denied" | "prompt";

/**
 * Whether we may still write there.
 *
 * Chrome remembers the folder but not always the permission, so a new session can need
 * one click to re-grant. `ask: false` is for checking quietly on load — asking without a
 * click behind it is refused anyway.
 */
export async function folderPermission(handle: Handle, ask: boolean): Promise<Permission> {
  const options = { mode: "readwrite" } as const;
  const withPermission = handle as Handle & {
    queryPermission?: (o: typeof options) => Promise<Permission>;
    requestPermission?: (o: typeof options) => Promise<Permission>;
  };
  try {
    const current = (await withPermission.queryPermission?.(options)) ?? "granted";
    if (current === "granted" || !ask) return current;
    return (await withPermission.requestPermission?.(options)) ?? "denied";
  } catch {
    return "denied";
  }
}

export type BackupOutcome =
  | { ok: true; savedAt: number }
  | { ok: false; reason: "no_folder" | "no_permission" | "failed" };

/**
 * Write the whole history out.
 *
 * A whole snapshot rather than an append: the file stays one readable thing, and a
 * restore does not depend on every earlier write having survived. It is a few hundred
 * kilobytes, written once per sync.
 */
export async function backUpHistory(): Promise<BackupOutcome> {
  const handle = await chosenFolder();
  if (!handle) return { ok: false, reason: "no_folder" };
  if ((await folderPermission(handle, false)) !== "granted") return { ok: false, reason: "no_permission" };

  const payload: HistoryBackup = {
    kind: "scen-pull-history",
    version: 1,
    savedAt: Date.now(),
    histories: await historyForBackup(),
  };
  try {
    const file = await handle.getFileHandle(await backupFilename(), { create: true });
    // createWritable writes to a swap file and moves it into place on close, so a failure
    // part-way through leaves the previous backup rather than half of this one.
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 1));
    await writable.close();
    return { ok: true, savedAt: payload.savedAt };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** When the folder already holds a backup, so the panel can say what is in there. */
export async function backupWrittenAt(): Promise<number | null> {
  const handle = await chosenFolder();
  if (!handle || (await folderPermission(handle, false)) !== "granted") return null;
  try {
    const file = await handle.getFileHandle(await backupFilename());
    return (await file.getFile()).lastModified;
  } catch {
    return null;
  }
}

export type RestoreOutcome =
  | { ok: true; views: number }
  | { ok: false; reason: "not_a_backup" | "unreadable" };

/** Read a backup file back in, merged with whatever this browser already holds. */
export async function restoreFrom(text: string): Promise<RestoreOutcome> {
  let payload: Partial<HistoryBackup>;
  try {
    payload = JSON.parse(text) as Partial<HistoryBackup>;
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  // Named rather than sniffed: restoring the wrong file should say so, not half-work.
  if (payload?.kind !== "scen-pull-history" || !payload.histories) {
    return { ok: false, reason: "not_a_backup" };
  }
  await restoreHistories(payload.histories);
  return { ok: true, views: Object.keys(payload.histories).length };
}
