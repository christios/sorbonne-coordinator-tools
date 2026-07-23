import { Clock3, Loader2, PanelRightClose, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { FieldHistoryEntry, WordDiffOperation, getFieldHistory } from "@/services/syllabi";

export type HistoryField = { path: string; label: string };

type Props = {
  syllabusId: string;
  revision: number;
  field: HistoryField;
  onOpenSidebar: (field: HistoryField) => void;
  placement?: "center" | "top";
};

export function FieldHistoryControl({ syllabusId, revision, field, onOpenSidebar, placement = "center" }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const history = useQuery({
    queryKey: ["syllabus-field-history", syllabusId, field.path, revision],
    queryFn: () => getFieldHistory(syllabusId, field.path),
    enabled: isOpen,
  });
  useEffect(() => {
    if (!isOpen) return;
    const closeWhenOutside = (event: Event) => {
      if (!controlRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={controlRef} className={`absolute right-2 flex ${placement === "top" ? "top-2" : "inset-y-0 items-center"} ${isOpen ? "z-40" : "z-10"}`}>
      <button type="button" onClick={() => setIsOpen((open) => !open)} className="rounded p-1 text-[#667085] hover:bg-[#e8edf3] hover:text-[#1f4e79]" aria-label={`View edit history for ${field.label}`}>
        <Clock3 size={16} />
      </button>
      {isOpen ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-[#d9dee7] bg-white p-3 shadow-lg">
          <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-[#344054]">Latest saved change</p><p className="text-xs text-[#667085]">{field.label}</p></div><button type="button" onClick={() => setIsOpen(false)} className="rounded p-1 text-[#667085] hover:bg-[#f2f4f7]" aria-label="Close edit history preview"><X size={15} /></button></div>
          <HistoryPreview entry={history.data?.[0]} isLoading={history.isLoading} />
          <button type="button" onClick={() => { setIsOpen(false); onOpenSidebar(field); }} className="mt-3 text-sm font-semibold text-[#1f4e79] hover:underline">View all edits</button>
        </div>
      ) : null}
    </div>
  );
}

export function FieldHistorySidebar({ syllabusId, revision, field, onClose }: { syllabusId: string; revision: number; field: HistoryField | null; onClose: () => void }) {
  const history = useQuery({
    queryKey: ["syllabus-field-history", syllabusId, field?.path, revision],
    queryFn: () => getFieldHistory(syllabusId, field?.path ?? ""),
    enabled: Boolean(field),
  });
  if (!field) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[#d9dee7] bg-white shadow-2xl" aria-label="Field edit history">
      <div className="flex items-start justify-between border-b border-[#d9dee7] p-5"><div><p className="text-sm font-medium text-[#a6292f]">Edit history</p><h2 className="mt-1 text-lg font-semibold text-[#171717]">{field.label}</h2><p className="mt-1 break-all text-xs text-[#667085]">Saved changes for this field</p></div><button type="button" onClick={onClose} className="rounded p-2 text-[#475467] hover:bg-[#f2f4f7]" aria-label="Close field edit history"><PanelRightClose size={19} /></button></div>
      <div className="flex-1 overflow-y-auto p-5"><HistoryList entries={history.data} isLoading={history.isLoading} /></div>
    </aside>
  );
}

function HistoryList({ entries, isLoading }: { entries?: FieldHistoryEntry[]; isLoading: boolean }) {
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-[#667085]"><Loader2 size={16} className="animate-spin" /> Loading changes</div>;
  if (!entries?.length) return <p className="rounded-md border border-dashed border-[#d0d5dd] p-4 text-sm leading-6 text-[#667085]">No saved changes yet. The first edit to this field will appear here after autosave.</p>;
  return <ol className="space-y-4">{entries.map((entry) => <li key={`${entry.revision}-${entry.changedAt}`} className="rounded-md border border-[#d9dee7] p-4"><HistoryPreview entry={entry} /></li>)}</ol>;
}

function HistoryPreview({ entry, isLoading = false }: { entry?: FieldHistoryEntry; isLoading?: boolean }) {
  if (isLoading) return <div className="mt-3 flex items-center gap-2 text-sm text-[#667085]"><Loader2 size={16} className="animate-spin" /> Loading change</div>;
  if (!entry) return <p className="mt-3 text-sm text-[#667085]">No saved changes yet.</p>;
  return <div className="mt-3 text-sm"><p className="text-xs text-[#667085]">{formatTimestamp(entry.changedAt)} · Revision {entry.revision}</p><div className="mt-3 rounded bg-[#f7f8fa] p-2 leading-6 text-[#344054]"><HistoryDiff entry={entry} /></div></div>;
}

function HistoryDiff({ entry }: { entry: FieldHistoryEntry }) {
  if (!entry.operations) return <><span className="line-through text-[#b42318]">{displayValue(entry.previousValue)}</span><span aria-hidden="true"> → </span><span className="font-semibold text-[#067647]">{displayValue(entry.newValue)}</span></>;
  return <>{entry.operations.map((operation, index) => <HistoryOperation key={index} operation={operation} />)}</>;
}

function HistoryOperation({ operation }: { operation: WordDiffOperation }) {
  if (operation.type === "equal") return <>{operation.text}</>;
  if (operation.type === "delete") return <mark className="rounded bg-[#fee4e2] px-0.5 text-[#b42318] line-through">{operation.text}</mark>;
  if (operation.type === "insert") return <mark className="rounded bg-[#dcfae6] px-0.5 text-[#067647]">{operation.text}</mark>;
  if (operation.type === "substitute") return <mark className="rounded bg-[#fef0c7] px-0.5 text-[#92400e]"><span className="line-through">{operation.left}</span><span aria-hidden="true"> → </span><span className="font-semibold">{operation.right}</span></mark>;
  return null;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
