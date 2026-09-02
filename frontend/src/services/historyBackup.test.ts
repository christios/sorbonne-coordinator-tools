import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as browser from "@/services/browserStore";
import {
  backUpHistory,
  canWriteToFolder,
  chooseFolder,
  forgetFolder,
  restoreFrom,
} from "@/services/historyBackup";
import { forgetHistory, loadHistory, recordPull } from "@/services/pullHistory";

const VIEW = "view-1";
const row = (id: string, extra: Record<string, string> = {}) => ({
  SPRIDEN_ID: id,
  FULL_NAME: "Amira Haddad",
  ...extra,
});

/** A folder, as the File System Access API hands one over. */
function fakeFolder() {
  const files = new Map<string, string>();
  const handle = {
    name: "SCEN backups",
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (!files.has(fileName) && !options?.create) throw new Error("not found");
      return {
        createWritable: async () => ({
          write: async (text: string) => files.set(fileName, text),
          close: async () => {},
        }),
        getFile: async () => ({
          lastModified: 1_000,
          text: async () => files.get(fileName) ?? "",
        }),
      };
    },
  };
  return { handle, files };
}

/*
 * A real FileSystemDirectoryHandle survives structured clone and so can be kept in the
 * database; a stand-in carrying methods cannot. So the handle's key is held in memory for
 * these tests and every other key goes to the real store, which the history needs.
 */
const HANDLE_KEY = "scen-history-backup-folder";
let heldHandle: unknown = null;

beforeEach(async () => {
  window.localStorage.clear();
  await forgetHistory();
  heldHandle = null;

  const realRead = browser.read;
  const realWrite = browser.write;
  const realDrop = browser.drop;
  vi.spyOn(browser, "read").mockImplementation(async (key: string) =>
    key === HANDLE_KEY ? (heldHandle as never) : realRead(key),
  );
  vi.spyOn(browser, "write").mockImplementation(async (key: string, value: unknown) => {
    if (key !== HANDLE_KEY) return realWrite(key, value);
    heldHandle = value;
    return true;
  });
  vi.spyOn(browser, "drop").mockImplementation(async (key: string) => {
    if (key !== HANDLE_KEY) return realDrop(key);
    heldHandle = null;
  });

  await forgetFolder();
});
afterEach(() => vi.restoreAllMocks());

describe("keeping the history where a browser wipe cannot reach it", () => {
  it("writes nothing until a folder has been chosen", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    expect(await backUpHistory()).toEqual({ ok: false, reason: "no_folder" });
  });

  it("writes the whole history to the chosen folder", async () => {
    const { handle, files } = fakeFolder();
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => handle;
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" })], 2_000);

    await chooseFolder();
    const result = await backUpHistory();

    expect(result.ok).toBe(true);
    const written = JSON.parse(files.get("scen-pull-history.json") ?? "{}");
    expect(written.kind).toBe("scen-pull-history");
    expect(written.histories[VIEW].pulls).toHaveLength(2);
  });

  /*
   * The point of the whole thing: site data cleared, or a new machine, and the record of
   * what the portal said is still there.
   */
  it("rebuilds the history from the file after the browser is wiped", async () => {
    const { handle, files } = fakeFolder();
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = async () => handle;
    await recordPull(VIEW, [row("A001")], 1_000);
    await recordPull(VIEW, [row("A001", { YEARLEVEL_CODE: "L1" })], 2_000);
    await chooseFolder();
    await backUpHistory();

    // Everything this browser held, gone.
    await forgetHistory();
    expect((await loadHistory(VIEW)).pulls).toEqual([]);

    const restored = await restoreFrom(files.get("scen-pull-history.json") ?? "");

    expect(restored).toEqual({ ok: true, views: 1 });
    expect((await loadHistory(VIEW)).pulls).toHaveLength(2);
  });

  it("refuses a file that is not one of ours, rather than half-reading it", async () => {
    await recordPull(VIEW, [row("A001")], 1_000);

    expect(await restoreFrom(JSON.stringify({ some: "other file" }))).toEqual({
      ok: false,
      reason: "not_a_backup",
    });
    // Untouched.
    expect((await loadHistory(VIEW)).pulls).toHaveLength(1);
  });

  it("says so plainly when the file will not parse", async () => {
    expect(await restoreFrom("not json at all")).toEqual({ ok: false, reason: "unreadable" });
  });

  it("does not write when the folder's permission has lapsed", async () => {
    const { handle } = fakeFolder();
    handle.queryPermission = async () => "prompt";
    await browser.write(HANDLE_KEY, handle);

    expect(await backUpHistory()).toEqual({ ok: false, reason: "no_permission" });
  });

  it("reports a folder that cannot be written to, rather than claiming success", async () => {
    const { handle } = fakeFolder();
    handle.getFileHandle = async () => {
      throw new Error("disk full");
    };
    await browser.write(HANDLE_KEY, handle);

    expect(await backUpHistory()).toEqual({ ok: false, reason: "failed" });
  });

  it("knows when this browser cannot write to a folder at all", () => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;

    expect(canWriteToFolder()).toBe(false);
  });
});
