import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ColumnMenu } from "@/components/ColumnMenu";
import { CopyButton } from "@/components/CopyButton";
import { CopyPresetMenu } from "@/components/CopyPresetMenu";
import { DataTable, type Sort } from "@/components/DataTable";
import { TableFilterBar } from "@/components/TableFilterBar";
import { copyToClipboard, tableText } from "@/services/copyCells";
import { presetText, rowsForCopy } from "@/services/copyPresets";
import {
  loadLayout,
  optionsFor,
  plainCellText,
  reorderColumn,
  resizeColumn,
  saveLayout,
  sortByColumn,
  visibleColumns,
  type ColumnLayout,
  type GridColumn,
} from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";

/**
 * The student table's whole working surface, for any list.
 *
 * Filters as chips, a search over every shown column, the column picker, copy presets,
 * copy the table, and the table itself with its dragged widths and windowed rows. The
 * arrangement is kept per list in this browser, under the key the page gives, so a
 * course table and a teacher table each remember their own.
 */
export function ListGrid<T>({
  columns,
  rows,
  idOf,
  labelOf,
  layoutKey,
  presetKey,
  shown,
  initialSort,
  searchLabel = "Search every column",
  noun = "rows",
  empty,
  toolbar,
  selected,
  onSelectedChange,
  renderCell,
  rowActions,
  onRowClick,
}: {
  columns: GridColumn<T>[];
  rows: T[];
  idOf: (row: T) => string;
  labelOf: (row: T) => string;
  /** localStorage key for this list's column arrangement. */
  layoutKey: string;
  /** localStorage key for this list's copy presets. */
  presetKey: string;
  /** Column ids shown by default; the rest wait in the column picker. */
  shown: string[];
  initialSort?: Sort;
  searchLabel?: string;
  /** What a row is called in the count line: "courses", "teachers". */
  noun?: string;
  empty: string;
  /** Controls to sit between the filter chips and the search box. */
  toolbar?: ReactNode;
  /** Selection, when the page wants to act on it; the grid keeps its own otherwise. */
  selected?: Set<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  renderCell?: (row: T, column: GridColumn<T>) => ReactNode | undefined;
  rowActions?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
}) {
  const [layout, setLayout] = useState<ColumnLayout | null>(null);
  const [filters, setFilters] = useState<FilterModel[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(initialSort ?? { key: columns[0]?.id ?? "", ascending: true });
  const [ownSelected, setOwnSelected] = useState<Set<string>>(new Set());
  const chosen = selected ?? ownSelected;
  const choose = useCallback(
    (next: Set<string> | ((current: Set<string>) => Set<string>)) => {
      const resolved = typeof next === "function" ? next(selected ?? ownSelected) : next;
      if (onSelectedChange) onSelectedChange(resolved);
      else setOwnSelected(resolved);
    },
    [onSelectedChange, selected, ownSelected],
  );

  useEffect(() => setLayout(loadLayout(columns, layoutKey, shown)), [columns, layoutKey, shown]);
  const layoutRef = useRef<ColumnLayout | null>(null);
  layoutRef.current = layout;
  const arrange = useCallback(
    (next: ColumnLayout) => {
      setLayout(next);
      saveLayout(next, layoutKey);
    },
    [layoutKey],
  );

  const shownColumns = useMemo(() => (layout ? visibleColumns(layout, columns) : []), [layout, columns]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? rows.filter((row) => shownColumns.some((column) => plainCellText(row, column).toLowerCase().includes(needle)))
      : rows;
    return sortByColumn(applyFilters(searched, shownColumns, filters), sort, columns, idOf);
  }, [rows, shownColumns, filters, sort, query, columns, idOf]);
  const visibleRef = useRef<T[]>([]);
  visibleRef.current = visible;

  const anchor = useRef("");
  const toggle = useCallback(
    (id: string, extend = false) => {
      const ids = visibleRef.current.map(idOf);
      const from = ids.indexOf(anchor.current);
      const to = ids.indexOf(id);
      if (extend && from !== -1 && to !== -1) {
        const [start, end] = from < to ? [from, to] : [to, from];
        choose((current) => new Set([...current, ...ids.slice(start, end + 1)]));
        return;
      }
      anchor.current = id;
      choose((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [choose, idOf],
  );
  const toggleAll = useCallback(() => {
    choose((current) => {
      const ids = visibleRef.current.map(idOf);
      const everyShown = ids.length > 0 && ids.every((id) => current.has(id));
      return everyShown ? new Set<string>() : new Set(ids);
    });
  }, [choose, idOf]);
  const sortBy = useCallback((key: string) => {
    setSort((current) => ({ key, ascending: current.key === key ? !current.ascending : true }));
  }, []);
  const resize = useCallback(
    (id: string, width: number) => {
      if (layoutRef.current) arrange(resizeColumn(layoutRef.current, id, width, columns));
    },
    [arrange, columns],
  );
  const reorder = useCallback(
    (id: string, beforeId: string) => {
      if (layoutRef.current) arrange(reorderColumn(layoutRef.current, id, beforeId));
    },
    [arrange],
  );

  if (!layout) return null;

  return (
    <div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TableFilterBar
          columns={shownColumns}
          filters={filters}
          optionsFor={(column) => optionsFor(rows, column)}
          onChange={setFilters}
        />
        {toolbar}
        <div className="ml-auto">
          <CopyPresetMenu
            columns={columns}
            storageKey={presetKey}
            onCopy={async (picked, withHeader) => {
              if (picked.length === 0) return false;
              return copyToClipboard(presetText(picked, rowsForCopy(visible, chosen, idOf), plainCellText, withHeader));
            }}
          />
        </div>
        <label className="relative block w-full sm:w-60">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input
            aria-label={searchLabel}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every column"
            className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <ColumnMenu layout={layout} columns={columns} onChange={arrange} />
        <CopyButton
          label="Copy the whole table"
          text={() =>
            tableText(
              shownColumns.map((column) => column.displayName),
              visible.map((row) => shownColumns.map((column) => plainCellText(row, column))),
            )
          }
          className="border border-[#b7bec8] bg-white p-2 hover:bg-[#f8fafc]"
        />
      </div>

      <p className="mt-2 text-xs text-[#98a2b3]">
        {rows.length} {noun}
        {visible.length !== rows.length ? `, ${visible.length} shown` : ""}
        {chosen.size ? ` · ${chosen.size} selected` : ""}
      </p>

      <DataTable
        rows={visible}
        columns={shownColumns}
        layout={layout}
        sort={sort}
        selected={chosen}
        idOf={idOf}
        labelOf={labelOf}
        renderCell={renderCell}
        rowActions={rowActions}
        onRowClick={onRowClick}
        onSort={sortBy}
        onResize={resize}
        onReorder={reorder}
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={empty}
      />
    </div>
  );
}

/** A pill for a yes/no state, the way the roster marks "Not in portal". */
export function StatePill({ tone, children }: { tone: "good" | "bad" | "muted" | "accent"; children: ReactNode }) {
  const look =
    tone === "good"
      ? "bg-[#eaf4ec] text-[#2f6b3d]"
      : tone === "bad"
        ? "bg-[#fdf3f3] text-[#a6292f]"
        : tone === "accent"
          ? "bg-[#e8edf3] text-[#1f4e79]"
          : "bg-[#eef1f5] text-[#344054]";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${look}`}>{children}</span>;
}
