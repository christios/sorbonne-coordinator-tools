import { Popover } from "radix-ui";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { FormFieldLabel } from "@/components/FormFieldLabel";
import {
  chooseCalendarPlacement,
  type CalendarPlacement,
} from "@/components/dateFieldPlacement";

type DateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  trailing?: React.ReactNode;
  fieldKey?: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const CALENDAR_GAP = 6;

/** Shared in-app calendar picker used by requisitions and syllabi. */
export function DateField({
  label,
  value,
  onChange,
  required = false,
  trailing,
  fieldKey,
}: DateFieldProps) {
  const inputId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = useMemo(() => parseDate(value), [value]);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CalendarPlacement | null>(null);
  const [month, setMonth] = useState(() =>
    startOfMonth(selected ?? new Date()),
  );

  useEffect(() => {
    if (selected) setMonth(startOfMonth(selected));
  }, [selected]);

  const days = calendarDays(month);
  const choose = (day: Date) => {
    onChange(toIsoDate(day));
    setOpen(false);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPlacement(null);
      setOpen(false);
      return;
    }

    const trigger = triggerRef.current?.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const availableAbove = Math.max(0, (trigger?.top ?? 0) - CALENDAR_GAP);
    const availableBelow = Math.max(
      0,
      viewportHeight - (trigger?.bottom ?? viewportHeight) - CALENDAR_GAP,
    );

    setPlacement(chooseCalendarPlacement({ availableAbove, availableBelow }));
    setOpen(true);
  };

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="text-xs font-medium text-[#344054]">
        <FormFieldLabel required={required} fieldKey={fieldKey}>
          {label}
        </FormFieldLabel>
      </label>
      <div className="relative">
        <Popover.Root open={open} onOpenChange={handleOpenChange}>
          <Popover.Trigger asChild>
            <button
              ref={triggerRef}
              id={inputId}
              type="button"
              aria-label={label}
              aria-required={required || undefined}
              className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-transparent px-3 text-left text-sm font-normal shadow-xs outline-none transition-[color,box-shadow] hover:bg-[#f8fafc] focus-visible:border-[#1f4e79] focus-visible:ring-[3px] focus-visible:ring-[#d7e5f3]/50 ${trailing ? "pr-10" : ""}`}
            >
              <CalendarDays
                size={16}
                className="shrink-0 text-[#1f4e79]"
                aria-hidden="true"
              />
              <span
                className={
                  selected
                    ? "truncate text-[#171717]"
                    : "truncate text-[#667085]"
                }
              >
                {selected ? formatDate(selected) : "Select date"}
              </span>
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="start"
              side={placement?.side ?? "bottom"}
              sideOffset={CALENDAR_GAP}
              avoidCollisions={false}
              data-calendar-placement={placement?.side ?? "bottom"}
              style={placement ? { maxHeight: placement.maxHeight } : undefined}
              className="z-50 w-72 overflow-y-auto rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg outline-none"
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() - 1,
                          1,
                        ),
                    )
                  }
                  className="rounded-md p-2 text-[#1f4e79] hover:bg-[#f2f7fb]"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={17} />
                </button>
                <p className="text-sm font-semibold text-[#344054]">
                  {formatMonth(month)}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setMonth(
                      (current) =>
                        new Date(
                          current.getFullYear(),
                          current.getMonth() + 1,
                          1,
                        ),
                    )
                  }
                  className="rounded-md p-2 text-[#1f4e79] hover:bg-[#f2f7fb]"
                  aria-label="Next month"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-[#667085]">
                {WEEKDAYS.map((weekday) => (
                  <span key={weekday}>{weekday}</span>
                ))}
              </div>
              <div
                role="grid"
                aria-label={`${label} calendar`}
                className="mt-1 grid grid-cols-7 gap-1"
              >
                {days.map((day, index) =>
                  day ? (
                    <button
                      key={toIsoDate(day)}
                      type="button"
                      role="gridcell"
                      onClick={() => choose(day)}
                      aria-label={`Select ${formatDate(day)}`}
                      aria-pressed={sameDate(day, selected)}
                      className={`h-8 rounded-md text-sm transition-colors ${sameDate(day, selected) ? "bg-[#1f4e79] font-semibold text-white" : sameDate(day, new Date()) ? "border border-[#b9d0e5] text-[#1f4e79] hover:bg-[#f2f7fb]" : "text-[#344054] hover:bg-[#f2f7fb]"}`}
                    >
                      {day.getDate()}
                    </button>
                  ) : (
                    <span
                      key={`empty-${index}`}
                      aria-hidden="true"
                      className="h-8"
                    />
                  ),
                )}
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-[#e5e7eb] pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setMonth(startOfMonth(new Date()));
                  }}
                  className="text-sm font-semibold text-[#1f4e79] hover:underline"
                >
                  Today
                </button>
                {selected ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                    className="inline-flex items-center gap-1 text-sm font-semibold text-[#a6292f] hover:underline"
                  >
                    <X size={15} /> Clear
                  </button>
                ) : null}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {trailing}
      </div>
    </div>
  );
}

function parseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : null;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function sameDate(left: Date | null, right: Date | null) {
  return Boolean(
    left &&
    right &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate(),
  );
}
function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(date);
}
function calendarDays(month: Date) {
  const leading = month.getDay();
  const count = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  return Array.from({ length: 42 }, (_, index) =>
    index < leading || index >= leading + count
      ? null
      : new Date(month.getFullYear(), month.getMonth(), index - leading + 1),
  );
}
