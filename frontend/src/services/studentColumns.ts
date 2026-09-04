/**
 * The columns of the student table: what they are, and how this browser has arranged them.
 *
 * Most of them are the portal's own columns, read from the grid's column picker by the
 * extension, so the table offers exactly what the registrar shows rather than a list
 * somebody typed out once. A handful are ours — the status, the cohort, when we first
 * held them — and those are the ones the portal knows nothing about.
 *
 * Columns are not filters. The portal filters by fields it never displays and displays
 * columns it cannot filter by, so the two lists come from two places: the column picker
 * decides what the table can show, and the quick filters only say which of those columns
 * have a code table worth offering as a set of choices rather than as free text.
 *
 * A column knows its kind, so the filter bar can offer the right operators (see
 * services/tableFilter.ts). The arrangement — which columns are shown, in what order, and
 * how wide — is a personal preference rather than a shared decision, so it is kept in this
 * browser rather than on the server.
 */

import type { ColumnDataType, FilterColumn } from "@/services/tableFilter";
import { describeWarning } from "@/services/discrepancies";
import type { StudentRow } from "@/services/rosterView";
import type { PortalColumn, PortalField } from "@/services/scenRosters";

const KEY = "scen-student-columns:v1";

export type StudentColumn = FilterColumn<StudentRow> & {
  type: ColumnDataType;
  /** How the cell reads on screen, which is not always how it filters. */
  display?: (row: StudentRow) => string;
  /**
   * How the column ranks when sorted, when that is not how it filters or displays.
   *
   * Status is the case: it shows three separate signals in one cell, and none of them is
   * the value it filters by.
   */
  sortValue?: (row: StudentRow) => string | number;
  /** Columns that carry the row's identity and would make the table unreadable if hidden. */
  required?: boolean;
  defaultWidth: number;
};

/**
 * The narrowest a column may be dragged.
 *
 * Not a judgement about how wide a column ought to be — a coordinator can squeeze any of
 * them down to a sliver — only enough that the resize handle stays catchable. At zero the
 * column vanishes and there is nothing left to grab to bring it back.
 */
export const MIN_WIDTH = 28;

/** Exactly what the Status cell shows, in the order it shows them. */
export function statusPills(row: StudentRow): string[] {
  const pills = [row.status === "not_in_portal" ? "Not in portal" : "In portal"];
  if (row.isNew) pills.push("New");
  if (row.changes.length > 0) pills.push("Changed");
  return pills;
}

/** Worth attention first: gone from the portal, then newly arrived, then altered. */
const STATUS_RANK: ((row: StudentRow) => boolean)[] = [
  (row) => row.status === "not_in_portal",
  (row) => row.isNew,
  (row) => row.changes.length > 0,
  () => true,
];

/** The columns a coordinator sees before they have arranged anything. */
const DEFAULT_SHOWN = [
  "status",
  "warnings",
  "portal:FULL_NAME",
  "studentId",
  "portal:YEARLEVEL_CODE",
  "portal:MAJOR_CODE_DESC",
  "cohortName",
  "groups",
];

/** The columns that are ours rather than the portal's. */
const OWN_COLUMNS: StudentColumn[] = [
  {
    id: "status",
    displayName: "Status",
    // Three signals in one cell, so each is an option of its own: "show me everyone the
    // last sync brought in" was not askable while this filtered on portal state alone.
    type: "multiOption",
    accessor: (row) => statusPills(row),
    display: (row) => statusPills(row).join(" · "),
    // Sorted by how much it wants looking at, not alphabetically. A coordinator who clicks
    // Status is asking what needs attention, and "Changed" before "In portal" is only an
    // accident of the alphabet.
    sortValue: (row) => STATUS_RANK.findIndex((test) => test(row)),
    required: true,
    defaultWidth: 150,
  },
  {
    id: "studentId",
    displayName: "Id",
    type: "text",
    accessor: (row) => row.studentId,
    required: true,
    defaultWidth: 140,
  },
  {
    id: "cohortName",
    displayName: "Cohort",
    type: "option",
    accessor: (row) => row.cohortName,
    display: (row) => row.cohortName || "—",
    defaultWidth: 180,
  },
  {
    id: "groups",
    displayName: "Groups",
    // Several per student, so it filters as "include any of": "show me everyone in TD 1".
    type: "multiOption",
    accessor: (row) => row.groups,
    display: (row) => (row.groups.length ? row.groups.join(" · ") : "—"),
    defaultWidth: 200,
  },
  {
    id: "firstSeenAt",
    displayName: "First seen",
    type: "date",
    accessor: (row) => row.firstSeenAt,
    display: (row) => asDay(row.firstSeenAt),
    defaultWidth: 150,
  },
  {
    id: "lastSeenAt",
    displayName: "Last seen",
    type: "date",
    accessor: (row) => row.lastSeenAt,
    display: (row) => asDay(row.lastSeenAt),
    defaultWidth: 150,
  },
];

