/**
 * The last two pulls, kept in this browser and nowhere else.
 *
 * Why store them at all: a roster that vanishes when you change page is useless, and
 * "who changed since last time" cannot be answered without something to compare against.
 * Neither can be solved on our side, because the server is never told a student's name.
 *
 * The student list itself is the server's and is not affected by any of this: clearing
 * only takes away the names, not the students.
 *
 * What this means, plainly: names, university e-mail addresses and year levels sit in
 * this browser's local storage until they are cleared. They are cleared on sign-out, and
 * by the "Forget stored rosters" button on the Students page. They are not sent anywhere,
 * they are per-machine, and a colleague's browser knows nothing about them.
 */

import * as browser from "@/services/browserStore";
import { allLatest } from "@/services/pullHistory";
import { displayNameOf, studentIdOf, type PortalRoster, type RosterRow } from "@/services/scenRosters";

// v2 packs the rows: the field names are written once per pull instead of once per
// student. See pack(). v1 is read for as long as it is still there, then replaced.
const KEY = "scen-rosters:v2";
const OLD_KEY = "scen-rosters:v1";
// Which view was last pulled. Nothing reads it any more — the view on screen decides
// which pull to show — but it is still written, and still cleared, so an upgrade back and
// forth does not strand it.
const LAST = "scen-rosters:last";
// When each view was last reconciled with the portal, which is what "new" is measured
// from. Per view: syncing one view says nothing about who is new to another, and a single
// shared moment meant only the view synced last ever showed a new student.
const SYNCED = "scen-rosters:synced:v2";

export type StoredPull = {
  presetId: string;
  name: string;
  count: number;
  fetchedAt: number;
  rows: RosterRow[];
};

/** The pull being looked at, and the one before it, which is what "changed" compares to. */
export type StoredPreset = { current?: StoredPull; previous?: StoredPull };

type Store = Record<string, StoredPreset>;

/**
 * A pull with its field names written once.
 *
 * A portal row carries between fifteen and thirty-nine fields, and the names are more
 * than half of it — `MAJOR_CODE_DESC` is longer than most of the values it labels. Stored
 * as objects, a whole term spends over a megabyte repeating the same thirty-four words
 * 2876 times, and the browser's five-megabyte quota is not big enough for that on top of
 * every other view a coordinator has synced. The first term is 2876 students, so this is
 * the difference between the names being kept and the table having none.
 *
 * `values` is aligned to `fields`; a field a row does not have is null, which is not the
 * same as an empty string and unpacks back to absent.
 */
type PackedPull = {
  presetId: string;
  name: string;
  count: number;
  fetchedAt: number;
  fields: string[];
  values: (string | number | boolean | null)[][];
};

type PackedPreset = { current?: PackedPull; previous?: PackedPull };
type PackedStore = Record<string, PackedPreset>;

function pack(pull: StoredPull): PackedPull {
  // Every field any row has, in first-seen order: the portal's own column order, which
  // is stable across a pull and reads sensibly if anyone ever looks at the raw store.
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of pull.rows) {
    for (const field of Object.keys(row)) {
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
    }
  }
  return {
    presetId: pull.presetId,
    name: pull.name,
    count: pull.count,
    fetchedAt: pull.fetchedAt,
    fields,
    values: pull.rows.map((row) => fields.map((field) => (field in row ? (row[field] ?? null) : null))),
  };
}

function unpack(pull: PackedPull): StoredPull {
  const { fields, values } = pull;
  return {
    presetId: pull.presetId,
    name: pull.name,
    count: pull.count,
    fetchedAt: pull.fetchedAt,
    rows: values.map((row) => {
      const out: RosterRow = {};
      fields.forEach((field, index) => {
        const value = row[index];
        if (value !== null && value !== undefined) out[field] = value as RosterRow[string];
      });
      return out;
    }),
  };
}

/** A pull written before packing existed, which is a plain `StoredPull`. */
function isPacked(pull: unknown): pull is PackedPull {
  return Boolean(pull && Array.isArray((pull as PackedPull).fields));
}

async function readPacked(): Promise<PackedStore> {
  const held = await browser.read<PackedStore>(KEY);
  if (held) return held;

  /*
   * Nothing in the database yet. Carry over whatever localStorage still holds — a v2
   * store written before the move, or a v1 one written before the rows were packed —
   * rather than making a coordinator re-sync every view they have. The names are only in
   * this browser, so losing them costs a trip to the portal for each one.
   */
  const packed = readLocal<PackedStore>(KEY);
  if (packed) {
    if (await browser.write(KEY, packed)) dropLocal(KEY);
    return packed;
  }

  const old = readLocal<Store>(OLD_KEY);
  if (!old) return {};
  const migrated: PackedStore = {};
  for (const [id, preset] of Object.entries(old)) {
    migrated[id] = {
      current: preset.current ? pack(preset.current) : undefined,
      previous: preset.previous ? pack(preset.previous) : undefined,
    };
  }
  // Only drop the old copy once the new one is safely down. If the write is refused
  // there is nothing to gain by having deleted the only copy.
  if (await browser.write(KEY, migrated)) dropLocal(OLD_KEY);
  return migrated;
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Private browsing, or something that is not ours: behave as if empty.
    return null;
  }
}

function dropLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // What cannot be removed could not have been written.
  }
}

async function read(): Promise<Store> {
  const packed = await readPacked();
  const store: Store = {};
  for (const [id, preset] of Object.entries(packed)) {
    store[id] = {
      current: preset.current
        ? isPacked(preset.current)
          ? unpack(preset.current)
          : (preset.current as unknown as StoredPull)
        : undefined,
      previous: preset.previous
        ? isPacked(preset.previous)
          ? unpack(preset.previous)
          : (preset.previous as unknown as StoredPull)
        : undefined,
    };
  }
  return store;
}

/**
 * Whether the last pull actually reached storage, and what was dropped to make it fit.
 *
 * The names are read back from storage rather than held in memory, so a write that fails
 * is not a degraded page — it is a table of students with no names in it. That has to be
 * sayable.
 */
export type StorageReport = { stored: boolean; shed: string[] };

let lastReport: StorageReport = { stored: true, shed: [] };

/** How the last `rememberPull` went. Reset by a later pull, not by reading it. */
export function storageReport(): StorageReport {
  return lastReport;
}

/** True if it went in. False means the quota refused it, or storage is unavailable. */
function write(store: PackedStore): Promise<boolean> {
  return browser.write(KEY, store);
}

/**
 * The order things are given up in when a term will not fit.
 *
 * A browser allows an origin about five megabytes. A view holding a whole term is over a
 * megabyte on its own and is kept twice, once as the current pull and once as the pull
 * before it, and every other view a coordinator has ever synced is kept alongside it. The
 * first term is 2876 students, so this is now reachable rather than theoretical.
 *
 * What is given up is chosen so that the thing on screen survives: comparison points go
 * before rosters, other views go before this one, and the current pull of the view being
 * looked at is the last thing standing. Losing a comparison point costs the "changed
 * since last pull" column for that view; losing the current pull costs every name.
 */
function shrink(store: PackedStore, keep: string): { store: PackedStore; gave: string } | null {
  const others = Object.keys(store).filter((id) => id !== keep);

  // 1. Comparison points from other views.
  const withPrevious = others.filter((id) => store[id]?.previous);
  if (withPrevious.length) {
    const oldest = withPrevious.sort(
      (a, b) => (store[a].previous?.fetchedAt ?? 0) - (store[b].previous?.fetchedAt ?? 0),
    )[0];
    return {
      store: { ...store, [oldest]: { current: store[oldest].current } },
      gave: `the comparison point for ${store[oldest].previous?.name || oldest}`,
    };
  }

  // 2. This view's own comparison point.
  if (store[keep]?.previous) {
    return {
      store: { ...store, [keep]: { current: store[keep].current } },
      gave: "the comparison point for this view",
    };
  }

  // 3. Whole other views, least recently pulled first.
  if (others.length) {
    const oldest = others.sort(
      (a, b) => (store[a].current?.fetchedAt ?? 0) - (store[b].current?.fetchedAt ?? 0),
    )[0];
    const gave = `the stored roster for ${store[oldest].current?.name || oldest}`;
    const next = { ...store };
    delete next[oldest];
    return { store: next, gave };
  }

  return null;
}

/**
 * Store this pull, giving up as little as possible to make it fit.
 *
 * Retrying after each thing dropped rather than clearing everything: a coordinator who
 * syncs a whole term should not silently lose the four views they were working with when
 * dropping one comparison point would have been enough.
 */
async function writeFitting(store: PackedStore, keep: string): Promise<StorageReport> {
  const shed: string[] = [];
  let current = store;
  for (;;) {
    if (await write(current)) return { stored: true, shed };
    const smaller = shrink(current, keep);
    // Nothing left to give up and it still will not fit: say so rather than pretend.
    if (!smaller) return { stored: false, shed };
    shed.push(smaller.gave);
    current = smaller.store;
  }
}

export async function loadPull(presetId: string): Promise<StoredPreset> {
  return (await read())[presetId] ?? {};
}

