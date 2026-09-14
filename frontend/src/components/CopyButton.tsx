import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { copyTable, copyToClipboard } from "@/services/copyCells";

/**
 * What a copy is: a run of text, or a block of cells that is really a table.
 *
 * The difference is not decoration. A block goes on the clipboard as HTML as well, so it
 * lands in an email as a table; a single row or a single column has nothing a table would
 * add. Saying which at the call site is the only place that knows.
 */
export type Copyable = string | { headers: string[] | null; rows: string[][] };

/**
 * Copy something to the clipboard, and say so.
 *
 * The tick is the whole point: a copy that works looks exactly like a copy that silently
 * failed, and there is no way to check without leaving the page.
 */
export function CopyButton({
  label,
  text,
  className = "",
  children,
}: {
  label: string;
  /** Computed on click, because building it for every row on every render is wasteful. */
  text: () => Copyable;
  className?: string;
  /** Words beside the icon, for the one place an icon alone would not say enough. */
  children?: ReactNode;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const settle = setTimeout(() => setState("idle"), 1_500);
    return () => clearTimeout(settle);
  }, [state]);

  return (
    <button
      type="button"
      aria-label={label}
      title={state === "failed" ? "This browser would not let us copy" : label}
      onClick={async (event) => {
        event.stopPropagation();
        const value = text();
        const done = typeof value === "string" ? await copyToClipboard(value) : await copyTable(value.headers, value.rows);
        setState(done ? "copied" : "failed");
      }}
      className={`inline-flex items-center gap-1.5 rounded p-1 ${
        state === "copied"
          ? "text-[#256237]"
          : state === "failed"
            ? "text-[#a6292f]"
            : "text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
      } ${className}`}
    >
      {state === "copied" ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      {children}
    </button>
  );
}
