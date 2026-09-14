import { ReactNode } from "react";

/**
 * A row of fields that runs from one margin to the other.
 *
 * Each field asks for the width its content needs, which decides how many fit; what is left
 * over is shared out between them so the row reaches both edges rather than trailing off.
 * A row that does not fit wraps, and on a phone every field ends up on its own line.
 *
 * `align="start"` for a row of lists or anything whose height varies — otherwise the boxes
 * line up on their bottom edge, so a field whose name needs two lines does not drag its box
 * below its neighbours'.
 */
export function FieldRow({
  children,
  align = "end",
  className = "",
}: {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap gap-x-6 gap-y-4 ${align === "start" ? "items-start" : "items-end"} ${className}`}
    >
      {children}
    </div>
  );
}
