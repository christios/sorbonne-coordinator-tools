import { Popover } from "radix-ui";
import { Check, ListFilter, X } from "lucide-react";
import { useState } from "react";

/** One way of narrowing a list, and how many it would leave with the others already chosen. */
export type FilterOption<T extends string> = { value: T; label: string; count: number };

/**
 * A list's filters behind one button, beside its search and its sort, rather than a row of
 * chips under them: each option with how many it would leave, the ones that would leave none
 * not offered (unless chosen, so they can be let go). Chosen ones narrow together. A teacher,
 * where there is one to choose, is a section of the same menu.
 */
export function FilterMenu<T extends string>({
  options,
  chosen,
  onToggle,
  teachers,
}: {
  options: FilterOption<T>[];
  chosen: T[];
  onToggle: (value: T) => void;
  teachers?: { options: FilterOption<string>[]; chosen: string; onChoose: (teacherId: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const active = chosen.length + (teachers?.chosen ? 1 : 0);
  const shown = options.filter((option) => option.count > 0 || chosen.includes(option.value));
  const teacherOptions = (teachers?.options ?? []).filter((option) => option.count > 0 || option.value === teachers?.chosen);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={active ? `Filter: ${active} chosen` : "Filter"}
          title="Filter"
          aria-haspopup="menu"
          aria-expanded={open}
          className={`inline-flex h-[34px] shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors ${
            active ? "border-[#1f4e79] bg-[#1f4e79] text-white hover:bg-[#2a5f8f]" : "border-[#d3d9e2] bg-white text-[#344054] hover:bg-[#f8fafc]"
          }`}
        >
          <ListFilter size={15} aria-hidden="true" />
          {active ? <span className="tabular-nums">{active}</span> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="menu"
          aria-label="Filter"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-[100] max-h-[min(28rem,var(--radix-popover-content-available-height))] min-w-[14rem] overflow-y-auto rounded-lg border border-[#d9dee7] bg-white p-1 shadow-lg outline-none"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">Show only</p>
          {shown.map((option) => {
            const on = chosen.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => onToggle(option.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  on ? "font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f5f7fa]"
                }`}
              >
                <span className="w-3.5 shrink-0">{on ? <Check size={14} aria-hidden="true" /> : null}</span>
                <span className="flex-1">{option.label}</span>
                <span className="tabular-nums text-xs text-[#98a2b3]">{option.count}</span>
              </button>
            );
          })}
          {!shown.length ? <p className="px-2.5 py-1.5 text-sm text-[#98a2b3]">Nothing to narrow to.</p> : null}
          {teachers && teacherOptions.length ? (
            <>
              <p className="mt-1 border-t border-[#eef1f5] px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-[#667085]">Teacher</p>
              {[{ value: "", label: "Every teacher", count: 0 }, ...teacherOptions].map((option) => {
                const on = teachers.chosen === option.value;
                return (
                  <button
                    key={option.value || "every"}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() => teachers.onChoose(option.value)}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                      on ? "font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f5f7fa]"
                    }`}
                  >
                    <span className="w-3.5 shrink-0">{on ? <Check size={14} aria-hidden="true" /> : null}</span>
                    <span className="flex-1 truncate">{option.label}</span>
                    {option.value ? <span className="tabular-nums text-xs text-[#98a2b3]">{option.count}</span> : null}
                  </button>
                );
              })}
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Under the search: the one filter used most, always to hand as a chip with its count, and
 * the others chosen, each a pill with a ✕ to let it go.
 */
export function FilterPills({
  shortcut,
  on,
  onShortcut,
  pills,
}: {
  shortcut: { label: string; count: number };
  on: boolean;
  onShortcut: () => void;
  pills: { key: string; label: string; onRemove: () => void }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-pressed={on}
        onClick={onShortcut}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
          on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
        }`}
      >
        {shortcut.label}
        <span className={`rounded-full px-1.5 tabular-nums ${on ? "bg-white/20 text-white" : "bg-[#eef1f5] text-[#667085]"}`}>{shortcut.count}</span>
      </button>
      {pills.map((pill) => (
        <span key={pill.key} className="inline-flex items-center gap-1 rounded-full bg-[#e8edf3] py-0.5 pl-2.5 pr-1 text-xs font-semibold text-[#1f4e79]">
          {pill.label}
          <button
            type="button"
            aria-label={`Stop filtering: ${pill.label}`}
            onClick={pill.onRemove}
            className="rounded-full p-0.5 text-[#1f4e79]/70 hover:bg-white hover:text-[#1f4e79]"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}
