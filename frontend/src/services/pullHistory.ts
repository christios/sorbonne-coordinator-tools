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
 */

import { studentIdOf, type RosterRow } from "@/services/scenRosters";

const KEY = "scen-pull-history:v1";

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
};

const EMPTY: PullHistory = { pulls: [], latest: {} };

export function loadHistory(): PullHistory {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as PullHistory;
    return Array.isArray(parsed.pulls) && parsed.latest ? parsed : EMPTY;
  } catch {
    // Private browsing, a full disk, or something that is not ours.
    return EMPTY;
  }
}

function write(history: PullHistory): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(history));
  } catch {
    // A history that cannot be written must never break the sync it was recording.
  }
}

export function forgetHistory(): void {
  try {
    window.localStorage.removeItem(KEY);
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
export function recordPull(rows: RosterRow[], at: number = Date.now()): PullHistory {
  const history = loadHistory();
  const now = valuesOf(rows);
  const before = history.latest;
  const first = history.pulls.length === 0;

  const changed: Record<string, FieldChange[]> = {};
  const arrived: string[] = [];
  for (const [id, fields] of Object.entries(now)) {
    const earlier = before[id];
    if (!earlier) {
      arrived.push(id);
      continue;
    }
    const moved: FieldChange[] = [];
    for (const field of new Set([...Object.keys(fields), ...Object.keys(earlier)])) {
      const from = earlier[field] ?? "";
      const to = fields[field] ?? "";
      if (from !== to) moved.push({ field, from, to });
    }
    if (moved.length) changed[id] = moved.sort((a, b) => a.field.localeCompare(b.field));
  }

  const departed = Object.keys(before).filter((id) => !now[id]);

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
    // still reads after they have gone.
    latest: { ...before, ...now },
    pulls: [...history.pulls, record].slice(-MAX_PULLS),
  };
  write(next);
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
