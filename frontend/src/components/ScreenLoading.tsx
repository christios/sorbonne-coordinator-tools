import { Loader2 } from "lucide-react";

/**
 * The waiting state for a whole screen.
 *
 * A screen that answers a pending query with one line of text collapses the page
 * to that line and snaps back when the data lands — invisible against a local API,
 * a flash on every navigation against a real one. This keeps the page's height
 * while the query runs, so only the content changes.
 */
export function ScreenLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[60vh] max-w-[98rem] items-center justify-center px-4 text-sm text-[#667085]"
    >
      <span className="inline-flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> {label}
      </span>
    </div>
  );
}
