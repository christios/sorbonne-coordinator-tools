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
export const RECORD_CARD = "flex min-h-0 flex-1 flex-col rounded-lg border border-[#d9dee7] bg-white lg:overflow-hidden";

/** Along the top of the card: what narrows the list, and how many it shows. */
export function RecordToolbar({ children }: { children: ReactNode }) {
  return <div className="group/toolbar flex shrink-0 items-center gap-3 border-b border-[#e5e7eb] px-4 py-2">{children}</div>;
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
  children,
}: {
  label: string;
  columns: string;
  grid?: CSSProperties;
  head: ReactNode;
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
        aria-hidden="true"
        style={grid}
        className={`${columns} sticky top-0 z-20 hidden border-b border-[#e5e7eb] bg-[#f8fafc] py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#475467] sm:grid`}
      >
        {head}
      </div>
      {children}
    </div>
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
      className={`${columns} group grid border-b border-[#eef1f5] py-2.5 transition-colors hover:bg-[#fafbfd] ${selected ? "bg-[#f5f9fd]" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * A figure with what it is under it, in small capitals: "92 h" over TEACHING. A figure of
 * nothing is drawn lighter, so the eye runs down a column to the ones that count — but
 * never so light it cannot be read: the heading, the labels and a figure of nothing all
 * keep to a contrast of at least 3.5:1 on white, the labels and heading 4.5:1 and more.
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
      <span className={`text-sm font-semibold tabular-nums ${faint ? "text-[#7d8799]" : tone}`}>{value}</span>
      {label ? <span className="whitespace-nowrap text-[11px] font-semibold uppercase text-[#667085]">{label}</span> : null}
    </span>
  );
}
