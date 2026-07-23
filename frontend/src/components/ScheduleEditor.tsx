import { ArrowDownUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";

type ScheduleRow = Record<string, string> & { id: string };
type ScheduleField = { key: "date" | "topic" | "preClass" | "assessments"; label: string; type?: "date"; multiline?: boolean };

type Props = {
  rows: ScheduleRow[];
  onChange: (rows: ScheduleRow[]) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
};

const fields: ScheduleField[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "topic", label: "Topic", multiline: true },
  { key: "preClass", label: "Pre-class learning activities", multiline: true },
  { key: "assessments", label: "Assessments", multiline: true },
] as const;

export function ScheduleEditor({ rows, onChange, syllabusId, revision, onOpenHistory }: Props) {
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");

  useEffect(() => {
    if (!movingRowId) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-schedule-move-menu]")) {
        setMovingRowId(null);
        setMoveQuery("");
      }
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () => document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, [movingRowId]);

  const toggleExpanded = (id: string) => setExpandedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const updateRow = (id: string, key: string, value: string) => onChange(rows.map((row) => row.id === id ? { ...row, [key]: value } : row));
  const removeRow = (id: string) => onChange(rows.filter((row) => row.id !== id));
  const addRow = () => {
    const id = crypto.randomUUID();
    onChange([...rows, { id, date: "", topic: "", preClass: "", assessments: "" }]);
    window.requestAnimationFrame(() => document.getElementById(`schedule-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const moveRowBefore = (sourceId: string, destinationId?: string) => {
    const source = rows.find((row) => row.id === sourceId);
    if (!source) return;
    const withoutSource = rows.filter((row) => row.id !== sourceId);
    const destinationIndex = destinationId ? withoutSource.findIndex((row) => row.id === destinationId) : withoutSource.length;
    onChange([...withoutSource.slice(0, destinationIndex), source, ...withoutSource.slice(destinationIndex)]);
    setMovingRowId(null);
    setMoveQuery("");
  };

  return (
    <section className="mt-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-[#344054]">Sessions</h4>
        <button type="button" onClick={addRow} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add session</button>
      </div>
      {rows.length ? <div className="grid gap-3">{rows.map((row, index) => {
        const isExpanded = expandedIds.includes(row.id);
        const destinations = rows.filter((item) => item.id !== row.id && scheduleSummary(item).toLowerCase().includes(moveQuery.toLowerCase()));
        return (
          <fieldset id={`schedule-${row.id}`} key={row.id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4">
            <div className="relative flex items-start justify-between gap-3">
              <button type="button" aria-label={`${isExpanded ? "Collapse" : "Expand"} topic: ${topicLabel(row)} (position ${index + 1})`} aria-expanded={isExpanded} onClick={() => toggleExpanded(row.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                <span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">{topicLabel(row)}</span><span className="mt-0.5 block text-sm text-[#475467]">{row.date || "No date set"}</span></span>
              </button>
              <div data-schedule-move-menu className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => { setMovingRowId(row.id); setMoveQuery(""); }} className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]" aria-label={`Move topic: ${topicLabel(row)} (position ${index + 1})`} title="Move session"><ArrowDownUp size={17} /></button>
                <button type="button" onClick={() => removeRow(row.id)} className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove topic: ${topicLabel(row)} (position ${index + 1})`} title="Remove session"><Trash2 size={17} /></button>
              </div>
              {movingRowId === row.id ? <div data-schedule-move-menu className="absolute right-0 top-full z-[90] isolate mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg">
                <p className="text-sm font-semibold text-[#344054]">Place this session before</p>
                <input type="search" value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} placeholder="Search destination sessions" className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus />
                <div className="mt-2 max-h-56 overflow-y-auto">{destinations.map((destination, destinationIndex) => <button type="button" key={destination.id} onClick={() => moveRowBefore(row.id, destination.id)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"><span className="text-[#667085]">{destinationIndex + 1}. </span>{scheduleSummary(destination)}</button>)}</div>
                <button type="button" onClick={() => moveRowBefore(row.id)} className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Move to end</button>
              </div> : null}
            </div>
            {isExpanded ? <div className="mt-4 grid gap-4 lg:grid-cols-2">{fields.map((field) => {
              const value = row[field.key] ?? "";
              const historyField = { path: `schedule[${row.id}].${field.key}`, label: `Course schedule · ${field.label}` };
              return <label key={field.key} className={`grid gap-1 text-sm font-medium text-[#344054] ${field.multiline ? "lg:col-span-2" : ""}`}>{field.label}<div className="relative">{field.multiline ? <AutoResizeTextarea value={value} onChange={(event) => updateRow(row.id, field.key, event.target.value)} minRows={3} className="rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={field.type} value={field.type === "date" ? dateInputValue(value) : value} onChange={(event) => updateRow(row.id, field.key, event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={historyField} onOpenSidebar={onOpenHistory} placement={field.multiline ? "top" : "center"} /></div></label>;
            })}</div> : null}
          </fieldset>
        );
      })}</div> : <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No sessions added yet.</p>}
    </section>
  );
}

function topicLabel(row: ScheduleRow) {
  return row.topic?.trim() || "Untitled topic";
}

function scheduleSummary(row: ScheduleRow) {
  return `${topicLabel(row)}${row.date ? ` · ${row.date}` : ""}`;
}

function dateInputValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
