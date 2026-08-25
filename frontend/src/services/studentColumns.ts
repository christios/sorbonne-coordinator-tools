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
import type { StudentRow } from "@/services/rosterView";
import type { PortalColumn, PortalField } from "@/services/scenRosters";

const KEY = "scen-student-columns:v1";

export type StudentColumn = FilterColumn<StudentRow> & {
  type: ColumnDataType;
  /** How the cell reads on screen, which is not always how it filters. */
  display?: (row: StudentRow) => string;
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

/** The columns a coordinator sees before they have arranged anything. */
const DEFAULT_SHOWN = [
  "status",
  "portal:FULL_NAME",
  "studentId",
  "portal:YEARLEVEL_CODE",
  "portal:MAJOR_CODE_DESC",
  "cohortName",
];

/** The columns that are ours rather than the portal's. */
const OWN_COLUMNS: StudentColumn[] = [
  {
    id: "status",
    displayName: "Status",
    type: "option",
    accessor: (row) => row.status,
    display: (row) => (row.status === "not_in_portal" ? "Not in portal" : "In portal"),
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
export function buildColumns(portalColumns: PortalColumn[], fields: PortalField[] = []): StudentColumn[] {
  const filterable = new Map(fields.map((field) => [field.key.toUpperCase(), field]));
  const portal = portalColumns.length ? portalColumns : FALLBACK_COLUMNS;
  const columns = [...OWN_COLUMNS];
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

export function loadLayout(columns: StudentColumn[]): ColumnLayout {
  try {
    const raw = window.localStorage.getItem(KEY);
    return reconcileLayout(raw ? (JSON.parse(raw) as ColumnLayout) : null, columns);
  } catch {
    // Private browsing, or something that is not ours: fall back to the default.
    return reconcileLayout(null, columns);
  }
}

export function saveLayout(layout: ColumnLayout): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
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
export function optionsFor(rows: StudentRow[], column: StudentColumn): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = String(column.accessor(row) ?? "");
    if (!value) continue;
    if (!seen.has(value)) seen.set(value, column.display ? column.display(row) : value);
  }
  // Same collation as the table: case ignored, accents kept, "10" after "9".
  return [...seen]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "accent" }));
}
