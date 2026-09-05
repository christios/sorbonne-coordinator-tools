import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CopyButton } from "@/components/CopyButton";
import { columnText, rowText } from "@/services/copyCells";
import { MIN_WIDTH, plainCellText, widthOf, type ColumnLayout, type GridColumn } from "@/services/studentColumns";

/** Rows mounted beyond each edge of the viewport, so a scroll has something to land on. */
const OVERSCAN = 20;
/** A row's height before one has been measured. */
const ROW_GUESS = 41;

/**
 * Which rows are in and around the scrolling box.
 *
 * The rows are thousands long, and mounting all of them took the best part of a second —
 * the pause between choosing a tab and seeing the table. Only the ones near the viewport
 * are mounted; spacer rows hold the scroll height so the bar stays honest.
 */
function useWindow(box: React.RefObject<HTMLElement | null>, total: number) {
  const [view, setView] = useState({ top: 0, height: 0 });
  const [rowHeight, setRowHeight] = useState(ROW_GUESS);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    // Read in the handler, not on a frame: a hidden tab pauses requestAnimationFrame, and
    // a window that only moves when a frame is painted comes back blank.
    const read = () => setView({ top: element.scrollTop, height: element.clientHeight });
    read();
    element.addEventListener("scroll", read, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", read);
      observer?.disconnect();
    };
  }, [box, total]);

  // Measured after the rows have been laid out, from the ones actually on screen.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const mounted = element.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-id]");
    if (mounted.length < 5) return;
    const first = mounted[0].getBoundingClientRect().top;
    const last = mounted[mounted.length - 1].getBoundingClientRect().bottom;
    const measured = (last - first) / mounted.length;
    if (measured > 8) setRowHeight((current) => (Math.abs(current - measured) > 0.5 ? measured : current));
  }, [box, view.top, view.height, total]);

  if (!view.height) return { start: 0, end: total, before: 0, after: 0 };
  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(total, Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN);
  return { start, end, before: start * rowHeight, after: (total - end) * rowHeight };
}

/** A gap under the table, so it does not sit flush against the bottom of the window. */
const BOTTOM_GAP = 16;

/**
 * Bound an element by whatever height is left below it.
 *
 * Measured rather than guessed: the toolbar above wraps at narrow widths and grows a row
 * when filters are added, so any fixed `100vh - something` is wrong as soon as the page
 * is not the shape it was written for.
 */
