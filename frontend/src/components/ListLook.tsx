import { Search } from "lucide-react";

/*
 * The bar over a people list, in Part-time Teachers' look: which rows (segments with their
 * counts), the search, the bar's buttons, and how many rows show. The list itself is the
 * department's Record list.
 */

/** A row of two or three choices, one of them on: a list's view, or which of its rows. */
export const SEGMENTS =
  "inline-flex h-10 shrink-0 items-center gap-0.5 rounded-md border border-[#d0d5dd] bg-white p-1";

export function segment(on: boolean) {
  return `inline-flex h-full items-center gap-1.5 rounded px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7e5f3] ${
    on ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa] hover:text-[#344054]"
  }`;
}

export function SegmentCount({ value, on }: { value: number; on: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 py-px text-xs tabular-nums ${
        on ? "bg-white text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"
      }`}
    >
      {value}
    </span>
  );
}

/** A row's small square buttons: the jobs everybody knows by their icon, named on hover. */
export const ICON_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-md border border-[#d0d5dd] bg-white text-[#475467] hover:border-[#b7bec8] hover:bg-[#f2f7fb] hover:text-[#1f4e79] disabled:border-[#eef1f5] disabled:text-[#d0d5dd] disabled:hover:bg-white";

/** The top bar's secondary button: Settings, New folder. */
export const BAR_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50";

/** The search in a list's top bar: takes what the row has left, up to its own width. */
export function ListSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block min-w-40 flex-1 sm:max-w-64">
      <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
      <input
        aria-label={label}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white pl-10 pr-3 text-sm"
      />
    </label>
  );
}

/** "12 of 47", or "47" when nothing is filtered out. */
export function ShownCount({ shown, of }: { shown: number; of: number }) {
  return <span className="shrink-0 text-xs tabular-nums text-[#475467]">{shown === of ? `${of}` : `${shown} of ${of}`}</span>;
}
