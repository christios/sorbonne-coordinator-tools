import { CalendarDays, Download, Loader2 } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

import { SourceMark } from "@/components/DataTable";
import { usePortalChangesShown } from "@/services/portalChangesShown";
import type { ExportChoice, ExportOutcome } from "@/services/timetableExports";

/**
 * The one button every timetable PDF is asked for with: a CRN's, a course's, a ticked
 * handful of CRNs, teachers or students. On a selection bar it is a full button; on a
 * record's card, a small one beside the card's title.
 *
 * Pressed, it asks the one thing the calendars have a switch for: whether the file shows
 * what the registrar changed — the classes it took out, hollow and struck through, and the
 * ones it put in, marked ADDED — or only the classes that meet. The answer the calendars
 * are set to comes first.
 *
 * It says what it could not draw rather than handing over blank pages silently — who or
 * which CRN had no classes booked, or why the file could not be made.
 */
export function TimetablesButton({
  make,
  label = "Timetables",
  small = false,
}: {
  make: (choice: ExportChoice) => Promise<ExportOutcome>;
  label?: string;
  /** Beside a card's title rather than on a bar. */
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState("");
  const [shown] = usePortalChangesShown();
  const run = async (choice: ExportChoice) => {
    setAsking(false);
    setBusy(true);
    setSaid("");
    try {
      const { withoutClasses } = await make(choice);
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
  const choices = [
    {
      portalChanges: true,
      title: "With Portal changes",
      detail: "Classes the registrar removed, hollow and struck through; the ones it added, marked ADDED.",
    },
    { portalChanges: false, title: "Only what meets", detail: "The classes as the portal has them now." },
  ];
  // The way the calendars are set, first.
  const ordered = shown ? choices : [...choices].reverse();
  return (
    <>
      <Popover.Root open={asking} onOpenChange={setAsking}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={busy}
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
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={12}
            aria-label="What the PDF shows"
            className="z-[140] w-72 rounded-md border border-[#d9dee7] bg-white p-1.5 text-left shadow-lg"
          >
            <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
              What the PDF shows
              <SourceMark source="portal" />
            </p>
            {ordered.map((choice) => (
              <button
                key={choice.title}
                type="button"
                onClick={() => void run({ portalChanges: choice.portalChanges })}
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-[#f2f7fb] focus-visible:bg-[#f2f7fb] focus-visible:outline-none"
              >
                <span className="block text-sm font-semibold text-[#1f4e79]">{choice.title}</span>
                <span className="block text-xs text-[#667085]">{choice.detail}</span>
              </button>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {said ? <span className="max-w-xs text-xs text-[#8a6116]">{said}</span> : null}
    </>
  );
}
