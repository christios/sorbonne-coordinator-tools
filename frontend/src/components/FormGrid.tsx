import { ReactNode } from "react";

/**
 * Twelve columns that line a card's fields up from one row to the next.
 *
 * `FieldRow` lets each field take the room its content asks for, which keeps a lone field
 * honest but leaves the rows of a busy card with edges that never meet: a box ends wherever
 * its neighbours' text did. Where a card holds several rows of fields, this grid gives every
 * field a column span instead, so their edges fall on the same lines, and the card decides
 * how many columns there are — measured by its own width (a container query), not the
 * window's, since the menu beside it takes a different share at each size.
 *
 * Fields placed in it take `size="full"` and a span from the caller, e.g.
 * `col-span-12 @md:col-span-6 @4xl:col-span-3`. Below `@md` every field has a row of its own.
 *
 * `align="start"` for a row of lists or anything whose height varies; the default lines the
 * boxes up on their bottom edge, so a label that wraps does not push its box below the rest.
 */
export function FormGrid({ children, align = "end", className = "" }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <div className="@container min-w-0">
      <div className={`grid grid-cols-12 gap-x-6 gap-y-4 ${align === "start" ? "items-start" : "items-end"} ${className}`}>{children}</div>
    </div>
  );
}
