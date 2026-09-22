/**
 * Which stretch of the semester the hours page is counting.
 *
 * A list and a calendar in the same popover, because there are two quite different
 * questions here. "How did October go" is asked nine times in ten and its answer is one
 * of a dozen named periods, so it is one press on a list. "What did she teach while I was
 * away" has no name, so it is two presses on a calendar. A control offering only the
 * second makes the common question the slow one; only the first makes the uncommon one
 * impossible.
 *
 * The button says what is being counted, because the numbers underneath it do not: a
 * table of October's hours looks exactly like a table of the year's.
 */

import { Popover } from "radix-ui";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  WHOLE_SEMESTER,
  windowForPeriod,
  windowForRange,
  type HourWindow,
} from "@/services/hourWindow";
import { periodLabel } from "@/services/payPeriods";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function HourWindowPicker({
  window,
  periods,
  onChange,
}: {
  window: HourWindow;
  /** The semester's pay periods, newest first, as the day each opens. */
  periods: string[];
  onChange: (window: HourWindow) => void;
}) {
  const [open, setOpen] = useState(false);
  // Half a range: the first date pressed, waiting for the second.
  const [half, setHalf] = useState("");
  /*
   * The day under the pointer, so a half-made range shows itself before it is made.
   *
   * Picking a range blind — press, then press again and see what you got — is how people
   * end up choosing the wrong fortnight and never noticing. While one end is held, the
   * days between it and the pointer are painted as if the range were already chosen.
   */
  const [hovered, setHovered] = useState("");
  const [month, setMonth] = useState(() => firstOfMonth(window.from || todayISO()));

  const choose = (chosen: HourWindow) => {
    onChange(chosen);
    setHalf("");
    setHovered("");
    setOpen(false);
  };
  const pressDay = (day: string) => {
    if (!half) {
      setHalf(day);
      return;
    }
    choose(windowForRange(half, day));
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(showing) => {
        setOpen(showing);
        if (!showing) {
          setHalf("");
          setHovered("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="What to count"
          className="inline-flex h-9 w-fit min-w-[14rem] items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 text-sm text-[#344054] hover:bg-[#f9fafb]"
        >
          <CalendarRange size={15} className="shrink-0 text-[#667085]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{window.label}</span>
          <ChevronDown size={15} className="shrink-0 text-[#667085]" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex gap-3 rounded-lg border border-[#d0d5dd] bg-white p-3 shadow-lg"
        >
          <div className="max-h-[19rem] w-52 overflow-y-auto">
            <Preset
              label="Whole semester"
              chosen={window.kind === "semester"}
              onChoose={() => choose(WHOLE_SEMESTER)}
            />
            <p className="mb-1 mt-3 px-2 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">Pay periods</p>
            {periods.map((start) => (
              <Preset
                key={start}
                label={periodLabel(start)}
                chosen={window.kind === "period" && window.from === start}
                onChoose={() => choose(windowForPeriod(start))}
              />
            ))}
          </div>
          <div className="w-[16rem] border-l border-[#eef1f5] pl-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="rounded px-2 py-1 text-sm text-[#667085] hover:bg-[#f2f7fb]"
              >
                ‹
              </button>
              <span className="text-sm font-semibold text-[#344054]">
                {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="rounded px-2 py-1 text-sm text-[#667085] hover:bg-[#f2f7fb]"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHovered("")}>
              {WEEKDAYS.map((letter, index) => (
                <span key={`${letter}-${index}`} className="text-center text-[10px] font-medium text-[#98a2b3]">
                  {letter}
                </span>
              ))}
              {daysOf(month).map((day, index) =>
                day ? (
                  <button
                    key={day}
                    type="button"
                    onClick={() => pressDay(day)}
                    onMouseEnter={() => setHovered(day)}
                    onFocus={() => setHovered(day)}
                    aria-label={day}
                    className={`h-7 rounded text-xs tabular-nums ${dayPaint(day, window, half, hovered)}`}
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                ) : (
                  <span key={`blank-${index}`} className="h-7" />
                ),
              )}
            </div>
            <p className="mt-2 text-xs text-[#98a2b3]">
              {half ? "And the day it ends on." : "Press the day it starts on, then the day it ends on."}
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Preset({ label, chosen, onChoose }: { label: string; chosen: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
        chosen ? "bg-[#eef4fa] font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f5f7fa]"
      }`}
    >
      <Check size={13} className={`shrink-0 ${chosen ? "" : "invisible"}`} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function dayPaint(day: string, window: HourWindow, half: string, hovered: string): string {
  /*
   * A range being drawn outranks the one already chosen: while an end is held, the
   * calendar is answering "what would I get if I let go here", not "what did I get".
   */
  if (half) {
    const [first, last] = half <= hovered ? [half, hovered] : [hovered, half];
    if (day === half || (hovered && day === hovered)) return "bg-[#1f4e79] text-white";
    if (hovered && day > first && day < last) return "bg-[#eef4fa] text-[#1f4e79]";
    return "text-[#344054] hover:bg-[#f2f7fb]";
  }
  /*
   * Only a range drawn here is drawn here. A named period is chosen on the list and shown
   * as chosen there, and painting its days as well would leave two things looking selected
   * at once with no way to tell which the control would act on.
   */
  if (window.kind !== "range") return "text-[#344054] hover:bg-[#f2f7fb]";
  if (day === window.from || day === window.to) return "bg-[#1f4e79] text-white";
  if (window.from && window.to && day > window.from && day < window.to) return "bg-[#eef4fa] text-[#1f4e79]";
  return "text-[#344054] hover:bg-[#f2f7fb]";
}

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function firstOfMonth(day: string): string {
  return /^\d{4}-\d{2}/.test(day) ? `${day.slice(0, 7)}-01` : todayISO();
}

function shiftMonth(month: string, by: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + by;
  const moved = new Date(year, index, 1);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}-01`;
}

/** The month's days, padded so the first lands on its weekday. Monday first. */
function daysOf(month: string): (string | null)[] {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const first = new Date(year, index, 1);
  const last = new Date(year, index + 1, 0);
  const cells: (string | null)[] = Array.from({ length: (first.getDay() + 6) % 7 }, () => null);
  for (let date = 1; date <= last.getDate(); date += 1) {
    cells.push(`${month.slice(0, 7)}-${String(date).padStart(2, "0")}`);
  }
  return cells;
}
