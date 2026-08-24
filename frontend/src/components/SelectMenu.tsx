import { Popover } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
  searchText?: string;
  /** A count or short status, shown as a pill beside the label. */
  badge?: string;
  /** "muted" for a badge that means nothing yet — a view nobody has synced. */
  badgeTone?: "accent" | "muted";
};

function Badge({ text, tone }: { text: string; tone: SelectOption["badgeTone"] }) {
  return (
    <span
      className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
        tone === "muted" ? "bg-[#eef1f5] text-[#667085]" : "bg-[#e8edf3] text-[#1f4e79]"
      }`}
    >
      {text}
    </span>
  );
}

type MenuPlacement = { side: "top" | "bottom"; maxHeight: number };

const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 256;

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  trailing?: React.ReactNode;
  multiple?: boolean;
  /** What one selected thing is called, for the "3 codes selected" summary. */
  itemNoun?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
};

export function SelectMenu({ label, value, onChange, options, placeholder, trailing, multiple = false, itemNoun = "item", searchable = false, searchPlaceholder = "Search options", disabled = false, required = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const selectedValues = multiple ? value.split("\n").filter(Boolean) : [value];
  const selected = options.filter((option) => selectedValues.includes(option.value));
  const selectedLabel = multiple
    ? selected.length ? `${selected.length} ${itemNoun}${selected.length === 1 ? "" : "s"} selected` : placeholder
    : selected[0]?.label ?? placeholder;
  const normalizedQuery = normalizeSearch(query);
  const visibleOptions = searchable
    ? normalizedQuery ? options.filter((option) => normalizeSearch(`${option.label} ${option.searchText ?? ""}`).includes(normalizedQuery)) : options.slice(0, 50)
    : options;
  const hasMoreSearchResults = searchable && !normalizedQuery && options.length > visibleOptions.length;

  const toggleOption = (option: SelectOption) => {
    if (!multiple) {
      onChange(option.value);
      setIsOpen(false);
      return;
    }
    const next = selectedValues.includes(option.value)
      ? selectedValues.filter((item) => item !== option.value)
      : [...selectedValues, option.value];
    onChange(next.join("\n"));
  };

  useEffect(() => { if (!isOpen) setQuery(""); }, [isOpen]);

  /*
   * Close when the pointer goes down anywhere else.
   *
   * Radix's own dismissal does this, but it stops working once the menu is opened from
   * inside another portal — the dialog that composes a new view is one, and there the menu
   * stayed open however far away you clicked. Rather than depend on how two portals
   * interact, the menu watches for itself.
   */
  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      // The trigger toggles itself, and a click on an option is a choice, not a dismissal.
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
      setPlacement(null);
      setIsOpen(false);
    };
    // On the next tick, so the press that opened the menu does not also close it.
    const armed = setTimeout(() => document.addEventListener("pointerdown", closeOnOutsidePointer));
    return () => {
      clearTimeout(armed);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [isOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPlacement(null);
      setIsOpen(false);
      return;
    }
    const trigger = triggerRef.current?.getBoundingClientRect();
    const availableAbove = Math.max(0, (trigger?.top ?? 0) - MENU_GAP);
    const availableBelow = Math.max(0, window.innerHeight - (trigger?.bottom ?? window.innerHeight) - MENU_GAP);
    setPlacement(chooseMenuPlacement({ availableAbove, availableBelow }));
    setIsOpen(true);
  };

  return (
    <Popover.Root open={isOpen} onOpenChange={handleOpenChange}>
    <div className="relative">
      <Popover.Trigger asChild>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-required={required || undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        className={`flex h-10 w-full items-center rounded-md border border-[#b7bec8] bg-white px-3 py-2 ${trailing ? "pr-20" : "pr-10"} text-left font-normal text-[#344054] transition-colors hover:border-[#98a2b3] hover:bg-[#f8fafc] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] disabled:cursor-not-allowed disabled:bg-[#f7f8fa] disabled:text-[#98a2b3]`}
      >
        <span className={`flex min-w-0 flex-1 items-center ${selected.length || value ? "" : "text-[#667085]"}`}>
          <span className="truncate">{selectedLabel}</span>
          {selected.length === 1 && selected[0].badge !== undefined ? (
            <Badge text={selected[0].badge} tone={selected[0].badgeTone} />
          ) : null}
        </span>
      </button>
      </Popover.Trigger>
      <ChevronDown aria-hidden="true" size={17} className={`pointer-events-none absolute ${trailing ? "right-10" : "right-3"} top-1/2 -translate-y-1/2 text-[#667085] transition-transform ${isOpen ? "rotate-180" : ""}`} />
      {trailing}
      <Popover.Portal>
      {isOpen ? (
        <Popover.Content ref={contentRef} role="listbox" aria-label={label} side={placement?.side ?? "bottom"} sideOffset={MENU_GAP} avoidCollisions={false} data-select-menu-placement={placement?.side ?? "bottom"} style={{ width: "var(--radix-popover-trigger-width)", ...(placement ? { maxHeight: placement.maxHeight } : {}) }} className="z-[100] isolate overflow-y-auto rounded-lg border border-[#d9dee7] bg-white p-1 opacity-100 shadow-lg outline-none">
          {searchable ? <input aria-label={`Search ${label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="mb-1 h-9 w-full rounded-md border border-[#b7bec8] px-3 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus /> : null}
          {visibleOptions.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedValues.includes(option.value)}
              key={option.value || "blank"}
              onClick={() => toggleOption(option)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-normal transition-colors ${selectedValues.includes(option.value) ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f7f8fa]"}`}
            >
              {multiple ? <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedValues.includes(option.value) ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#98a2b3] bg-white"}`}>{selectedValues.includes(option.value) ? "✓" : ""}</span> : null}
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.badge !== undefined ? <Badge text={option.badge} tone={option.badgeTone} /> : null}
            </button>
          ))}
          {!visibleOptions.length ? <p className="px-3 py-2 text-sm text-[#667085]">No options match your search.</p> : null}
          {hasMoreSearchResults ? <p className="px-3 py-2 text-sm text-[#667085]">Type to search all {options.length} options.</p> : null}
        </Popover.Content>
      ) : null}
      </Popover.Portal>
    </div>
    </Popover.Root>
  );
}

function chooseMenuPlacement({ availableAbove, availableBelow }: { availableAbove: number; availableBelow: number }): MenuPlacement {
  if (availableBelow >= MENU_MAX_HEIGHT || availableBelow >= availableAbove) return { side: "bottom", maxHeight: Math.min(MENU_MAX_HEIGHT, availableBelow) };
  return { side: "top", maxHeight: Math.min(MENU_MAX_HEIGHT, availableAbove) };
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
}
