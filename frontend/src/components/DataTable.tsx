import { ArrowDown, ArrowUp } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { CopyButton } from "@/components/CopyButton";
import { useFillHeight } from "@/components/useFillHeight";
import { columnText, rowText } from "@/services/copyCells";
import { presetBlock, rowsForCopy } from "@/services/copyPresets";
import { plainCellText, widthOf, type ColumnLayout, type GridColumn } from "@/services/studentColumns";

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
  /** A click anywhere on the row that is not a control: opening the row's own screen. */
  onRowClick?: (row: T) => void;
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
 *
 * Every heading also carries a checkbox, shown while the pointer is on the column. Tick
 * one and the rest appear, so a handful of columns can be ticked and copied together —
 * the presets' copy without naming a preset: the same rows (the ticked ones, or everything
 * shown), the same cell text, in the order the table shows them. Nothing is kept; the
 * ticks go when the copy is done with.
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
  onRowClick,
  empty,
}: DataTableProps<T>) {
  const allShown = rows.length > 0 && rows.every((row) => selected.has(idOf(row)));
  // Columns ticked to be copied together. Only the shown ones count, so a column hidden
  // after being ticked neither copies nor keeps the bar open.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickedColumns = columns.filter((column) => picked.has(column.id));
  const picking = pickedColumns.length > 0;
  const pick = useCallback((id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const { ref: fitRef, box } = useFillHeight<HTMLElement>();
  const window_ = useWindow(box, rows.length);
  /*
   * The widths live on the `<col>` elements, not on every cell.
   *
   * They used to be an inline style on each `<th>` and each `<td>`, which meant a width
   * came out of React state and a drag re-rendered every mounted row on every pointer
   * move — sixty rows times a dozen columns, for each pixel. A `<colgroup>` under
   * `table-layout: fixed` sizes the whole column from one element, so the drag writes to
   * that element directly and React hears about it once, when the pointer comes up.
   */
  const cols = useRef<Record<string, HTMLTableColElement | null>>({});
  const headers = useRef<Record<string, HTMLTableCellElement | null>>({});
  const reorder = useReorder(columns, onReorder, headers);

  return (
    <>
      {picking ? (
        <div
          aria-label="Columns picked to copy"
          className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[#bcd3ea] bg-[#eef5fb] px-3 py-1.5 text-xs text-[#1f4e79]"
        >
          <span>
            {pickedColumns.map((column) => column.displayName).join(", ")}
            {selected.size ? ` · ${selected.size} selected ${selected.size === 1 ? "row" : "rows"}` : ` · every row shown`}
          </span>
          <CopyButton
            label={`Copy the ${pickedColumns.length} picked ${pickedColumns.length === 1 ? "column" : "columns"}`}
            text={() => presetBlock(pickedColumns, rowsForCopy(rows, selected, idOf), cellText, true)}
            className="border border-[#b7bec8] bg-white px-2 font-semibold"
          >
            Copy {pickedColumns.length} {pickedColumns.length === 1 ? "column" : "columns"}
          </CopyButton>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            className="rounded px-2 py-1 hover:bg-white"
          >
            Done
          </button>
        </div>
      ) : null}
    <section
      ref={fitRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && picking) setPicked(new Set());
      }}
      className="always-scrollbar relative mt-3 min-h-[16rem] overflow-auto overscroll-none rounded-lg border border-[#d9dee7] bg-white"
    >
      <table className="text-left text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        <colgroup>
          <col style={{ width: 40 }} />
          {columns.map((column) => (
            <col
              key={column.id}
              ref={(element) => {
                cols.current[column.id] = element;
              }}
              style={{ width: widthOf(layout, column) }}
            />
          ))}
          <col style={{ width: 44 }} />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-[#fbfcfe] text-xs font-semibold text-[#5b6675] shadow-[inset_0_-1px_0_#dfe4ec]">
          <tr>
            <th scope="col" className="bg-[#fbfcfe] px-3 py-2.5">
              <input type="checkbox" aria-label="Select everyone shown" checked={allShown} onChange={onToggleAll} />
            </th>
            {columns.map((column) => (
              <HeaderCell
                key={column.id}
                column={column}
                cell={(element) => {
                  headers.current[column.id] = element;
                }}
                sort={sort}
                onSort={onSort}
                onResize={onResize}
                liveWidth={(width) => {
                  const col = cols.current[column.id];
                  if (col) col.style.width = `${width}px`;
                }}
                widthNow={() => Math.round(headers.current[column.id]?.getBoundingClientRect().width ?? 0) || widthOf(layout, column)}
                fit={() => {
                  const measured = fitWidth(box.current, column.id);
                  if (measured) onResize(column.id, measured);
                }}
                reorder={reorder}
                copy={() => columnText(rows.map((row) => cellText(row, column)))}
                picked={picked.has(column.id)}
                picking={picking}
                onPick={() => pick(column.id)}
              />
            ))}
            <th scope="col" className="bg-[#fbfcfe] px-2 py-2.5" />
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
                selected={selected.has(id)}
                cellText={cellText}
                renderCell={renderCell}
                rowActions={rowActions}
                onToggle={onToggle}
                onRowClick={onRowClick}
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
    </>
  );
}

type RowProps<T> = {
  id: string;
  label: string;
  row: T;
  columns: GridColumn<T>[];
  selected: boolean;
  cellText: (row: T, column: GridColumn<T>) => string;
  renderCell?: (row: T, column: GridColumn<T>) => ReactNode | undefined;
  rowActions?: (row: T) => ReactNode;
  onToggle: (id: string, extend?: boolean) => void;
  onRowClick?: (row: T) => void;
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
  selected,
  cellText,
  renderCell,
  rowActions,
  onToggle,
  onRowClick,
  highlighted,
}: RowProps<T>) {
  const extend = useRef(false);

  return (
    <tr
      data-row-id={id}
      className={`border-t border-[#eef1f5] ${highlighted ? "bg-[#eef4fa] shadow-[inset_3px_0_0_#1f4e79]" : ""} ${
        onRowClick ? "cursor-pointer hover:bg-[#f8fafc]" : ""
      }`}
      onClick={
        onRowClick
          ? (event) => {
              // A click on a control is that control's; a drag to select text is not a click.
              const target = event.target as HTMLElement;
              if (target.closest("button, input, a, [role='button'], [role='separator']")) return;
              if (window.getSelection()?.toString()) return;
              onRowClick(row);
            }
          : undefined
      }
    >
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
          <td key={column.id} className="truncate px-3 py-2 text-[#344054]">
            <span data-cell={column.id} className="block truncate">
              {drawn === undefined ? <span title={text}>{text || "—"}</span> : drawn}
            </span>
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

/**
 * Reordering by pointer rather than by HTML5 drag-and-drop.
 *
 * The browser's own drag gives you a ghost image it renders on its own schedule, a
 * `dragover` that fires when it feels like it, and a drop that lands a frame late; on a
 * table of a dozen columns it reads as lag. Pointer events are the same three moments —
 * down, move, up — with nothing between us and the screen, which is what every table
 * worth using has moved to.
 *
 * A press is a sort until it has travelled far enough to be a drag, so the header stays
 * one target for both.
 */
const DRAG_THRESHOLD = 4;

type Reorder = {
  /** The column being carried, if any. */
  carrying: string;
  /** The column the drop indicator sits on, and which side of it. */
  over: { id: string; side: "left" | "right" } | null;
  begin: (event: React.PointerEvent, id: string) => void;
  /** True when the press turned into a drag, so the click that follows is not a sort. */
  moved: () => boolean;
};

function useReorder<T>(
  columns: GridColumn<T>[],
  onReorder: (id: string, beforeId: string) => void,
  headers: React.RefObject<Record<string, HTMLTableCellElement | null>>,
): Reorder {
  const [carrying, setCarrying] = useState("");
  const [over, setOver] = useState<{ id: string; side: "left" | "right" } | null>(null);
  /*
   * The target is held in a ref as well as in state.
   *
   * Where it goes is decided when the pointer comes up, and reading it out of a state
   * updater there meant reading a ref that the same handler was about to clear — React
   * runs the updater when it likes, and twice in development. The ref is the answer; the
   * state is only so the blue line can be drawn.
   */
  const target = useRef<{ id: string; side: "left" | "right" } | null>(null);
  const press = useRef({ id: "", x: 0, moved: false });
  const held = useRef({ columns, onReorder });
  held.current = { columns, onReorder };

  const begin = useCallback((event: React.PointerEvent, id: string) => {
    if (event.button !== 0) return;
    press.current = { id, x: event.clientX, moved: false };

    const move = (moving: PointerEvent) => {
      if (!press.current.id) return;
      if (!press.current.moved) {
        if (Math.abs(moving.clientX - press.current.x) < DRAG_THRESHOLD) return;
        press.current.moved = true;
        setCarrying(press.current.id);
      }
      /*
       * Whichever heading the pointer is over, and which half of it — the same reading the
       * eye makes of the blue line. Measured from the headings we already hold rather than
       * asked of the document: `elementFromPoint` answers for whatever is painted on top,
       * which during a drag is sometimes the indicator itself.
       */
      let found: { id: string; side: "left" | "right" } | null = null;
      for (const column of held.current.columns) {
        const cell = headers.current?.[column.id];
        if (!cell || column.id === press.current.id) continue;
        const box = cell.getBoundingClientRect();
        if (!box.width || moving.clientX < box.left || moving.clientX > box.right) continue;
        found = { id: column.id, side: moving.clientX < box.left + box.width / 2 ? "left" : "right" };
        break;
      }
      target.current = found;
      setOver(found);
    };

    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      const dropped = target.current;
      if (press.current.moved && dropped) {
        const order = held.current.columns.map((column) => column.id);
        const at = order.indexOf(dropped.id);
        const before = dropped.side === "left" ? dropped.id : (order[at + 1] ?? "");
        if (before !== press.current.id) held.current.onReorder(press.current.id, before);
      }
      target.current = null;
      setOver(null);
      setCarrying("");
      press.current = { ...press.current, id: "" };
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, []);

  return { carrying, over, begin, moved: () => press.current.moved };
}

/** Room for the cell's own padding, and for the heading's arrow and copy button besides. */
const CELL_PADDING = 26;
const HEADER_PADDING = 48;

/**
 * How wide a column would have to be to show everything in it.
 *
 * Measured from what is on screen — the heading and the rows the window has mounted, which
 * is what a spreadsheet measures too. Each is briefly laid out at `max-content` and read
 * back, because a cell that truncates is exactly as wide as its column and tells you
 * nothing about what is inside it, and one with room to spare would otherwise keep the
 * width it happens to have rather than shrinking to fit.
 *
 * Nothing measurable — a browser that lays nothing out — returns nought, and the caller
 * leaves the column alone rather than collapsing it.
 */
export function fitWidth(box: HTMLElement | null, id: string): number {
  if (!box) return 0;
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  let widest = 0;
  for (const [selector, padding] of [
    [`[data-cell="${escaped}"]`, CELL_PADDING],
    [`[data-header="${escaped}"]`, HEADER_PADDING],
  ] as const) {
    for (const part of box.querySelectorAll<HTMLElement>(selector)) {
      const held = { width: part.style.width, wrap: part.style.whiteSpace, flex: part.style.flex };
      part.style.width = "max-content";
      part.style.whiteSpace = "nowrap";
      // The heading's label is a flex item told to fill what is left, and `flex-basis`
      // beats any width we give it — so the flex has to come off as well, or every
      // measurement comes back as the width the column already has.
      part.style.flex = "none";
      widest = Math.max(widest, part.getBoundingClientRect().width + padding);
      part.style.width = held.width;
      part.style.whiteSpace = held.wrap;
      part.style.flex = held.flex;
    }
  }
  return widest ? Math.min(520, Math.ceil(widest)) : 0;
}

function HeaderCell<T>({
  column,
  cell,
  sort,
  onSort,
  onResize,
  liveWidth,
  widthNow,
  fit,
  reorder,
  copy,
  picked,
  picking,
  onPick,
}: {
  column: GridColumn<T>;
  cell: (element: HTMLTableCellElement | null) => void;
  sort: Sort;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
  /** Paint a width straight onto the column, without going through React. */
  liveWidth: (width: number) => void;
  /** What the column measures right now, which a drag starts from. */
  widthNow: () => number;
  fit: () => void;
  reorder: Reorder;
  copy: () => string;
  /** Ticked to be copied with the other ticked columns. */
  picked: boolean;
  /** Some column is ticked, so every heading shows its box rather than waiting for the pointer. */
  picking: boolean;
  onPick: () => void;
}) {
  const active = sort.key === column.id;
  const lifted = reorder.carrying === column.id;
  const indicator = reorder.over?.id === column.id ? reorder.over.side : "";

  return (
    <th
      ref={cell}
      scope="col"
      data-column={column.id}
      /*
       * The whole heading is the handle. It used to have a grip beside the label and a
       * copy button after it, which on a ninety-pixel column left about twenty pixels for
       * the name — "Sections" arrived as "Se…". Both are gone from the line: the heading
       * itself drags, and copying sits over the right-hand end only while the pointer is
       * on the column.
       */
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("[role='separator'], [data-copy]")) return;
        reorder.begin(event, column.id);
      }}
      className={`group relative select-none border-r border-[#e8ecf2] bg-[#fbfcfe] px-3 py-2.5 transition-colors last:border-r-0 hover:bg-[#f1f5fa] ${
        reorder.carrying ? "cursor-grabbing" : "cursor-grab"
      } ${lifted ? "opacity-40" : ""}`}
      title={column.displayName}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[#1f4e79] ${indicator === "left" ? "left-0" : "right-0"}`}
        />
      ) : null}

      <button
        type="button"
        onClick={() => {
          // A press that travelled was a drag, and a drag does not also sort.
          if (!reorder.moved()) onSort(column.id);
        }}
        /*
         * A mouse click must not leave the heading focused. The copy controls show while
         * anything in the heading has focus — so the keyboard can reach them — and a
         * click that parked focus on this button left them showing on that one column
         * until something else was clicked. Tab still focuses it; only the mouse does not.
         */
        onMouseDown={(event) => event.preventDefault()}
        aria-label={`Sort by ${column.displayName}`}
        className={`flex w-full min-w-0 items-center gap-1 text-left ${active ? "text-[#1f4e79]" : ""}`}
      >
        <span data-header={column.id} className="min-w-0 flex-1 truncate">
          {column.displayName}
        </span>
        {active ? (
          sort.ascending ? (
            <ArrowUp size={12} className="shrink-0" aria-hidden="true" />
          ) : (
            <ArrowDown size={12} className="shrink-0" aria-hidden="true" />
          )
        ) : (
          <ArrowDown size={12} className="shrink-0 text-[#c8d0da] opacity-0 group-hover:opacity-100" aria-hidden="true" />
        )}
      </button>

      <span
        data-copy
        // The same for the controls themselves: ticking or copying with the mouse must not
        // pin them open on this column once the pointer has moved on.
        onMouseDown={(event) => event.preventDefault()}
        // Clear of the sort arrow on the sorted column, so a click to sort is answered by
        // the arrow and not hidden behind the controls the same hover brought up.
        className={`absolute top-1/2 -translate-y-1/2 items-center gap-1 rounded bg-[#f1f5fa] shadow-[0_0_0_4px_#f1f5fa] ${
          active ? "right-7" : "right-2"
        } ${picking ? "inline-flex" : "hidden group-hover:inline-flex group-focus-within:inline-flex"}`}
      >
        <input
          type="checkbox"
          aria-label={`Pick the ${column.displayName} column to copy`}
          checked={picked}
          onChange={onPick}
          className="h-3.5 w-3.5 cursor-pointer accent-[#1f4e79]"
        />
        <CopyButton label={`Copy the ${column.displayName} column`} text={copy} />
      </span>

      <ResizeHandle
        id={column.id}
        name={column.displayName}
        widthNow={widthNow}
        liveWidth={liveWidth}
        onResize={onResize}
        onFit={fit}
      />
    </th>
  );
}

