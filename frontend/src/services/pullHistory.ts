/**
 * What the portal has said about each student, pull after pull.
 *
 * Kept as deltas rather than snapshots. A full snapshot of four hundred students across
 * nineteen portal fields is a couple of hundred kilobytes, and there will be a pull most
 * days for weeks — storing them whole would fill this browser's quota within a term. So
 * the latest values are held once, and every pull before that contributes only the fields
 * that actually moved.
 *
 * That shape also answers the question the panel asks. A pull where nothing changed for a
 * student contributes nothing to that student's history, so it collapses on its own rather
 * than being filtered out afterwards, and a pull where nothing changed for anybody is one
 * line in the timeline instead of four hundred.
 *
 * All of it lives in this browser: these are the portal's own values — names, e-mail
 * addresses, majors — and our side is never told them.
 *
 * One history per view. A view is a question with a fixed filter, so "changed" and "no
 * longer returned" only mean anything against the same question: syncing the L1 view says
 * nothing about whether an FY student has left, and pooling the two made every sync look
 * like a mass departure from whichever view you were looking at.
 */

import { studentIdOf, type RosterRow } from "@/services/scenRosters";

// v1 was a single shared history. It cannot be split after the fact — a pull did not
// record which view asked — so the new key starts clean and the old one is cleared.
const KEY = "scen-pull-history:v2";
const OLD_KEY = "scen-pull-history:v1";

/** Beyond this the oldest pulls are dropped; a term of daily pulls fits comfortably. */
const MAX_PULLS = 400;

/** Fields not worth a history entry: they say when we looked, not what is true. */
const IGNORED = new Set(["ROWNUM", "ROW_NUM"]);

export type FieldChange = { field: string; from: string; to: string };

export type PullRecord = {
  id: string;
  at: number;
  /** How many rows the portal returned. */
  count: number;
  /** Only the students something changed for, and only the fields that moved. */
  changed: Record<string, FieldChange[]>;
  /** Students this pull saw for the first time, and ones it stopped returning. */
  arrived: string[];
  departed: string[];
};

export type PullHistory = {
  /** Newest last, the way a timeline reads. */
  pulls: PullRecord[];
  /** The values the last pull left behind, which the next one is compared against. */
  latest: Record<string, Record<string, string>>;
  /**
   * The ids the last pull actually returned.
   *
   * Not the same as the keys of `latest`, which keeps a departed student's values so
   * their history still reads. Leaving is a transition — present last time, absent now —
   * and deriving it from `latest` reported the same departure again at every pull.
   */
  present: string[];
};

type HistoryStore = Record<string, PullHistory>;

const EMPTY: PullHistory = { pulls: [], latest: {}, present: [] };

function read(): HistoryStore {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryStore) : {};
  } catch {
    // Private browsing, a full disk, or something that is not ours.
    return {};
  }
}

export function loadHistory(viewId: string): PullHistory {
  const held = read()[viewId];
  if (!held || !Array.isArray(held.pulls) || !held.latest) return EMPTY;
  return { ...held, present: Array.isArray(held.present) ? held.present : Object.keys(held.latest) };
}

/**
 * Every value this browser holds, view by view, newest view last.
 *
 * The history keeps a student's last known values even after the portal stops returning
 * them, which is what the roster store used to keep a whole second copy of the previous
 * pull for. This is that copy, without the duplication.
 */
export function allLatest(): { at: number; values: Record<string, Record<string, string>> }[] {
  let store: Record<string, PullHistory>;
  try {
    store = read();
  } catch {
    return [];
  }
  return Object.values(store)
    .filter((history) => history?.latest)
    .map((history) => ({
      at: history.pulls?.[history.pulls.length - 1]?.at ?? 0,
      values: history.latest,
    }))
    .sort((left, right) => left.at - right.at);
}

function put(store: Record<string, PullHistory>): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

/**
 * Give up the oldest history there is, wherever it lives.
 *
 * A term-sized view carries a megabyte of `latest` values, and the browser's quota is
 * shared with the rosters — which are what the table shows names from, and so are written
 * first and must win. The timeline is the thing worth losing here, and its oldest entries
 * are the least worth keeping.
 */
function shrink(store: Record<string, PullHistory>, keep: string): Record<string, PullHistory> | null {
  // 1. The oldest recorded pulls, from whichever view holds the most of them.
  const longest = Object.keys(store)
    .filter((id) => (store[id]?.pulls.length ?? 0) > 1)
    .sort((a, b) => store[b].pulls.length - store[a].pulls.length)[0];
  if (longest) {
    const pulls = store[longest].pulls;
    return { ...store, [longest]: { ...store[longest], pulls: pulls.slice(Math.ceil(pulls.length / 2)) } };
  }

  // 2. Another view's history entirely.
  const other = Object.keys(store).find((id) => id !== keep);
  if (other) {
    const next = { ...store };
    delete next[other];
    return next;
  }

  return null;
}

