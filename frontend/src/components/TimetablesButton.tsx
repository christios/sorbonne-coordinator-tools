import { CalendarDays, Download, Loader2 } from "lucide-react";
import { useState } from "react";

import type { ExportOutcome } from "@/services/timetableExports";

/**
 * The one button every timetable PDF is asked for with: a CRN's, a course's, a ticked
 * handful of CRNs, teachers or students. On a selection bar it is a full button; on a
 * record's card, a small one beside the card's title.
 *
 * It says what it could not draw rather than handing over blank pages silently — who or
 * which CRN had no classes booked, or why the file could not be made.
 */
export function TimetablesButton({
  make,
  label = "Timetables",
  small = false,
}: {
  make: () => Promise<ExportOutcome>;
  label?: string;
  /** Beside a card's title rather than on a bar. */
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const run = async () => {
    setBusy(true);
    setSaid("");
    try {
      const { withoutClasses } = await make();
      if (withoutClasses.length) {
        const named = withoutClasses.slice(0, 3).join(", ");
        setSaid(`No classes booked for ${named}${withoutClasses.length > 3 ? ` and ${withoutClasses.length - 3} more` : ""}, so ${withoutClasses.length === 1 ? "it is" : "they are"} not on the grid.`);
      }
    } catch (failure) {
      setSaid((failure as Error).message || "The timetables could not be made.");
    } finally {
      setBusy(false);
    }
  };
  const Icon = small ? Download : CalendarDays;
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        title="The week grid for every teaching week of the semester, a page each, as a PDF"
        className={
          small
            ? "inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054] disabled:opacity-50"
        }
      >
        {busy ? <Loader2 size={small ? 13 : 15} className="animate-spin" aria-hidden="true" /> : <Icon size={small ? 13 : 15} aria-hidden="true" />}{" "}
        {label}
      </button>
      {said ? <span className="max-w-xs text-xs text-[#8a6116]">{said}</span> : null}
    </>
  );
}