function useFillHeight() {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const fit = () => {
      const top = element.getBoundingClientRect().top;
      element.style.maxHeight = `${Math.max(240, window.innerHeight - top - BOTTOM_GAP)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (watcher && element.parentElement) watcher.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", fit);
      watcher?.disconnect();
    };
  }, []);

  return ref;
}

export type Sort = { key: string; ascending: boolean };

export type DataTableProps<T> = {
  rows: T[];
  columns: GridColumn<T>[];
  layout: ColumnLayout;
  sort: Sort;
  selected: Set<string>;
  /** The row's identity, which is what selection and highlighting hold. */
  idOf: (row: T) => string;
  /** What to call the row aloud: "Select Amira Haddad". */
  labelOf: (row: T) => string;
  /** A cell as text; the default reads the column's display or accessor. */
  cellText?: (row: T, column: GridColumn<T>) => string;
  /** A cell drawn specially — pills, a name with its changes. Undefined falls back to text. */
  renderCell?: (row: T, column: GridColumn<T>) => ReactNode | undefined;
  /** Buttons at the end of the row, beside the copy-row button. */
  rowActions?: (row: T) => ReactNode;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
  onReorder: (id: string, beforeId: string) => void;
  /** `extend` is a shift-click: take everything between the last one and this one. */
  onToggle: (id: string, extend?: boolean) => void;
  onToggleAll: () => void;
  /** The row whose detail is open beside the table, so the eye can find it. */
  highlightedId?: string;
  empty: string;
};

/**
 * The table: fixed column widths, dragged by their edges, scrolling sideways, windowed.
 *
 * Widths are set rather than negotiated by the browser, because a column a coordinator
 * has widened must stay where they put it when the data underneath changes. Once the
 * columns are wider than the page the table scrolls inside its own box, so the rest of
 * the screen stays where it is. Generic over the row: students were the first rows, the
 * portal's courses, teachers and registrations are the same table with other rows.
 */
export function DataTable<T>({
  rows,
  columns,
  layout,
  sort,
  selected,
  idOf,
  labelOf,
  cellText = plainCellText,
  renderCell,
  rowActions,
  onSort,
  onResize,
  onReorder,
  onToggle,
  onToggleAll,
  highlightedId,
  empty,
}: DataTableProps<T>) {
  const allShown = rows.length > 0 && rows.every((row) => selected.has(idOf(row)));
  const [dragging, setDragging] = useState("");
  const box = useFillHeight();
  const window_ = useWindow(box, rows.length);

  return (
    <section ref={box} className="always-scrollbar mt-3 min-h-[16rem] overflow-auto rounded-lg border border-[#d9dee7] bg-white">
      <table className="text-left text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-[#667085] shadow-[inset_0_-1px_0_#d9dee7]">
          <tr>
            <th scope="col" className="w-10 bg-white px-3 py-3">
              <input type="checkbox" aria-label="Select everyone shown" checked={allShown} onChange={onToggleAll} />
            </th>
            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                nextId={columns[index + 1]?.id ?? ""}
                width={widthOf(layout, column)}
                sort={sort}
                onSort={onSort}
                onResize={onResize}
                dragging={dragging}
                onDragging={setDragging}
                onReorder={onReorder}
                copy={() => columnText(rows.map((row) => cellText(row, column)))}
              />
            ))}
            <th scope="col" className="w-10 bg-white px-2 py-3" />
          </tr>
        </thead>
        <tbody>
          {window_.before > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 2} style={{ height: window_.before, padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {rows.slice(window_.start, window_.end).map((row) => {
            const id = idOf(row);
            return (
              <DataTableRow
                key={id}
                id={id}
                label={labelOf(row)}
                row={row}
                columns={columns}
                layout={layout}
                selected={selected.has(id)}
                cellText={cellText}
                renderCell={renderCell}
                rowActions={rowActions}
                onToggle={onToggle}
                highlighted={id === highlightedId}
              />
            );
          })}
          {window_.after > 0 ? (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 2} style={{ height: window_.after, padding: 0, border: 0 }} />
            </tr>
          ) : null}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 2} className="px-5 py-10 text-center text-sm text-[#667085]">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

type RowProps<T> = {
  id: string;
  label: string;
  row: T;
  columns: GridColumn<T>[];
  layout: ColumnLayout;
  selected: boolean;
  cellText: (row: T, column: GridColumn<T>) => string;
  renderCell?: (row: T, column: GridColumn<T>) => ReactNode | undefined;
  rowActions?: (row: T) => ReactNode;
  onToggle: (id: string, extend?: boolean) => void;
  highlighted: boolean;
};

/**
 * One row, and only re-rendered when that row changes.
 *
 * Selection arrives as a boolean rather than the set it came from, so choosing one row
 * does not invalidate every other row.
 */
function DataTableRowInner<T>({
  id,
  label,
  row,
  columns,
  layout,
  selected,
  cellText,
  renderCell,
  rowActions,
  onToggle,
  highlighted,
}: RowProps<T>) {
  const extend = useRef(false);

  return (
    <tr data-row-id={id} className={`border-t border-[#eef1f5] ${highlighted ? "bg-[#eef4fa] shadow-[inset_3px_0_0_#1f4e79]" : ""}`}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ${label}`}
          checked={selected}
          // Only `click` carries the modifier, and only `change` should decide anything.
          onClick={(event) => {
            extend.current = event.shiftKey;
          }}
          onChange={() => onToggle(id, extend.current)}
        />
      </td>
      {columns.map((column) => {
        const drawn = renderCell?.(row, column);
        const text = drawn === undefined ? cellText(row, column) : "";
        return (
          <td
            key={column.id}
            className="truncate px-4 py-2 text-[#344054]"
            style={{ width: widthOf(layout, column), minWidth: widthOf(layout, column), maxWidth: widthOf(layout, column) }}
          >
            {drawn === undefined ? <span title={text}>{text || "—"}</span> : drawn}
          </td>
        );
      })}
      <td className="w-10 whitespace-nowrap px-2 py-2 text-right">
        {rowActions?.(row)}
        <CopyButton label={`Copy the row for ${label}`} text={() => rowText(columns.map((column) => cellText(row, column)))} />
      </td>
    </tr>
  );
}

const DataTableRow = memo(DataTableRowInner) as typeof DataTableRowInner;

function HeaderCell<T>({
  column,
  width,
  sort,
  onSort,
  onResize,
  dragging,
  onDragging,
  onReorder,
  copy,
  nextId,
}: {
  column: GridColumn<T>;
  width: number;
  sort: Sort;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
  dragging: string;
  onDragging: (id: string) => void;
  onReorder: (id: string, beforeId: string) => void;
  copy: () => string;
  nextId: string;
}) {
  const active = sort.key === column.id;
  const [edge, setEdge] = useState<"" | "left" | "right">("");
  const cell = useRef<HTMLTableCellElement>(null);
  const lifted = dragging === column.id;

  const sideOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width) return "left";
    return event.clientX < box.left + box.width / 2 ? "left" : "right";
  };

  return (
    <th
      ref={cell}
      scope="col"
      className={`group relative overflow-hidden border-r border-[#e4e8ee] bg-white px-4 py-3 font-semibold last:border-r-0 ${lifted ? "opacity-40" : ""}`}
      style={{ width, minWidth: width, maxWidth: width }}
      onDragOver={(event) => {
        if (!dragging || lifted) return;
        event.preventDefault();
        setEdge(sideOf(event));
      }}
      onDragLeave={() => setEdge("")}
      onDrop={(event) => {
        event.preventDefault();
        const side = sideOf(event);
        setEdge("");
        if (dragging && !lifted) onReorder(dragging, side === "left" ? column.id : nextId);
        onDragging("");
      }}
    >
      {edge && dragging && !lifted ? (
        <span aria-hidden="true" className={`pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[#1f4e79] ${edge === "left" ? "left-0" : "right-0"}`} />
      ) : null}
      <span className="flex min-w-0 items-center gap-1">
        <span
          draggable
          role="button"
          tabIndex={-1}
          aria-label={`Drag ${column.displayName} to reorder`}
          onDragStart={(event) => {
            onDragging(column.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", column.id);
            if (cell.current) event.dataTransfer.setDragImage(cell.current, 24, 18);
          }}
          onDragEnd={() => onDragging("")}
          className="cursor-grab text-[#cbd5e1] opacity-40 transition-opacity hover:text-[#667085] group-hover:opacity-100"
        >
          <GripVertical size={12} aria-hidden="true" />
        </span>
        <button
          type="button"
          onClick={() => onSort(column.id)}
          aria-label={`Sort by ${column.displayName}`}
          className={`inline-flex min-w-0 flex-1 items-center gap-1 truncate ${active ? "text-[#1f4e79]" : ""}`}
        >
          <span className="truncate">{column.displayName}</span>
          {active ? (sort.ascending ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : null}
        </button>
        <CopyButton
          label={`Copy the ${column.displayName} column`}
          text={copy}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        />
      </span>
      <ResizeHandle id={column.id} name={column.displayName} width={width} onResize={onResize} />
    </th>
  );
}

function ResizeHandle({ id, name, width, onResize }: { id: string; name: string; width: number; onResize: (id: string, width: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const from = useRef({ x: 0, width });

  const start = (event: React.PointerEvent) => {
    event.preventDefault();
    if (dragging) return;
    from.current = { x: event.clientX, width };
    setDragging(true);
  };

  const move = useCallback(
    (event: PointerEvent) => {
      const next = from.current.width + (event.clientX - from.current.x);
      onResize(id, Math.max(MIN_WIDTH, next));
    },
    [id, onResize],
  );

  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, move]);

  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowRight") onResize(id, width + step);
    else if (event.key === "ArrowLeft") onResize(id, Math.max(MIN_WIDTH, width - step));
    else return;
    event.preventDefault();
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name}`}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={nudge}
      className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none border-r ${dragging ? "border-[#1f4e79]" : "border-transparent hover:border-[#cfe0ef]"}`}
    />
  );
}
