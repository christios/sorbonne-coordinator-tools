import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { copyToClipboard } from "@/services/copyCells";

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
}: {
  label: string;
  /** Computed on click, because building it for every row on every render is wasteful. */
  text: () => string;
  className?: string;
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
        setState((await copyToClipboard(text())) ? "copied" : "failed");
      }}
      className={`rounded p-1 ${
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
    </button>
  );
}
