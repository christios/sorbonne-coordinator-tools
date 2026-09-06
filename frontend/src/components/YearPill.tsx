/**
 * The academic year, wherever it is said.
 *
 * It used to be glued to the cohort's name with an em dash — "Foundation Year — 2026-27" —
 * which read as one long name and made every dropdown a line of prose to parse. The year
 * is a different kind of fact from the name: not what the cohort is called, but which run
 * of the year it belongs to, and it is the same handful of values over and over. So it is
 * shown as itself, and the shape of it does the separating the dash was doing.
 *
 * Outlined rather than filled, and set in figures: the solid pills in this application are
 * counts and states — how many students, how many flagged, retired, across cohorts — and a
 * year is neither. Two things beside a name should not look like the same kind of thing.
 */
export function YearPill({ year, className = "", muted = false }: { year: string; className?: string; muted?: boolean }) {
  if (!year) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0 text-[11px] font-semibold leading-[1.45] tracking-tight tabular-nums ${
        muted ? "border-[#e4e8ef] bg-white text-[#c8d0da]" : "border-[#c9d6e6] bg-[#f4f8fc] text-[#42648a]"
      } ${className}`}
    >
      <span className="sr-only">academic year </span>
      {year}
    </span>
  );
}
