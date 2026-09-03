import type { ReactNode } from "react";

/**
 * A dropdown with its name above it, and whatever acts on the thing chosen beside it.
 *
 * Two pickers sit together on the groups page — the cohort and the semester — and a bare
 * control gives no clue which is which. The label is not decoration here; it is the
 * difference between reading the page and guessing at it.
 *
 * The width is the choice's, not the layout's. A fixed column truncated "Foundation Year —
 * 2026-27" to something that could have been any cohort, which is the one thing a picker
 * must never do; so it sizes to what it is showing, with a floor so a short name still
 * looks like a control and a ceiling so a long one cannot push the page about.
 */
export function LabelledPicker({
  label,
  hint,
  beside,
  children,
}: {
  label: string;
  hint?: string;
  /** Buttons that act on whatever is chosen, kept out of the control's own width. */
  beside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
        {label}
        {hint ? <span className="ml-1.5 font-normal normal-case text-[#98a2b3]">{hint}</span> : null}
      </p>
      <div className="flex items-center gap-1.5">
        <div className="w-fit min-w-[12rem] max-w-[24rem]">{children}</div>
        {beside}
      </div>
    </div>
  );
}
