import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string; searchText?: string };

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  trailing?: React.ReactNode;
  multiple?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  required?: boolean;
};

export function SelectMenu({ label, value, onChange, options, placeholder, trailing, multiple = false, searchable = false, searchPlaceholder = "Search options", disabled = false, required = false }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedValues = multiple ? value.split("\n").filter(Boolean) : [value];
  const selected = options.filter((option) => selectedValues.includes(option.value));
  const selectedLabel = multiple
    ? selected.length ? `${selected.length} ${selected.length === 1 ? "PLO" : "PLOs"} selected` : placeholder
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

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    const closeWhenOutside = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-required={required || undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className={`flex h-10 w-full items-center rounded-md border border-[#b7bec8] bg-white px-3 py-2 ${trailing ? "pr-20" : "pr-10"} text-left font-normal text-[#344054] transition-colors hover:border-[#98a2b3] hover:bg-[#f8fafc] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] disabled:cursor-not-allowed disabled:bg-[#f7f8fa] disabled:text-[#98a2b3]`}
      >
        <span className={selected.length || value ? "" : "text-[#667085]"}>{selectedLabel}</span>
      </button>
      <ChevronDown aria-hidden="true" size={17} className={`pointer-events-none absolute ${trailing ? "right-10" : "right-3"} top-1/2 -translate-y-1/2 text-[#667085] transition-transform ${isOpen ? "rotate-180" : ""}`} />
      {trailing}
      {isOpen ? (
        <div role="listbox" aria-label={label} className="absolute left-0 right-0 z-[90] isolate mt-1 overflow-hidden rounded-lg border border-[#d9dee7] bg-white p-1 opacity-100 shadow-lg">
          {searchable ? <input aria-label={`Search ${label}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} className="mb-1 h-9 w-full rounded-md border border-[#b7bec8] px-3 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus /> : null}
          <div className="max-h-64 overflow-y-auto">
          {visibleOptions.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={selectedValues.includes(option.value)}
              key={option.value || "blank"}
              onClick={() => toggleOption(option)}
              className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm font-normal transition-colors ${selectedValues.includes(option.value) ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f7f8fa]"}`}
            >
              {multiple ? <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedValues.includes(option.value) ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#98a2b3] bg-white"}`}>{selectedValues.includes(option.value) ? "✓" : ""}</span> : null}
              <span>{option.label}</span>
            </button>
          ))}
          {!visibleOptions.length ? <p className="px-3 py-2 text-sm text-[#667085]">No options match your search.</p> : null}
          {hasMoreSearchResults ? <p className="px-3 py-2 text-sm text-[#667085]">Type to search all {options.length} options.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
}
