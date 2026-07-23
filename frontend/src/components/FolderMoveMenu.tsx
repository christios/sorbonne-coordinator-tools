import { Check, ChevronDown, Folder, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type Folder = { id: string; name: string };

type Props = {
  label: string;
  value: string | null;
  folders: Folder[];
  isMoving?: boolean;
  onChange: (folderId: string | null) => void;
};

type Destination = { id: string | null; name: string };

export function FolderMoveMenu({ label, value, folders, isMoving = false, onChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const destinations = useMemo<Destination[]>(() => [{ id: null, name: "Unfiled" }, ...folders], [folders]);
  const filteredDestinations = destinations.filter((destination) => destination.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedName = destinations.find((destination) => destination.id === value)?.name ?? "Unfiled";

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

  function selectDestination(folderId: string | null) {
    onChange(folderId);
    setIsOpen(false);
    setQuery("");
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-busy={isMoving || undefined}
        disabled={isMoving}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center gap-2 rounded-lg border border-[#b7bec8] bg-white px-3 py-2 pr-10 text-left font-normal text-[#344054] transition-colors hover:border-[#98a2b3] hover:bg-[#f8fafc] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] disabled:cursor-wait disabled:opacity-70"
      >
        <Folder aria-hidden="true" size={16} className="shrink-0 text-[#667085]" />
        <span className="truncate">{selectedName}</span>
      </button>
      {isMoving ? <Loader2 aria-hidden="true" size={17} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#667085]" /> : <ChevronDown aria-hidden="true" size={17} className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#667085] transition-transform ${isOpen ? "rotate-180" : ""}`} />}
      {isOpen ? (
        <div role="listbox" aria-label={label} className="absolute right-0 z-[90] isolate mt-2 w-80 overflow-hidden rounded-lg border border-[#d9dee7] bg-white p-2 opacity-100 shadow-lg">
          <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">Move to folder</p>
          <label className="relative block">
            <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input aria-label="Find a folder" type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a folder…" className="w-full rounded-md border border-[#b7bec8] py-2 pl-9 pr-3 text-sm text-[#344054] placeholder:text-[#98a2b3] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />
          </label>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {filteredDestinations.map((destination) => {
              const isSelected = destination.id === value;
              return <button key={destination.id ?? "unfiled"} type="button" role="option" aria-selected={isSelected} onClick={() => selectDestination(destination.id)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${isSelected ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#344054] hover:bg-[#f7f8fa]"}`}><Folder aria-hidden="true" size={16} className="shrink-0 text-[#667085]" /><span className="min-w-0 flex-1 truncate">{destination.name}</span>{isSelected ? <Check aria-hidden="true" size={16} className="shrink-0 text-[#1f4e79]" /> : null}</button>;
            })}
            {!filteredDestinations.length ? <p role="status" className="px-3 py-4 text-sm text-[#667085]">No matching folders.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
