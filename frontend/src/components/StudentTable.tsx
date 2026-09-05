import { AlertTriangle, Clock3, RotateCcw, X } from "lucide-react";
import { memo, useCallback } from "react";

import { DataTable, type Sort } from "@/components/DataTable";
import { describeWarning } from "@/services/discrepancies";
import type { StudentRow } from "@/services/rosterView";
import type { ColumnLayout, StudentColumn } from "@/services/studentColumns";

export type { Sort } from "@/components/DataTable";

export function cellText(row: StudentRow, column: StudentColumn): string {
  if (column.id === "status") {
    return row.status === "not_in_portal" ? "Not in portal" : "In portal";
  }
  return column.display ? column.display(row) : String(column.accessor(row) ?? "");
}

/**
 * The student table: the shared table with the cells only students have.
 *
 * Warnings and groups as pills, the status with its New and Changed marks, the name with
 * what changed under it, and a history button on every row. Everything else — widths,
 * dragging, windowing, selection — is the table's, and the same for every list.
 */
export const StudentTable = memo(function StudentTable({
  rows,
  columns,
  layout,
  sort,
  selected,
  onSort,
  onResize,
  onReorder,
  onToggle,
  onToggleAll,
  onOpenHistory,
  onDismissWarning,
  highlightedId,
  onRowClick,
  empty,
}: {
  rows: StudentRow[];
  columns: StudentColumn[];
  layout: ColumnLayout;
  sort: Sort;
  selected: Set<string>;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
  onReorder: (id: string, beforeId: string) => void;
  /** `extend` is a shift-click: take everything between the last one and this one. */
  onToggle: (studentId: string, extend?: boolean) => void;
  onToggleAll: () => void;
  onOpenHistory: (row: StudentRow) => void;
  /** Cohorts page only: put a warning away until the record changes, or bring it back. */
  onDismissWarning?: (key: string, dismissed: boolean) => void;
  /** The row whose history is open beside the table, so the eye can find it. */
  highlightedId?: string;
  /** A click anywhere on the row that is not a control: the student's record. */
  onRowClick?: (row: StudentRow) => void;
  empty: string;
}) {
  const renderCell = useCallback(
    (row: StudentRow, column: StudentColumn) => studentCell(row, column, onDismissWarning),
    [onDismissWarning],
  );
  const rowActions = useCallback(
    (row: StudentRow) => (
      <button
        type="button"
        aria-label={`History for ${row.name || row.studentId}`}
        title="What the portal has said about this student"
        onClick={() => onOpenHistory(row)}
        className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
      >
        <Clock3 size={13} aria-hidden="true" />
      </button>
    ),
    [onOpenHistory],
  );

  return (
    <DataTable
      rows={rows}
      columns={columns}
      layout={layout}
      sort={sort}
      selected={selected}
      idOf={studentId}
      labelOf={studentLabel}
      cellText={cellText}
      renderCell={renderCell}
      rowActions={rowActions}
      onSort={onSort}
      onResize={onResize}
      onReorder={onReorder}
      onToggle={onToggle}
      onToggleAll={onToggleAll}
      highlightedId={highlightedId}
      onRowClick={onRowClick}
      empty={empty}
    />
  );
});

function studentId(row: StudentRow): string {
  return row.studentId;
}

function studentLabel(row: StudentRow): string {
  return row.name || row.studentId;
}

/** The cells only a student row has. Undefined hands the cell back to the table's text. */
function studentCell(
  row: StudentRow,
  column: StudentColumn,
  onDismissWarning?: (key: string, dismissed: boolean) => void,
) {
  if (column.id === "warnings") {
    if (!row.warnings.length) return <span className="text-[#98a2b3]">—</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {row.warnings.map((warning) => (
          <span
            key={warning.key}
            title={describeWarning(warning)}
            className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              warning.dismissed ? "bg-[#f2f4f7] text-[#98a2b3] line-through" : "bg-[#fff1e3] text-[#8a4b00]"
            }`}
          >
            <AlertTriangle size={11} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{describeWarning(warning)}</span>
            {onDismissWarning && warning.kind !== "no_baseline" ? (
              <button
                type="button"
                aria-label={`${warning.dismissed ? "Restore" : "Dismiss"}: ${describeWarning(warning)}`}
                title={warning.dismissed ? "Bring this warning back" : "Dismiss until this student's record changes again"}
                onClick={(event) => {
                  event.stopPropagation();
                  onDismissWarning(warning.key, !warning.dismissed);
                }}
                className="-mr-1 shrink-0 rounded-full p-0.5 hover:bg-white/70"
              >
                {warning.dismissed ? <RotateCcw size={10} aria-hidden="true" /> : <X size={10} aria-hidden="true" />}
              </button>
            ) : null}
          </span>
        ))}
      </span>
    );
  }

  if (column.id === "groups") {
    if (!row.groups.length) return <span className="text-[#98a2b3]">—</span>;
    return (
      <span className="flex flex-wrap gap-1" title={row.groups.join(" · ")}>
        {row.groups.map((group) => (
          <span key={group} className="inline-flex items-center rounded-full bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#344054]">
            {group}
          </span>
        ))}
      </span>
    );
  }

  if (column.id === "status") {
    return (
      <>
        {row.status === "not_in_portal" ? (
          <span className="inline-flex items-center rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">Not in portal</span>
        ) : (
          <span className="text-xs text-[#667085]">In portal</span>
        )}
        {row.isNew ? (
          <span className="ml-1 inline-flex items-center rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#256237]">New</span>
        ) : null}
        {row.changes.length ? (
          <span className="ml-1 inline-flex items-center rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#8a6d00]">Changed</span>
        ) : null}
      </>
    );
  }

  if (column.id === "portal:FULL_NAME") {
    return (
      <>
        <span className="font-semibold text-[#171717]">
          {row.name || <span className="font-normal text-[#98a2b3]">name not pulled yet</span>}
        </span>
        {row.changes.length ? (
          <span className="mt-0.5 block truncate text-xs font-normal text-[#8a6d00]" title={row.changes.join(" · ")}>
            {row.changes.join(" · ")}
          </span>
        ) : null}
      </>
    );
  }

  return undefined;
}