/**
 * Where the portal and the cohort disagree. Only offered on the Cohorts page, which is
 * the one place rows carry warnings; elsewhere it would be a column of dashes.
 */
export const WARNINGS_COLUMN: StudentColumn = {
  id: "warnings",
  displayName: "Warnings",
  type: "text",
  accessor: (row) => row.warnings.map((warning) => describeWarning(warning)).join("; "),
  display: (row) => row.warnings.map((warning) => describeWarning(warning)).join("; "),
  // Most trouble first when sorted descending, which is how the Cohorts page opens.
  sortValue: (row) => row.warnings.filter((warning) => !warning.dismissed).length,
  defaultWidth: 360,
};

/** Portal fields we already have a column of our own for, or that say nothing useful. */
const SKIP_PORTAL_FIELDS = new Set(["SPRIDEN_ID", "ROWNUM", "ROW_NUM"]);

/**
 * A portal field with a short code table is worth filtering as an option; one with a long
 * one, or none at all, reads better as free text.
 */
const OPTION_LIMIT = 60;

function portalColumn(column: PortalColumn, filterable: Map<string, PortalField>): StudentColumn {
  // Whether a column reads as a set of choices is a question about its values, and the
  // only place values are known is the filter it shares a key with — if it has one.
  const field = filterable.get(column.key.toUpperCase());
  const options = field?.options.length ?? 0;
  return {
    id: `portal:${column.key}`,
    displayName: column.label || column.key,
    type: options > 0 && options <= OPTION_LIMIT ? "option" : "text",
    accessor: (row) => row.portal[column.key] ?? "",
    defaultWidth: 180,
  };
}

/**
 * Every column the table can show, given what the extension says the portal has.
 *
 * Before the extension has answered there are no portal columns, so the table falls back
 * to our own plus the handful the roster always carries — otherwise the first visit would
 * show nothing but ids.
 */
export function buildColumns(
  portalColumns: PortalColumn[],
  fields: PortalField[] = [],
  { withWarnings = false, withoutCohort = false }: { withWarnings?: boolean; withoutCohort?: boolean } = {},
): StudentColumn[] {
  const filterable = new Map(fields.map((field) => [field.key.toUpperCase(), field]));
  const portal = portalColumns.length ? portalColumns : FALLBACK_COLUMNS;
  // The warnings sit beside the name, where the eye goes, rather than at the far end. On
  // a table that is one cohort's, the Cohort column would say the same thing on every row.
  const own = withoutCohort ? OWN_COLUMNS.filter((column) => column.id !== "cohortName") : OWN_COLUMNS;
  const columns = withWarnings ? [own[0], WARNINGS_COLUMN, ...own.slice(1)] : [...own];
  for (const column of portal) {
    if (SKIP_PORTAL_FIELDS.has(column.key.toUpperCase())) continue;
    columns.push(portalColumn(column, filterable));
  }
  // The everyday columns lead, in the order they read best; the rest follow as the portal
  // lists them. This is only the starting arrangement — it is the first thing a
  // coordinator changes, and their change outlives it.
  const rank = (column: StudentColumn) => {
    const place = DEFAULT_SHOWN.indexOf(column.id);
    return place < 0 ? DEFAULT_SHOWN.length : place;
  };
  return columns
    .map((column, index) => ({ column, index }))
    .sort((left, right) => rank(left.column) - rank(right.column) || left.index - right.index)
    .map((entry) => entry.column);
}

/** What the roster carries even before the extension has described the portal. */
const FALLBACK_COLUMNS: PortalColumn[] = [
  { key: "FULL_NAME", label: "Student" },
  { key: "YEARLEVEL_CODE", label: "Year" },
  { key: "MAJOR_CODE_DESC", label: "Major" },
  { key: "PSUAD_EMAIL", label: "E-mail" },
];


/** Which columns are shown, in which order, and how wide each one is. */
export type ColumnLayout = {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
};

export function defaultLayout(columns: StudentColumn[]): ColumnLayout {
  return {
    order: columns.map((column) => column.id),
    hidden: columns
      .filter((column) => !column.required && !DEFAULT_SHOWN.includes(column.id))
      .map((column) => column.id),
    widths: {},
  };
}

/**
 * The layout, repaired against the columns that actually exist.
 *
 * A stored layout outlives the code that wrote it: a column added since is appended rather
 * than lost, one removed since is dropped, and a required column cannot stay hidden even
 * if an older layout says it is.
 */