/**
 * The edge you pull to make a column wider.
 *
 * Wider than it looks — the hit area is eight pixels, the line one — because a two-pixel
 * target is a target you miss. While it is held, the width is written straight onto the
 * column's `<col>` element and React is told nothing; the state is set once, when the
 * pointer comes up. Double-click fits the column to what is in it.
 */
function ResizeHandle({
  id,
  name,
  widthNow,
  liveWidth,
  onResize,
  onFit,
}: {
  id: string;
  name: string;
  widthNow: () => number;
  liveWidth: (width: number) => void;
  onResize: (id: string, width: number) => void;
  onFit: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef({ x: 0, width: 0, at: 0, held: false });

  const start = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // A second press while the first is still held must not re-anchor the drag to the
    // width it has reached, or the column jumps by however far the pointer has come.
    if (from.current.held) return;
    from.current = { x: event.clientX, width: widthNow(), at: 0, held: true };
    setDragging(true);

    const move = (moving: PointerEvent) => {
      const next = Math.max(0, from.current.width + (moving.clientX - from.current.x));
      from.current.at = next;
      liveWidth(next);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      setDragging(false);
      from.current.held = false;
      // The one thing React is told about the whole drag.
      if (from.current.at) onResize(id, Math.round(from.current.at));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowRight") onResize(id, widthNow() + step);
    else if (event.key === "ArrowLeft") onResize(id, Math.max(0, widthNow() - step));
    else if (event.key === "Enter" || event.key === " ") onFit();
    else return;
    event.preventDefault();
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${name}`}
      title={`Drag to resize ${name}, or double-click to fit it to its contents`}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={nudge}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onFit();
      }}
      className="group/edge absolute -right-1 top-0 z-10 flex h-full w-2.5 cursor-col-resize touch-none select-none justify-center"
    >
      <span
        aria-hidden="true"
        className={`h-full w-0.5 transition-colors ${dragging ? "bg-[#1f4e79]" : "bg-transparent group-hover/edge:bg-[#9fbfdc]"}`}
      />
    </span>
  );
}
