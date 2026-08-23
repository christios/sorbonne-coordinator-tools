import { ArrowDown, ArrowUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { StudentRow } from "@/services/rosterView";
import { widthOf, type ColumnLayout, type StudentColumn } from "@/services/studentColumns";

export type Sort = { key: string; ascending: boolean };

/**
 * The student table: fixed column widths, dragged by their edges, scrolling sideways.
 *
 * Widths are set rather than negotiated by the browser, because a column a coordinator
 * has widened must stay where they put it when the data underneath changes. Once the
 * columns are wider than the page the table scrolls inside its own box, so the rest of
 * the screen stays where it is.
 */
export function StudentTable({
  rows,
  columns,
  layout,
  sort,
  selected,
  onSort,
  onResize,
  onToggle,
  onToggleAll,
  empty,
}: {
  rows: StudentRow[];
  columns: StudentColumn[];
  layout: ColumnLayout;
  sort: Sort;
  selected: Set<string>;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
  onToggle: (studentId: string) => void;
  onToggleAll: () => void;
  empty: string;
}) {
  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.studentId));

  return (
    <section className="mt-3 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
      <table className="text-left text-sm" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
        <thead className="text-xs uppercase tracking-wide text-[#667085]">
          <tr>
            <th scope="col" className="w-10 px-3 py-3">
              <input
                type="checkbox"
                aria-label="Select everyone shown"
                checked={allShown}
                onChange={onToggleAll}
              />
            </th>
            {columns.map((column) => (
              <HeaderCell
                key={column.id}
                column={column}
                width={widthOf(layout, column)}
                sort={sort}
                onSort={onSort}
                onResize={onResize}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.studentId} className="border-t border-[#eef1f5]">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${row.name || row.studentId}`}
                  checked={selected.has(row.studentId)}
                  onChange={() => onToggle(row.studentId)}
                />
              </td>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className="truncate px-4 py-2 text-[#344054]"
                  style={{ width: widthOf(layout, column) }}
                >
                  <Cell row={row} column={column} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-5 py-10 text-center text-sm text-[#667085]">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

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

  if (column.id === "name") {
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
}: {
  column: StudentColumn;
  width: number;
  sort: Sort;
  onSort: (key: string) => void;
  onResize: (id: string, width: number) => void;
}) {
  const active = sort.key === column.id;

  return (
    <th
      scope="col"
      className="relative px-4 py-3 font-semibold"
      style={{ width }}
    >
      <button
        type="button"
        onClick={() => onSort(column.id)}
        aria-label={`Sort by ${column.displayName}`}
        className={`inline-flex max-w-full items-center gap-1 truncate ${active ? "text-[#1f4e79]" : ""}`}
      >
        {column.displayName}
        {active ? (
          sort.ascending ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : (
            <ArrowDown size={12} aria-hidden="true" />
          )
        ) : null}
      </button>
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
      onResize(column.id, Math.max(column.minWidth, next));
    },
    [column.id, column.minWidth, onResize],
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
    else if (event.key === "ArrowLeft") onResize(column.id, Math.max(column.minWidth, width - step));
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