export function reconcileLayout(
  stored: Partial<ColumnLayout> | null,
  columns: StudentColumn[],
): ColumnLayout {
  const known = new Map(columns.map((column) => [column.id, column]));
  const fallback = defaultLayout(columns);
  const order = (stored?.order ?? []).filter((id) => known.has(id));
  for (const column of columns) {
    if (!order.includes(column.id)) order.push(column.id);
  }
  // A column the portal has only just started offering starts hidden, like the rest of
  // the ones nobody asked for — appearing unannounced would rearrange the table.
  const carriedOver = stored?.order ?? [];
  const hidden = (stored ? [...(stored.hidden ?? [])] : fallback.hidden).filter(
    (id) => known.has(id) && !known.get(id)?.required,
  );
  if (stored) {
    for (const column of columns) {
      if (!carriedOver.includes(column.id) && !hidden.includes(column.id) && !column.required) {
        if (!DEFAULT_SHOWN.includes(column.id)) hidden.push(column.id);
      }
    }
  }
  const widths: Record<string, number> = {};
  for (const [id, width] of Object.entries(stored?.widths ?? {})) {
    const column = known.get(id);
    if (column && Number.isFinite(width)) widths[id] = Math.max(MIN_WIDTH, Number(width));
  }
  return { order, hidden, widths };
}

/**
 * The layout is per table, not per browser: the Cohorts page has columns the Students
 * page does not and lacks one it has, and a coordinator arranging one should not find
 * the other rearranged. `storageKey` names which.
 */
export function loadLayout(columns: StudentColumn[], storageKey: string = KEY): ColumnLayout {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return reconcileLayout(raw ? (JSON.parse(raw) as ColumnLayout) : null, columns);
  } catch {
    // Private browsing, or something that is not ours: fall back to the default.
    return reconcileLayout(null, columns);
  }
}

export function saveLayout(layout: ColumnLayout, storageKey: string = KEY): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // A preference that cannot be remembered must never break the table.
  }
}

/** The columns on screen, in the order they are shown. */
export function visibleColumns(layout: ColumnLayout, columns: StudentColumn[]): StudentColumn[] {
  const known = new Map(columns.map((column) => [column.id, column]));
  return layout.order
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => known.get(id))
    .filter((column): column is StudentColumn => Boolean(column));
}

export function widthOf(layout: ColumnLayout, column: StudentColumn): number {
  return Math.max(MIN_WIDTH, layout.widths[column.id] ?? column.defaultWidth);
}

/** Move a column one place along the order, skipping over nothing. */
export function moveColumn(layout: ColumnLayout, id: string, by: -1 | 1): ColumnLayout {
  const order = [...layout.order];
  const from = order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return layout;
  order.splice(to, 0, ...order.splice(from, 1));
  return { ...layout, order };
}

/** Drop one column in front of another, which is what a drag between headers means. */
export function reorderColumn(layout: ColumnLayout, id: string, beforeId: string): ColumnLayout {
  if (id === beforeId) return layout;
  const order = [...layout.order];
  const from = order.indexOf(id);
  if (from < 0) return layout;
  order.splice(from, 1);
  const to = beforeId ? order.indexOf(beforeId) : order.length;
  order.splice(to < 0 ? order.length : to, 0, id);
  return { ...layout, order };
}

export function toggleColumn(layout: ColumnLayout, id: string, columns: StudentColumn[]): ColumnLayout {
  const column = columns.find((candidate) => candidate.id === id);
  if (!column || column.required) return layout;
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((kept) => kept !== id)
    : [...layout.hidden, id];
  return { ...layout, hidden };
}

export function resizeColumn(layout: ColumnLayout, id: string, width: number, columns: StudentColumn[]): ColumnLayout {
  const column = columns.find((candidate) => candidate.id === id);
  if (!column) return layout;
  return { ...layout, widths: { ...layout.widths, [id]: Math.max(MIN_WIDTH, Math.round(width)) } };
}

/** A day, written the way a coordinator reads one. */
function asDay(value: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The values a column actually holds, for the filter bar to offer as options. */
const OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "accent" });

export function optionsFor(rows: StudentRow[], column: StudentColumn): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    // A multiOption column holds several values per row, and each is an option of its own:
    // stringifying the array would offer "CM 1 · TD 1" as a single thing to filter by.
    const held = column.accessor(row);
    const values = Array.isArray(held) ? held.map(String) : [String(held ?? "")];
    for (const value of values) {
      if (!value) continue;
      if (!seen.has(value)) seen.set(value, Array.isArray(held) ? value : column.display ? column.display(row) : value);
    }
  }
  // Same collation as the table: case ignored, accents kept, "10" after "9".
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => OPTION_COLLATOR.compare(a.label, b.label));
}
