import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/**
 * The department's record list: the one the Part-time Teachers page drew for itself, now
 * shared so that every page listing people one row each reads the same way.
 *
 * A white card; a toolbar along its top (filters, a count); a quiet heading in small
 * capitals that stays put while the rows scroll under it; one row per record, its columns
 * lining up down the list; and figures that carry a small label under them rather than a
 * unit squeezed in beside them.
 *
 * Every column has a width that does not depend on what is in it: each row is its own
 * grid, so a column sized by its content would come out wider on the heading than on the
 * rows, and every title would sit to the right of what it named.
 */

/** The card the list sits in: the width, and the rest of the height on a page that fills the screen. */
export const RECORD_CARD = "flex min-h-0 flex-1 flex-col rounded-lg border border-[#98a2b3] bg-white lg:overflow-hidden";

/** Along the top of the card: what narrows the list, and how many it shows. */
export function RecordToolbar({ children }: { children: ReactNode }) {
  return <div className="group/toolbar flex shrink-0 items-center gap-3 border-b border-[#98a2b3] px-4 py-2">{children}</div>;
}

/**
 * The rows under their heading, or what stands in for them while they load or when there
 * are none. `columns` is the grid every row and the heading share — classes, so a page
 * may set them from a breakpoint on and let a row stack on a phone; `grid` is the same as
 * a style, for a page whose columns are only known when it runs. `scrollX` lets a list
 * wider than the card scroll sideways under its heading rather than squeeze.
 */
export function RecordList({
  label,
  columns,
  grid,
  head,
  loading = false,
  loadingText = "Loading…",
  empty,
  isEmpty,
  scrollX = false,
  sortable = false,
  children,
}: {
  label: string;
  columns: string;
  grid?: CSSProperties;
  head: ReactNode;
  /** The heading holds `SortHead` buttons: kept for screen readers, which a plain heading isn't. */
  sortable?: boolean;
  loading?: boolean;
  loadingText?: string;
  empty: ReactNode;
  isEmpty: boolean;
  scrollX?: boolean;
  children: ReactNode;
}) {
  if (loading) {
    return <p className="grid min-h-60 flex-1 place-items-center p-8 text-center text-sm text-[#667085]">{loadingText}</p>;
  }
  if (isEmpty) {
    return <p className="grid min-h-60 flex-1 place-items-center p-12 text-center text-sm text-[#667085]">{empty}</p>;
  }
  return (
    <div role="list" aria-label={label} className={`min-h-0 flex-1 lg:overflow-y-auto ${scrollX ? "overflow-x-auto" : ""}`}>
      <div
        aria-hidden={sortable ? undefined : "true"}
        style={grid}
        className={`${columns} sticky top-0 z-20 hidden border-b-2 border-[#98a2b3] bg-[#eef2f7] py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#344054] sm:grid`}
      >
        {head}
      </div>
      {children}
    </div>
  );
}

/** How a list is sorted: on which column, and which way. */
export type RecordSort<K extends string> = { key: K; ascending: boolean };

/**
 * A column's heading that sorts the list on it (23 Nov 2026): pressed, the list goes by that
 * column; pressed again, the other way. The arrow says which column and which way, and a faint
 * pair of arrows on hover says the others can be pressed too.
 */
export function SortHead<K extends string>({
  label,
  column,
  sort,
  onSort,
  firstDescending = false,
}: {
  label: string;
  column: K;
  sort: RecordSort<K> | null;
  onSort: (sort: RecordSort<K>) => void;
  /** Most first on the first press, as for a count: who has the most hours blocked. */
  firstDescending?: boolean;
}) {
  const active = sort?.key === column;
  const Arrow = !active ? ArrowUpDown : sort.ascending ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort({ key: column, ascending: active ? !sort.ascending : !firstDescending })}
      aria-label={`Sort by ${label}${active ? `, ${sort.ascending ? "ascending" : "descending"} now` : ""}`}
      className={`group/sort inline-flex min-w-0 items-center gap-1 text-left uppercase tracking-wide hover:text-[#1f4e79] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4e79] ${
        active ? "text-[#1f4e79]" : ""
      }`}
    >
      <span className="truncate">{label}</span>
      <Arrow
        size={12}
        aria-hidden="true"
        className={`shrink-0 ${active ? "" : "opacity-0 transition-opacity group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60"}`}
      />
    </button>
  );
}

/** One record's row, on the list's grid. */
export function RecordRow({
  columns,
  grid,
  selected = false,
  children,
}: {
  columns: string;
  grid?: CSSProperties;
  selected?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="listitem"
      style={grid}
      className={`${columns} group grid border-b border-[#aab4c1] py-2.5 transition-colors hover:bg-[#f4f7fb] ${selected ? "bg-[#eef4fa]" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * A figure with what it is under it, in small capitals: "92 h" over TEACHING. A figure of
 * nothing is drawn lighter, so the eye runs down a column to the ones that count — but
 * never so light it cannot be read: everything here keeps to 4.5:1 or more on white (the
 * heading 10:1, the labels 7.7:1, a figure of nothing 5:1), and the lines between rows are
 * drawn dark enough to follow a row across the page.
 */
export function LabelledFigure({
  value,
  label,
  tone = "text-[#344054]",
  faint = false,
  className = "",
}: {
  value: ReactNode;
  label?: ReactNode;
  tone?: string;
  /** Nothing to count: the figure is there to hold the column, not to be read. */
  faint?: boolean;
  className?: string;
}) {
  return (
    <span className={`flex min-w-0 flex-col leading-tight ${className}`}>
      <span className={`text-sm font-semibold tabular-nums ${faint ? "text-[#667085]" : tone}`}>{value}</span>
      {label ? <span title={typeof label === "string" ? label : undefined} className="truncate text-[11px] font-semibold uppercase text-[#475467]">{label}</span> : null}
    </span>
  );
}
