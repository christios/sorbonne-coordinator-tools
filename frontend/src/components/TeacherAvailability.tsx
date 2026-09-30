/**
 * Who is free when, on the Active teachers list: the window being asked about, the answer
 * for each teacher, and the counts that narrow the list to one answer.
 *
 * The answering is services/teacherAvailability, and what it is answered from is read by
 * useTeacherAvailability; these are only the controls and the cell.
 */

import { Clock, X } from "lucide-react";
import { Popover, Tooltip } from "radix-ui";
import { useState } from "react";

import { StatePill } from "@/components/ListGrid";
import {
  STATE_WORDS,
  clashShort,
  clashWords,
  describeWindow,
  freedWords,
  unknownShort,
  unknownWords,
  windowProblem,
  type Availability,
  type AvailabilityState,
  type FreeWindow,
} from "@/services/teacherAvailability";
import { DAY_NAMES, isoToday } from "@/services/weekSchedule";

/** Which answer the list is narrowed to, or everybody. */
export type Showing = AvailabilityState | "all";

/** A first question to start from: today, late morning. */
function freshWindow(): FreeWindow {
  const today = isoToday();
  return { from: today, to: today, start: "10:00", end: "12:00", weekdays: [] };
}

/** Monday to Saturday, the days anything is taught on. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

/**
 * The window, as one control in the list's toolbar.
 *
 * Two dates, two times, and — over more than one day — the weekdays that count. The same
 * control answers "this Thursday at two" and "Tuesday mornings until the break", so there
 * is no second mode to find: a one-off is simply a range that starts and ends on one day,
 * and the To date follows the From date until it is moved on its own.
 *
 * Asked on a button press rather than as the fields change: a half-typed time is not a
 * question, and every change of window means reading nothing new but redrawing every row.
 */
