/**
 * Named sets of columns, kept so a copy that is made every week is made in one click.
 *
 * A coordinator copying ids and e-mails into a mail merge, or ids and groups into a
 * register, is choosing the same handful of columns each time. Rearranging the table to
 * do it changes what everyone at that desk is looking at, and changes it back afterwards
 * — so a preset names its columns outright and copies them whatever the table is showing.
 *
 * They live in this browser, like the column layout, and are a few hundred bytes: small
 * enough that localStorage is the right drawer and being instant matters more than being
 * large. Nothing here reaches the server, and no student data is stored — only the names
 * of columns.
 */

import { rowText, tableText } from "@/services/copyCells";
import type { ColumnMeta } from "@/services/studentColumns";

const KEY = "scen-copy-presets:v1";

export type CopyPreset = {
  id: string;
  name: string;
  /** Column ids, in the order the preset names them — which is the order they copy in. */
  columnIds: string[];
};

export type CopyPresets = {
  presets: CopyPreset[];
  /**
   * Whether a copy carries its column names on the first line.
   *
   * Off by default: most of these are pasted into a sheet that already has headings, and
   * a stray header row there is a row of rubbish to delete. One setting for the person
   * rather than one per preset — it is a habit, not a property of the columns.
   */
  withHeader: boolean;
};

const EMPTY: CopyPresets = { presets: [], withHeader: false };

export function loadPresets(storageKey: string = KEY): CopyPresets {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return EMPTY;
    const held = JSON.parse(raw) as Partial<CopyPresets>;
    return {
      // A stored file outlives the code that wrote it: anything misshapen is dropped
      // rather than allowed to break the menu it is read into.
      presets: Array.isArray(held.presets)
        ? held.presets.filter(
            (preset): preset is CopyPreset =>
              Boolean(preset && typeof preset.id === "string" && typeof preset.name === "string") &&
              Array.isArray(preset.columnIds),
          )
        : [],
      withHeader: held.withHeader === true,
    };
  } catch {
    // Private browsing, or something that is not ours.
    return EMPTY;
  }
}

export function savePresets(held: CopyPresets, storageKey: string = KEY): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(held));
  } catch {
    // A preference that cannot be remembered must never break the table.
  }
}

/** An id that does not collide with one already stored, without needing a uuid. */
export function newPresetId(existing: CopyPreset[]): string {
  const taken = new Set(existing.map((preset) => preset.id));
  let candidate = `preset-${Date.now()}`;
  let suffix = 1;
  while (taken.has(candidate)) candidate = `preset-${Date.now()}-${suffix++}`;
  return candidate;
}

/**
 * The columns a preset names, in the order it names them.
 *
 * A preset outlives the columns it was made from — the portal stops offering a field, or
 * a coordinator's browser has never seen one — so an id nothing answers to is dropped.
 * Dropping it silently is right here: the alternative is a copy that refuses to happen
 * because of a column nobody has missed.
 */
export function presetColumns<C extends ColumnMeta>(preset: CopyPreset, columns: C[]): C[] {
  const known = new Map(columns.map((column) => [column.id, column]));
  return preset.columnIds
    .map((id) => known.get(id))
    .filter((column): column is C => Boolean(column));
}

/**
 * Which students a copy covers.
 *
 * The ones ticked, or everything on screen when nothing is ticked. "On screen" already
 * means after the filters, the search and the sort, so a preset copies what the
 * coordinator is looking at rather than the whole roster behind it.
 */
export function rowsForCopy<Row>(
  shown: Row[],
  selected: ReadonlySet<string>,
  idOf: (row: Row) => string = (row) => String((row as { studentId?: string }).studentId ?? ""),
): Row[] {
  if (selected.size === 0) return shown;
  const wanted = shown.filter((row) => selected.has(idOf(row)));
  // A selection made before a filter narrowed the table can have nothing left on screen.
  // Copying every row then would be the opposite of what was asked for.
  return wanted;
}

/**
 * Drop one picked column in front of another, which is what a drag between them means.
 *
 * The same rule the table's headers use, on a plain list: an empty `beforeId` means the
 * end, so a column dragged past the last one lands after it rather than nowhere.
 */
export function reorderPicked(ids: string[], id: string, beforeId: string): string[] {
  if (id === beforeId) return ids;
  const order = [...ids];
  const from = order.indexOf(id);
  if (from < 0) return ids;
  order.splice(from, 1);
  const to = beforeId ? order.indexOf(beforeId) : order.length;
  order.splice(to < 0 ? order.length : to, 0, id);
  return order;
}

/** One place left or right, for anyone not using a mouse. */
export function movePicked(ids: string[], id: string, by: -1 | 1): string[] {
  const order = [...ids];
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return ids;
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
}

/** The block a preset puts on the clipboard: rows down, the preset's columns across. */
export function presetText<Row, C extends ColumnMeta>(
  columns: C[],
  rows: Row[],
  cell: (row: Row, column: C) => string,
  withHeader: boolean,
): string {
  const body = rows.map((row) => columns.map((column) => cell(row, column)));
  if (withHeader) return tableText(columns.map((column) => column.displayName), body);
  return body.map(rowText).join("\n");
}