/** Keep this pull, and demote the one it replaces to "previous". */
export async function rememberPull(roster: PortalRoster): Promise<StoredPreset> {
  const store = await readPacked();
  const existing = store[roster.presetId] ?? {};
  const kept = pack({
    presetId: roster.presetId,
    name: roster.name,
    count: roster.count,
    fetchedAt: roster.fetchedAt,
    rows: roster.rows,
  });
  /*
   * Only the pull itself. What changed since the last one is the history's answer and
   * always was — keeping the whole previous roster here stored 45 fields a student so
   * that six of them could be compared, and a term's worth of that did not fit beside
   * the views a coordinator already had. A `previous` written by an older version is
   * still read, so nothing a coordinator already has stops working.
   */
  store[roster.presetId] = { current: kept, previous: existing.previous };
  lastReport = await writeFitting(store, roster.presetId);
  try {
    window.localStorage.setItem(LAST, roster.presetId);
  } catch {
    // Same as write(): storage being unavailable must not break the page.
  }
  const saved = store[roster.presetId];
  return {
    current: saved?.current ? unpack(saved.current) : undefined,
    previous: saved?.previous ? unpack(saved.previous) : undefined,
  };
}

function syncTimes(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(SYNCED);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** When this view last synced, so a student first seen then shows as newly arrived. */
/** Every pull held, oldest first, so a newer one overwrites an older one's answer. */
async function heldPulls(): Promise<StoredPull[]> {
  const store = await read();
  return Object.values(store)
    .flatMap((preset) => [preset.previous, preset.current])
    .filter((pull): pull is StoredPull => Boolean(pull))
    .sort((left, right) => left.fetchedAt - right.fetchedAt);
}

/**
 * What the portal last said about each student, whoever asked.
 *
 * A view is a question about *which* students, not a separate account of what is true
 * about them: a student in the L1 view and the whole-term view is one student, and the
 * more recent answer is the better one wherever they are shown. Reading only the view's
 * own pull meant syncing one view left the same student stale in every other — and it
 * disagreed with the workbook export, which has always taken the newest across views.
 *
 * Newest wins, which is why the pulls are walked oldest first. The history goes in
 * underneath: it holds the last known values of students no view returns any more, so
 * somebody who has left still reads rather than emptying out.
 */
export async function rowsHeld(): Promise<RosterRow[]> {
  const merged = new Map<string, RosterRow>();

  for (const { values } of await allLatest()) {
    for (const [id, fields] of Object.entries(values)) {
      if (id) merged.set(id, fields as RosterRow);
    }
  }

  for (const pull of await heldPulls()) {
    for (const row of pull.rows) {
      const id = studentIdOf(row);
      if (id) merged.set(id, row);
    }
  }

  return [...merged.values()];
}

/**
 * Every name this browser holds, across every view it has pulled.
 *
 * The export needs names and the server has none — by design, they arrive from the
 * extension and go no further than this tab. A student may appear in more than one view;
 * the most recent pull wins, since that is the one whose spelling the registrar last used.
 */
export async function namesHeld(): Promise<Record<string, string>> {
  const names: Record<string, string> = {};

  // The history first: it keeps a student's last known values after the portal stops
  // returning them, so a departed student still has a name in an export.
  for (const { values } of await allLatest()) {
    for (const [id, fields] of Object.entries(values)) {
      const name = displayNameOf(fields as RosterRow);
      if (id && name) names[id] = name;
    }
  }

  // Then the pulls themselves, which are newer and win.
  for (const pull of await heldPulls()) {
    for (const row of pull.rows) {
      const id = studentIdOf(row);
      const name = displayNameOf(row);
      if (id && name) names[id] = name;
    }
  }
  return names;
}

/**
 * One portal field per student, from the pulls this browser is holding.
 *
 * The same rule as the names: most recent pull wins, and nothing leaves the browser. Used
 * for the workbook's Program column, which is the registrar's word rather than ours.
 */
export async function fieldHeld(field: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};

  for (const { values: held } of await allLatest()) {
    for (const [id, fields] of Object.entries(held)) {
      const value = String(fields[field] ?? "").trim();
      if (id && value) values[id] = value;
    }
  }

  for (const pull of await heldPulls()) {
    for (const row of pull.rows) {
      const id = studentIdOf(row);
      const value = String(row[field] ?? "").trim();
      if (id && value) values[id] = value;
    }
  }
  return values;
}

export function lastSync(viewId: string): string {
  return syncTimes()[viewId] ?? "";
}

export function rememberSync(viewId: string, syncedAt: string): void {
  try {
    window.localStorage.setItem(SYNCED, JSON.stringify({ ...syncTimes(), [viewId]: syncedAt }));
  } catch {
    // Same as write(): storage being unavailable must not break the page.
  }
}

export async function forgetRosters(): Promise<void> {
  await browser.drop(KEY);
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(OLD_KEY);
    window.localStorage.removeItem(LAST);
    window.localStorage.removeItem(SYNCED);
    window.localStorage.removeItem("scen-rosters:synced");
  } catch {
    // Nothing to do: if it cannot be removed it could not have been written either.
  }
}

/** "2 hours ago" — so nobody mistakes a stored roster for a fresh one. */
export function describeAge(fetchedAt: number, now = Date.now()): string {
  // Floor, not round: half a minute ago is not yet a minute ago.
  const minutes = Math.max(0, Math.floor((now - fetchedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
