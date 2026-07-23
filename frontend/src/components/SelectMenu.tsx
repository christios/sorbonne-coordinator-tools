import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SelectOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  trailing?: React.ReactNode;
};

export function SelectMenu({ label, value, onChange, options, placeholder, trailing }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!isOpen) return;
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
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center rounded-lg border border-[#b7bec8] bg-white px-3 py-2 pr-20 text-left font-normal text-[#344054] transition-colors hover:border-[#98a2b3] hover:bg-[#f8fafc] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
      >
        <span className={selected || value ? "" : "text-[#667085]"}>{selected?.label ?? placeholder}</span>
      </button>
      <ChevronDown aria-hidden="true" size={17} className={`pointer-events-none absolute right-10 top-1/2 -translate-y-1/2 text-[#667085] transition-transform ${isOpen ? "rotate-180" : ""}`} />
      {trailing ? <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span> : null}
      {isOpen ? (
        <div role="listbox" aria-label={label} className="absolute left-0 right-0 z-[90] isolate mt-1 overflow-hidden rounded-lg border border-[#d9dee7] bg-white p-1 opacity-100 shadow-lg">
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={value === option.value}
              key={option.value || "blank"}
              onClick={() => { onChange(option.value); setIsOpen(false); }}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm font-normal transition-colors ${value === option.value ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f7f8fa]"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
