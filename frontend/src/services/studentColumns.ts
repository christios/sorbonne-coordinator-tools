/**
 * The columns of the student table: what they are, and how this browser has arranged them.
 *
 * A column knows its kind, so the filter bar can offer the right operators (see
 * services/tableFilter.ts) and the table can render it sensibly. The arrangement — which
 * columns are shown, in what order, and how wide — is a personal preference rather than a
 * shared decision, so it is kept in this browser rather than on the server.
 */

import type { ColumnDataType, FilterColumn } from "@/services/tableFilter";
import type { StudentRow } from "@/services/rosterView";

const KEY = "scen-student-columns:v1";

export type StudentColumn = FilterColumn<StudentRow> & {
  type: ColumnDataType;
  /** How the cell reads on screen, which is not always how it filters. */
  display?: (row: StudentRow) => string;
  /** Columns that carry the row's identity and would make the table unreadable if hidden. */
  required?: boolean;
  defaultWidth: number;
  minWidth: number;
};

export const STUDENT_COLUMNS: StudentColumn[] = [
  {
    id: "status",
    displayName: "Status",
    type: "option",
    accessor: (row) => row.status,
    display: (row) => (row.status === "not_in_portal" ? "Not in portal" : "In portal"),
    required: true,
    defaultWidth: 150,
    minWidth: 110,
  },
  {
    id: "name",
    displayName: "Student",
    type: "text",
    accessor: (row) => row.name,
    defaultWidth: 240,
    minWidth: 140,
  },
  {
    id: "studentId",
    displayName: "Id",
    type: "text",
    accessor: (row) => row.studentId,
    required: true,
    defaultWidth: 140,
    minWidth: 100,
  },
  {
    id: "yearLevel",
    displayName: "Year",
    type: "option",
    accessor: (row) => row.yearLevel,
    defaultWidth: 110,
    minWidth: 80,
  },
  {
    id: "major",
    displayName: "Major",
    type: "option",
    accessor: (row) => row.major,
    defaultWidth: 200,
    minWidth: 120,
  },
  {
    id: "cohortName",
    displayName: "Cohort",
    type: "option",
    accessor: (row) => row.cohortName,
    display: (row) => row.cohortName || "—",
    defaultWidth: 180,
    minWidth: 120,
  },
  {
    id: "email",
    displayName: "E-mail",
    type: "text",
    accessor: (row) => row.email,
    defaultWidth: 240,
    minWidth: 140,
  },
  {
    id: "firstSeenAt",
    displayName: "First seen",
    type: "date",
    accessor: (row) => row.firstSeenAt,
    display: (row) => asDay(row.firstSeenAt),
    defaultWidth: 150,
    minWidth: 110,
  },
  {
    id: "lastSeenAt",
    displayName: "Last seen",
    type: "date",
    accessor: (row) => row.lastSeenAt,
    display: (row) => asDay(row.lastSeenAt),
    defaultWidth: 150,
    minWidth: 110,
  },
];

/** The columns a coordinator sees before they have arranged anything. */
const DEFAULT_SHOWN = ["status", "name", "studentId", "yearLevel", "major", "cohortName"];

/** Which columns are shown, in which order, and how wide each one is. */
export type ColumnLayout = {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
};

export const DEFAULT_LAYOUT: ColumnLayout = {
  order: STUDENT_COLUMNS.map((column) => column.id),
  hidden: STUDENT_COLUMNS.filter((column) => !DEFAULT_SHOWN.includes(column.id)).map(
    (column) => column.id,
  ),
  widths: {},
};

/**
 * The layout, repaired against the columns that actually exist.
 *
 * A stored layout outlives the code that wrote it: a column added since is appended rather
 * than lost, one removed since is dropped, and a required column cannot stay hidden even
 * if an older layout says it is.
 */
export function reconcileLayout(stored: Partial<ColumnLayout> | null): ColumnLayout {
  const known = new Map(STUDENT_COLUMNS.map((column) => [column.id, column]));
  const order = (stored?.order ?? []).filter((id) => known.has(id));
  for (const column of STUDENT_COLUMNS) {
    if (!order.includes(column.id)) order.push(column.id);
  }
  const hidden = (stored?.hidden ?? DEFAULT_LAYOUT.hidden).filter(
    (id) => known.has(id) && !known.get(id)?.required,
  );
  const widths: Record<string, number> = {};
  for (const [id, width] of Object.entries(stored?.widths ?? {})) {
    const column = known.get(id);
    if (column && Number.isFinite(width)) widths[id] = Math.max(column.minWidth, Number(width));
  }
  return { order, hidden, widths };
}

export function loadLayout(): ColumnLayout {
  try {
    const raw = window.localStorage.getItem(KEY);
    return reconcileLayout(raw ? (JSON.parse(raw) as ColumnLayout) : null);
  } catch {
    // Private browsing, or something that is not ours: fall back to the default.
    return reconcileLayout(null);
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
export function visibleColumns(layout: ColumnLayout): StudentColumn[] {
  const known = new Map(STUDENT_COLUMNS.map((column) => [column.id, column]));
  return layout.order
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => known.get(id))
    .filter((column): column is StudentColumn => Boolean(column));
}

export function widthOf(layout: ColumnLayout, column: StudentColumn): number {
  return Math.max(column.minWidth, layout.widths[column.id] ?? column.defaultWidth);
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

export function toggleColumn(layout: ColumnLayout, id: string): ColumnLayout {
  const column = STUDENT_COLUMNS.find((candidate) => candidate.id === id);
  if (!column || column.required) return layout;
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((kept) => kept !== id)
    : [...layout.hidden, id];
  return { ...layout, hidden };
}

export function resizeColumn(layout: ColumnLayout, id: string, width: number): ColumnLayout {
  const column = STUDENT_COLUMNS.find((candidate) => candidate.id === id);
  if (!column) return layout;
  return { ...layout, widths: { ...layout.widths, [id]: Math.max(column.minWidth, Math.round(width)) } };
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
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
