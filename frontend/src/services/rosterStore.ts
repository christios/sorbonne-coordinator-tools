/**
 * The last two pulls, kept in this browser and nowhere else.
 *
 * Why store them at all: a roster that vanishes when you change page is useless, and
 * "who changed since last time" cannot be answered without something to compare against.
 * Neither can be solved on our side, because the server is never told a student's name.
 *
 * What this means, plainly: names, university e-mail addresses and year levels sit in
 * this browser's local storage until they are cleared. They are cleared on sign-out, and
 * by the "Forget stored rosters" button on the Students page. They are not sent anywhere,
 * they are per-machine, and a colleague's browser knows nothing about them.
 */

import type { PortalRoster, RosterRow } from "@/services/scenRosters";

const KEY = "scen-rosters:v1";
// Which search was last pulled, so coming back to the page shows what you were looking at.
const LAST = "scen-rosters:last";

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

function write(store: Store): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage being unavailable must never break the page; the roster stays in memory.
  }
}

export function loadPull(presetId: string): StoredPreset {
  return read()[presetId] ?? {};
}

/** The search whose roster is currently on screen, remembered across page changes. */
export function lastPulled(): string {
  try {
    return window.localStorage.getItem(LAST) ?? "";
  } catch {
    return "";
  }
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
  write(store);
  try {
    window.localStorage.setItem(LAST, roster.presetId);
  } catch {
    // Same as write(): storage being unavailable must not break the page.
  }
  return store[roster.presetId];
}

export function forgetRosters(): void {
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LAST);
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