function write(viewId: string, history: PullHistory): void {
  let store: Record<string, PullHistory>;
  try {
    store = read();
  } catch {
    return;
  }
  store[viewId] = history;
  for (;;) {
    if (put(store)) return;
    const smaller = shrink(store, viewId);
    // A history that cannot be written must never break the sync it was recording.
    if (!smaller) return;
    store = smaller;
  }
}

/** Every view's history, or one view's when it is named. */
export function forgetHistory(viewId?: string): void {
  try {
    window.localStorage.removeItem(OLD_KEY);
    if (viewId === undefined) {
      window.localStorage.removeItem(KEY);
      return;
    }
    const store = read();
    delete store[viewId];
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // If it cannot be removed it could not have been written either.
  }
}

/** A pull's rows, flattened to `id -> field -> value`, blanks dropped. */
function valuesOf(rows: RosterRow[]): Record<string, Record<string, string>> {
  const students: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const id = studentIdOf(row);
    if (!id || students[id]) continue;
    const fields: Record<string, string> = {};
    for (const [field, value] of Object.entries(row)) {
      if (IGNORED.has(field)) continue;
      const text = String(value ?? "").trim();
      if (text) fields[field] = text;
    }
    students[id] = fields;
  }
  return students;
}

/**
 * Record a pull, and return the history it produced.
 *
 * The first pull is the baseline: everybody has arrived, and nobody has changed, because
 * there is nothing yet to have changed from.
 */
export function recordPull(viewId: string, rows: RosterRow[], at: number = Date.now()): PullHistory {
  const history = loadHistory(viewId);
  const now = valuesOf(rows);
  const before = history.latest;
  const first = history.pulls.length === 0;

  const changed: Record<string, FieldChange[]> = {};
  const arrived: string[] = [];
  const held = new Set(history.present);
  for (const [id, fields] of Object.entries(now)) {
    // New to this view — which includes somebody it stopped returning and now returns
    // again, because for this view that is an arrival.
    if (!held.has(id)) arrived.push(id);
    const earlier = before[id];
    if (!earlier) continue;
    const moved: FieldChange[] = [];
    for (const field of new Set([...Object.keys(fields), ...Object.keys(earlier)])) {
      const from = earlier[field] ?? "";
      const to = fields[field] ?? "";
      if (from !== to) moved.push({ field, from, to });
    }
    if (moved.length) changed[id] = moved.sort((a, b) => a.field.localeCompare(b.field));
  }

  // Whoever this view returned last time and does not return now. A student who was
  // already gone has not left again.
  const departed = history.present.filter((id) => !now[id]);

  const record: PullRecord = {
    id: `${at}`,
    at,
    count: rows.length,
    changed,
    arrived: first ? [] : arrived,
    departed,
  };

  const next: PullHistory = {
    // A student the portal has dropped keeps their last known values, so their history
    // still reads after they have gone — but they are no longer present.
    latest: { ...before, ...now },
    present: Object.keys(now),
    pulls: [...history.pulls, record].slice(-MAX_PULLS),
  };
  write(viewId, next);
  return next;
}

export type HistoryEntry = {
  at: number;
  pullId: string;
  kind: "changed" | "arrived" | "departed";
  changes: FieldChange[];
};

/**
 * One student's history, newest first, with the quiet pulls left out.
 *
 * A pull only appears if something happened to *this* student in it, which is what keeps
 * the panel readable when there have been ninety pulls and they were in eleven of them.
 */
export function historyFor(history: PullHistory, studentId: string): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const pull of history.pulls) {
    if (pull.arrived.includes(studentId)) {
      entries.push({ at: pull.at, pullId: pull.id, kind: "arrived", changes: [] });
    } else if (pull.departed.includes(studentId)) {
      entries.push({ at: pull.at, pullId: pull.id, kind: "departed", changes: [] });
    } else if (pull.changed[studentId]?.length) {
      entries.push({
        at: pull.at,
        pullId: pull.id,
        kind: "changed",
        changes: pull.changed[studentId],
      });
    }
  }
  return entries.reverse();
}

/** How many pulls this student appears in, and how many there have been in total. */
export function historySummary(
  history: PullHistory,
  studentId: string,
): { shown: number; total: number; quiet: number } {
  const shown = historyFor(history, studentId).length;
  return { shown, total: history.pulls.length, quiet: history.pulls.length - shown };
}

/** Every field the history has ever seen, so the panel can name them all. */
export function fieldsSeen(history: PullHistory): string[] {
  const fields = new Set<string>();
  for (const student of Object.values(history.latest)) {
    for (const field of Object.keys(student)) fields.add(field);
  }
  return [...fields].sort();
}
