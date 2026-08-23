import { ArrowDown, ArrowUp, Clock3, GripVertical } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { columnText, rowText } from "@/services/copyCells";
import type { StudentRow } from "@/services/rosterView";
import { widthOf, type ColumnLayout, type StudentColumn } from "@/services/studentColumns";

/** What a cell says, which is what a copy of it should say too. */
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
  onToggle: (studentId: string) => void;
  onToggleAll: () => void;
  onOpenHistory: (row: StudentRow) => void;
  empty: string;
}) {
  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.studentId));
  const [dragging, setDragging] = useState("");

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
                dragging={dragging}
                onDragging={setDragging}
                onReorder={onReorder}
                copy={() => columnText(rows.map((row) => cellText(row, column)))}
              />
            ))}
            <th scope="col" className="w-10 px-2 py-3" />
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
  onToggle: (studentId: string) => void;
  onOpenHistory: (row: StudentRow) => void;
}) {
  return (
    <tr className="border-t border-[#eef1f5]">
      <td className="px-3 py-2">
        <input
          type="checkbox"
          aria-label={`Select ${row.name || row.studentId}`}
          checked={selected}
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
}) {
  const active = sort.key === column.id;
  const [over, setOver] = useState(false);

  return (
    <th
      scope="col"
      className={`group relative px-4 py-3 font-semibold ${
        over && dragging && dragging !== column.id ? "bg-[#e8edf3]" : ""
      } ${dragging === column.id ? "opacity-50" : ""}`}
      style={{ width }}
      onDragOver={(event) => {
        if (!dragging || dragging === column.id) return;
        // Without this the drop is refused and the cursor shows the "no" sign.
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (dragging && dragging !== column.id) onReorder(dragging, column.id);
        onDragging("");
      }}
    >
      <span className="flex items-center gap-1">
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
          }}
          onDragEnd={() => onDragging("")}
          className="cursor-grab text-[#cbd5e1] opacity-0 transition-opacity group-hover:opacity-100"
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
