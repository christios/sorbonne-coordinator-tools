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

import { displayNameOf, studentIdOf, type PortalRoster, type RosterRow } from "@/services/scenRosters";

const KEY = "scen-rosters:v1";
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

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    // Private browsing, a full disk, or something that is not ours: behave as if empty.
    return {};
  }
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
function write(store: Store): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    // Private browsing, a full disk, or — the usual one — the origin's quota.
    return false;
  }
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
function shrink(store: Store, keep: string): { store: Store; gave: string } | null {
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
function writeFitting(store: Store, keep: string): StorageReport {
  const shed: string[] = [];
  let current = store;
  for (;;) {
    if (write(current)) return { stored: true, shed };
    const smaller = shrink(current, keep);
    // Nothing left to give up and it still will not fit: say so rather than pretend.
    if (!smaller) return { stored: false, shed };
    shed.push(smaller.gave);
    current = smaller.store;
  }
}

export function loadPull(presetId: string): StoredPreset {
  return read()[presetId] ?? {};
}

/** Keep this pull, and demote the one it replaces to "previous". */
export function rememberPull(roster: PortalRoster): StoredPreset {
  const store = read();
  const existing = store[roster.presetId] ?? {};
  const kept: StoredPull = {
    presetId: roster.presetId,
    name: roster.name,
    count: roster.count,
    fetchedAt: roster.fetchedAt,
    rows: roster.rows,
  };
  // Pulling twice in quick succession should not throw away the comparison point.
  const previous = existing.current && existing.current.fetchedAt !== kept.fetchedAt
    ? existing.current
    : existing.previous;
  store[roster.presetId] = { current: kept, previous };
  lastReport = writeFitting(store, roster.presetId);
  try {
    window.localStorage.setItem(LAST, roster.presetId);
  } catch {
    // Same as write(): storage being unavailable must not break the page.
  }
  return store[roster.presetId];
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
/**
 * Every name this browser holds, across every view it has pulled.
 *
 * The export needs names and the server has none — by design, they arrive from the
 * extension and go no further than this tab. A student may appear in more than one view;
 * the most recent pull wins, since that is the one whose spelling the registrar last used.
 */
export function namesHeld(): Record<string, string> {
  const store = read();
  const names: Record<string, string> = {};
  const pulls = Object.values(store)
    .flatMap((preset) => [preset.previous, preset.current])
    .filter((pull): pull is StoredPull => Boolean(pull))
    .sort((left, right) => left.fetchedAt - right.fetchedAt);

  for (const pull of pulls) {
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
export function fieldHeld(field: string): Record<string, string> {
  const store = read();
  const values: Record<string, string> = {};
  const pulls = Object.values(store)
    .flatMap((preset) => [preset.previous, preset.current])
    .filter((pull): pull is StoredPull => Boolean(pull))
    .sort((left, right) => left.fetchedAt - right.fetchedAt);

  for (const pull of pulls) {
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

export function forgetRosters(): void {
  try {
    window.localStorage.removeItem(KEY);
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
