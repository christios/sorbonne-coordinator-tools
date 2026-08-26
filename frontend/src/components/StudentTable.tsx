import { ArrowDown, ArrowUp, Clock3, GripVertical } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { columnText, rowText } from "@/services/copyCells";
import type { StudentRow } from "@/services/rosterView";
import { MIN_WIDTH, widthOf, type ColumnLayout, type StudentColumn } from "@/services/studentColumns";

/** What a cell says, which is what a copy of it should say too. */
/** A gap under the table, so it does not sit flush against the bottom of the window. */
const BOTTOM_GAP = 16;

/**
 * Bound an element by whatever height is left below it.
 *
 * Measured rather than guessed: the toolbar above wraps at narrow widths and grows a row
 * when filters are added, so any fixed `100vh - something` is wrong as soon as the page
 * is not the shape it was written for — and being wrong the generous way puts the
 * sideways scrollbar below the fold, which is the whole thing this is here to prevent.
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
    // The toolbar above can change height without the window changing at all. Guarded
    // because not every environment this renders in has ResizeObserver — jsdom does not,
    // and an exception here would take the whole table down with it.
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (watcher && element.parentElement) watcher.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", fit);
      watcher?.disconnect();
    };
  }, []);

  return ref;
}

export function cellText(row: StudentRow, column: StudentColumn): string {
  if (column.id === "status") {
    return row.status === "not_in_portal" ? "Not in portal" : "In portal";
  }
  return column.display ? column.display(row) : String(column.accessor(row) ?? "");
}

export type Sort = { key: string; ascending: boolean };

/**
 * The student table: fixed column widths, dragged by their edges, scrolling sideways.
 *
 * Widths are set rather than negotiated by the browser, because a column a coordinator
 * has widened must stay where they put it when the data underneath changes. Once the
 * columns are wider than the page the table scrolls inside its own box, so the rest of
 * the screen stays where it is.
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
  empty: string;
}) {
  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.studentId));
  const [dragging, setDragging] = useState("");
  const box = useFillHeight();

  return (
    /*
     * One scrolling box, tall enough to fill what is left of the window and no taller.
     *
     * The rows are thousands long, so a table that grows with them puts the sideways
     * scrollbar thousands of rows below the screen. Bounding the box keeps that scrollbar
     * where the mouse is, and the header sticks to the top so a column can still be told
     * apart after scrolling.
     */
    <section ref={box} className="always-scrollbar mt-3 min-h-[16rem] overflow-auto rounded-lg border border-[#d9dee7] bg-white">
      <table className="text-left text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-[#667085] shadow-[inset_0_-1px_0_#d9dee7]">
          <tr>
            <th scope="col" className="w-10 bg-white px-3 py-3">
              <input
                type="checkbox"
                aria-label="Select everyone shown"
                checked={allShown}
                onChange={onToggleAll}
              />
            </th>
            {columns.map((column, index) => (
              <HeaderCell
                key={column.id}
                column={column}
                // Dropping on the right half means "after me", which is "before whoever
                // comes next" — and nothing, at the end.
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
          {rows.map((row) => (
            <StudentTableRow
              key={row.studentId}
              row={row}
              columns={columns}
              layout={layout}
              selected={selected.has(row.studentId)}
              onToggle={onToggle}
              onOpenHistory={onOpenHistory}
            />
          ))}
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
});

/**
 * One row, and only re-rendered when that row changes.
 *
 * The table is thousands of rows long, so anything that re-renders all of them — opening
 * the history panel, say — is felt as a pause. Selection arrives as a boolean rather than
 * the set it came from, so choosing one student does not invalidate every other row.
 */
const StudentTableRow = memo(function StudentTableRow({
  row,
  columns,
  layout,
  selected,
  onToggle,
  onOpenHistory,
}: {
  row: StudentRow;
  columns: StudentColumn[];
  layout: ColumnLayout;
  selected: boolean;
  onToggle: (studentId: string, extend?: boolean) => void;
  onOpenHistory: (row: StudentRow) => void;
}) {
  const extend = useRef(false);

  return (
    <tr className="border-t border-[#eef1f5]">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ${row.name || row.studentId}`}
          checked={selected}
          /*
           * Shift-click reaches back to the last row that was ticked.
           *
           * Only `click` carries the modifier, and only `change` should decide anything —
           * acting on both meant the range landed and was then toggled back off by the
           * change that followed it. So click records the intent and change acts on it.
           */
          onClick={(event) => {
            extend.current = event.shiftKey;
          }}
          onChange={() => onToggle(row.studentId, extend.current)}
        />
      </td>
      {columns.map((column) => (
        <td
          key={column.id}
          className="truncate px-4 py-2 text-[#344054]"
          style={{
            width: widthOf(layout, column),
            minWidth: widthOf(layout, column),
            maxWidth: widthOf(layout, column),
          }}
        >
          <Cell row={row} column={column} />
        </td>
      ))}
      <td className="w-10 whitespace-nowrap px-2 py-2 text-right">
        <button
          type="button"
          aria-label={`History for ${row.name || row.studentId}`}
          title="What the portal has said about this student"
          onClick={() => onOpenHistory(row)}
          className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
        >
          <Clock3 size={13} aria-hidden="true" />
        </button>
        <CopyButton
          label={`Copy the row for ${row.name || row.studentId}`}
          text={() => rowText(columns.map((column) => cellText(row, column)))}
        />
      </td>
    </tr>
  );
});

function Cell({ row, column }: { row: StudentRow; column: StudentColumn }) {
  if (column.id === "status") {
    return (
      <>
        {row.status === "not_in_portal" ? (
          <span className="inline-flex items-center rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">
            Not in portal
          </span>
        ) : (
          <span className="text-xs text-[#667085]">In portal</span>
        )}
        {row.isNew ? (
          <span className="ml-1 inline-flex items-center rounded-full bg-[#eaf4ec] px-2 py-0.5 text-xs font-semibold text-[#256237]">
            New
          </span>
        ) : null}
        {row.changes.length ? (
          <span className="ml-1 inline-flex items-center rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#8a6d00]">
            Changed
          </span>
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

  const text = column.display ? column.display(row) : String(column.accessor(row) ?? "");
  return <span title={text}>{text || "—"}</span>;
}

function HeaderCell({
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
  column: StudentColumn;
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
  /*
   * Which edge the column would land on, or "" when it is not over this one.
   *
   * Tinting the whole header said only "something is happening here"; it did not say
   * whether the column would end up to the left or the right of it, which is the only
   * thing a person dragging actually wants to know.
   */
  const [edge, setEdge] = useState<"" | "left" | "right">("");
  const cell = useRef<HTMLTableCellElement>(null);
  const lifted = dragging === column.id;

  const sideOf = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    // No geometry to read — a headless renderer, or a drop event carrying no position.
    // "Before the column you dropped on" is the older, unsurprising answer.
    if (!box.width) return "left";
    return event.clientX < box.left + box.width / 2 ? "left" : "right";
  };

  return (
    <th
      ref={cell}
      scope="col"
      /*
       * `overflow-hidden` is what lets a column be dragged narrower than its own heading.
       * Without it the header's content — grip, label, copy button — sets a floor, and the
       * handle simply stops moving at a width nobody chose.
       */
      className={`group relative overflow-hidden border-r border-[#e4e8ee] bg-white px-4 py-3 font-semibold last:border-r-0 ${
        lifted ? "opacity-40" : ""
      }`}
      style={{ width, minWidth: width, maxWidth: width }}
      onDragOver={(event) => {
        if (!dragging || lifted) return;
        // Without this the drop is refused and the cursor shows the "no" sign.
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
      {/* Where it will land: a line on the edge it would be dropped against. */}
      {edge && dragging && !lifted ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[#1f4e79] ${
            edge === "left" ? "left-0" : "right-0"
          }`}
        />
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
            // Firefox starts no drag at all unless something is set here.
            event.dataTransfer.setData("text/plain", column.id);
            // Drag the whole header, not the grip: what moves should look like what moves.
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
          {active ? (
            sort.ascending ? (
              <ArrowUp size={12} aria-hidden="true" />
            ) : (
              <ArrowDown size={12} aria-hidden="true" />
            )
          ) : null}
        </button>
        <CopyButton
          label={`Copy the ${column.displayName} column`}
          text={copy}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
        />
      </span>
      <ResizeHandle column={column} width={width} onResize={onResize} />
    </th>
  );
}

/**
 * The draggable edge of a column.
 *
 * It listens on the window rather than on itself, so the drag survives the pointer
 * leaving the two-pixel target — which it always does.
 */
function ResizeHandle({
  column,
  width,
  onResize,
}: {
  column: StudentColumn;
  width: number;
  onResize: (id: string, width: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const from = useRef({ x: 0, width });

  const start = (event: React.PointerEvent) => {
    event.preventDefault();
    // A second press while already dragging would re-anchor to the width reached so far,
    // and the drag would compound instead of tracking the pointer.
    if (dragging) return;
    from.current = { x: event.clientX, width };
    setDragging(true);
  };

  const move = useCallback(
    (event: PointerEvent) => {
      const next = from.current.width + (event.clientX - from.current.x);
      onResize(column.id, Math.max(MIN_WIDTH, next));
    },
    [column.id, onResize],
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

  /** The keyboard way to do the same thing, since a two-pixel drag target has none. */
  const nudge = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === "ArrowRight") onResize(column.id, width + step);
    else if (event.key === "ArrowLeft") onResize(column.id, Math.max(MIN_WIDTH, width - step));
    else return;
    event.preventDefault();
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${column.displayName}`}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={nudge}
      className={`absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none select-none border-r ${
        dragging ? "border-[#1f4e79]" : "border-transparent hover:border-[#cfe0ef]"
      }`}
    />
  );
}