export function FreeWhenPicker({ window, onChange }: { window: FreeWindow | null; onChange: (window: FreeWindow | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FreeWindow>(() => window ?? freshWindow());
  const problem = windowProblem(draft);
  const ranged = Boolean(draft.from && draft.to && draft.to > draft.from);
  const field = "mt-1 w-full min-w-0 rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm text-[#344054]";
  const label = "block text-xs font-semibold text-[#667085]";

  return (
    <span className="inline-flex items-stretch">
      <Popover.Root
        open={open}
        onOpenChange={(showing) => {
          if (showing) setDraft(window ?? freshWindow());
          setOpen(showing);
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={window ? `Who is free: ${describeWindow(window)}` : "Who is free"}
            className={
              window
                ? "inline-flex items-center gap-2 rounded-l-md border border-[#cfe0ef] bg-[#f2f7fb] px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#e8f0f8]"
                : "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
            }
          >
            <Clock size={15} aria-hidden="true" />
            {window ? describeWindow(window) : "Who is free…"}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="z-[100] w-80 rounded-md border border-[#d9dee7] bg-white p-3 shadow-lg">
            <form
              aria-label="Who is free"
              onSubmit={(event) => {
                event.preventDefault();
                if (problem) return;
                // A single day is its own weekday; ticks left over from a range would only mislead.
                onChange(ranged ? draft : { ...draft, weekdays: [] });
                setOpen(false);
              }}
            >
              <p className="text-sm font-semibold text-[#171717]">Who has no class</p>
              <p className="mt-0.5 text-xs text-[#98a2b3]">One day, or a run of days — the same date twice for a one-off.</p>
              <p className={`${label} mt-3`}>Days</p>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="First day"
                  value={draft.from}
                  onChange={(event) => {
                    const from = event.target.value;
                    // The last day follows the first until somebody sets it on its own.
                    setDraft((current) => ({ ...current, from, to: current.to === current.from || current.to < from ? from : current.to }));
                  }}
                  className={field}
                />
                <span className="mt-1 text-xs text-[#98a2b3]">to</span>
                <input
                  type="date"
                  aria-label="Last day"
                  value={draft.to}
                  min={draft.from}
                  onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
                  className={field}
                />
              </div>
              <p className={`${label} mt-2`}>Hours</p>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label="Starts at"
                  step={900}
                  value={draft.start}
                  onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))}
                  className={field}
                />
                <span className="mt-1 text-xs text-[#98a2b3]">to</span>
                <input
                  type="time"
                  aria-label="Ends at"
                  step={900}
                  value={draft.end}
                  onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))}
                  className={field}
                />
              </div>
              {ranged ? (
                <div className="mt-2">
                  <p className={label}>On</p>
                  <span role="group" aria-label="Weekdays" className="mt-1 inline-flex overflow-hidden rounded-md border border-[#d9dee7]">
                    {WEEKDAYS.map((day) => {
                      const on = draft.weekdays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              weekdays: on ? current.weekdays.filter((kept) => kept !== day) : [...current.weekdays, day],
                            }))
                          }
                          className={`h-7 border-l border-[#d9dee7] px-2 text-xs font-semibold first:border-l-0 ${
                            on ? "bg-[#1f4e79] text-white" : "bg-white text-[#344054] hover:bg-[#f8fafc]"
                          }`}
                        >
                          {DAY_NAMES[day]}
                        </button>
                      );
                    })}
                  </span>
                  <p className="mt-1 text-xs text-[#98a2b3]">
                    {draft.weekdays.length ? "Only those days count." : "None ticked: every day counts."}
                  </p>
                </div>
              ) : null}
              {problem ? <p className="mt-2 text-xs text-[#a6292f]">{problem}</p> : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={Boolean(problem)}
                  className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1a4267] disabled:bg-[#9ba8b5]"
                >
                  Show who is free
                </button>
              </div>
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {window ? (
        <button
          type="button"
          aria-label="Stop asking who is free"
          title="Show every teacher again"
          onClick={() => onChange(null)}
          className="flex items-center rounded-r-md border border-l-0 border-[#cfe0ef] bg-white px-2 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

const TABS: { value: Showing; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "busy", label: "Busy" },
  { value: "unknown", label: "Unknown" },
  { value: "all", label: "Everyone" },
];

/**
 * The answer's three piles, each a press away, with how many are in each — the counts are
 * the first thing wanted ("twelve of them are free") and the list is the second.
 */
export function AvailabilityTabs({
  counts,
  total,
  showing,
  onShow,
}: {
  counts: Record<AvailabilityState, number>;
  total: number;
  showing: Showing;
  onShow: (showing: Showing) => void;
}) {
  return (
    <span role="group" aria-label="Show" className="inline-flex overflow-hidden rounded-md border border-[#d9dee7]">
      {TABS.map((tab) => {
        const on = tab.value === showing;
        const count = tab.value === "all" ? total : counts[tab.value];
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={on}
            onClick={() => onShow(tab.value)}
            className={`inline-flex h-9 items-center gap-1.5 border-l border-[#d9dee7] px-2.5 text-sm font-semibold first:border-l-0 ${
              on ? "bg-[#1f4e79] text-white" : "bg-white text-[#344054] hover:bg-[#f8fafc]"
            }`}
          >
            {tab.label}
            <span className={`tabular-nums text-xs font-normal ${on ? "text-[#dbe6f1]" : "text-[#98a2b3]"}`}>{count}</span>
          </button>
        );
      })}
    </span>
  );
}

const TONE: Record<AvailabilityState, "good" | "bad" | "muted"> = { free: "good", busy: "bad", unknown: "muted" };

/** What the cell says beside the pill: the first reason, and how many more there are. */
function shortWords(answer: Availability): string {
  const more = (count: number) => (count > 1 ? ` +${count - 1} more` : "");
  if (answer.state === "busy") {
    const share = answer.days > 1 ? ` · ${answer.busyDays} of ${answer.days} days` : "";
    return `${clashShort(answer.clashes[0])}${share}${more(answer.clashes.length)}`;
  }
  if (answer.state === "unknown") return `${unknownShort(answer.unknown[0])}${more(answer.unknown.length)}`;
  if (answer.freed.length === 1) {
    const [freed] = answer.freed;
    return `${freed.code || `CRN ${freed.crn}`} ${freed.kind === "cancelled" ? "cancelled" : `covered by ${freed.coverName || "somebody else"}`}`;
  }
  return answer.freed.length ? `${answer.freed.length} classes cancelled or covered` : "";
}

/** Everything behind the answer, for the hover. */
function fullWords(answer: Availability): { heading: string; lines: string[] }[] {
  const said: { heading: string; lines: string[] }[] = [];
  if (answer.state === "busy") {
    said.push({
      heading: answer.days > 1 ? `A class on ${answer.busyDays} of the ${answer.days} days` : "A class in the window",
      lines: answer.clashes.map(clashWords),
    });
  } else if (answer.state === "free") {
    said.push({ heading: "No class of theirs in the window", lines: [] });
  }
  if (answer.freed.length) said.push({ heading: "Taken off them by a note", lines: answer.freed.map(freedWords) });
  if (answer.unknown.length) {
    said.push({
      heading: answer.state === "unknown" ? "Their week cannot be vouched for" : "Also not known",
      lines: answer.unknown.map(unknownWords),
    });
  }
  return said;
}

/** One teacher's answer in the list: the pill, the first reason, and the rest on hover. */
export function AvailabilityCell({ answer }: { answer: Availability | undefined }) {
  if (!answer) return <span className="text-[#c8d0da]">…</span>;
  const short = shortWords(answer);
  const full = fullWords(answer);
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span
            tabIndex={0}
            aria-label={[STATE_WORDS[answer.state], ...full.flatMap((part) => [part.heading, ...part.lines])].join(". ")}
            className="inline-flex max-w-full items-center gap-2"
          >
            <StatePill tone={TONE[answer.state]}>{STATE_WORDS[answer.state]}</StatePill>
            {short ? <span className="truncate text-xs text-[#667085]">{short}</span> : null}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={12}
            className="z-[130] max-w-md rounded-lg border border-[#d9dee7] bg-white p-3 text-xs leading-5 text-[#475467] shadow-lg"
          >
            {full.map((part) => (
              <div key={part.heading} className="mt-2 first:mt-0">
                <p className="font-semibold text-[#171717]">{part.heading}</p>
                {part.lines.length ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {part.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
