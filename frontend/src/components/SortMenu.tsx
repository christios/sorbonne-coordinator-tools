import { Popover } from "radix-ui";
import { ArrowDownWideNarrow, Check } from "lucide-react";
import { useState } from "react";

/**
 * A sort chosen from an icon beside a search box, rather than a dropdown that takes a row.
 *
 * The icon fills in when the order is not the list's own (the first option), so a list
 * sorted some other way says so without anybody opening the menu.
 */
export function SortMenu<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  /** The first is the list's own order. */
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value) ?? options[0];
  const sorted = current && current.value !== options[0]?.value;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Sort by: ${current?.label ?? ""}`}
          title={`Sort by: ${current?.label ?? ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={`inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md border transition-colors ${
            sorted
              ? "border-[#1f4e79] bg-[#1f4e79] text-white hover:bg-[#2a5f8f]"
              : "border-[#d3d9e2] bg-white text-[#344054] hover:bg-[#f8fafc]"
          }`}
        >
          <ArrowDownWideNarrow size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="listbox"
          aria-label="Sort by"
          align="end"
          sideOffset={6}
          className="z-[100] min-w-[12rem] rounded-lg border border-[#d9dee7] bg-white p-1 shadow-lg outline-none"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">Sort by</p>
          {options.map((option) => {
            const chosen = option.value === current?.value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={chosen}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
                  chosen ? "font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f5f7fa]"
                }`}
              >
                <span className="w-3.5 shrink-0">{chosen ? <Check size={14} aria-hidden="true" /> : null}</span>
                {option.label}
              </button>
            );
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
