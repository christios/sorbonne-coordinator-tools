import { Plus, X } from "lucide-react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";

type HistoryContext = { syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void };
type ListItem = { id: string; text: string };
type Props = HistoryContext & {
  value: Record<string, unknown>;
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  onChange: (value: Record<string, unknown>) => void;
  onMetadataChange: (field: "courseTitle" | "courseCode" | "academicYear", value: string) => void;
};

export function CourseIdentificationEditor({ value, courseTitle, courseCode, academicYear, onChange, onMetadataChange, ...history }: Props) {
  const contactHours = record(value.contactHours);
  const update = (change: Record<string, unknown>) => onChange({ ...value, ...change });
  return <><h3 className="text-lg font-semibold text-[#171717]">Course identification</h3><div className="mt-5 grid gap-4"><IdentificationField label="Course title" value={courseTitle} onChange={(next) => onMetadataChange("courseTitle", next)} field={{ path: "metadata.courseTitle", label: "Course title" }} {...history} /><IdentificationField label="Course code" value={courseCode} onChange={(next) => onMetadataChange("courseCode", next)} field={{ path: "metadata.courseCode", label: "Course code" }} {...history} /><IdentificationField label="Academic year" value={academicYear} onChange={(next) => onMetadataChange("academicYear", next)} field={{ path: "metadata.academicYear", label: "Academic year" }} {...history} /><IdentificationField label="Degree level and semester" value={stringValue(value.degreeLevelAndSemester)} onChange={(degreeLevelAndSemester) => update({ degreeLevelAndSemester })} field={{ path: "identification.degreeLevelAndSemester", label: "Degree level and semester" }} {...history} /><IdentificationField label="Programme title" value={stringValue(value.programmeTitle)} onChange={(programmeTitle) => update({ programmeTitle })} field={{ path: "identification.programmeTitle", label: "Programme title" }} {...history} /><IdentificationField label="Number of ECTS" value={stringValue(value.ects)} onChange={(ects) => update({ ects })} type="number" min={0} step={0.5} field={{ path: "identification.ects", label: "Number of ECTS" }} {...history} /><section className="rounded-md border border-[#d9dee7] p-4"><h4 className="text-sm font-semibold text-[#344054]">Course contact hours</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">{["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"].map((label) => <IdentificationField key={label} label={label} value={stringValue(contactHours[label])} onChange={(next) => update({ contactHours: { ...contactHours, [label]: next } })} type="number" min={0} step={0.5} field={{ path: `identification.contactHours.${label}`, label }} {...history} />)}</div></section><TextList title="Prerequisites and co-requisites" singular="prerequisite or co-requisite" legacyValue={value.prerequisites} itemsValue={value.prerequisiteItems} path="identification.prerequisiteItems" onChange={(items) => update({ prerequisiteItems: items, prerequisites: items.map((item) => item.text).filter(Boolean).join("\n") })} {...history} /><TextList title="Equipment" singular="equipment item" legacyValue={value.equipment} itemsValue={value.equipmentItems} path="identification.equipmentItems" onChange={(items) => update({ equipmentItems: items, equipment: items.map((item) => item.text).filter(Boolean).join("\n") })} {...history} /></div></>;
}

function TextList({ title, singular, legacyValue, itemsValue, path, onChange, ...history }: HistoryContext & { title: string; singular: string; legacyValue: unknown; itemsValue: unknown; path: string; onChange: (value: ListItem[]) => void }) {
  const items = listItems(itemsValue, legacyValue, title);
  return <section><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#344054]">{title}</h4><button type="button" onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add {singular}</button></div>{items.length ? <div className="mt-3 grid gap-3">{items.map((item, index) => <div key={item.id} className="flex items-start gap-2"><div className="min-w-0 flex-1"><IdentificationField label={`${title} ${index + 1}`} value={item.text} onChange={(text) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, text } : entry))} multiline field={{ path: `${path}[${item.id}].text`, label: `${title} ${index + 1}` }} {...history} /></div><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="mt-7 rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${singular} ${index + 1}`}><X size={17} /></button></div>)}</div> : null}</section>;
}

function IdentificationField({ label, value, onChange, field, syllabusId, revision, onOpenHistory, multiline = false, type = "text", min, step }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; type?: string; min?: number; step?: number }) {
  return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<div className="relative">{multiline ? <AutoResizeTextarea value={value} onChange={(event) => onChange(event.target.value)} minRows={2} className="rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={type} value={value} min={min} step={step} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} /></div></label>;
}

function listItems(value: unknown, legacy: unknown, name: string): ListItem[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? [{ id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, string>).id : `${name}-${index}`, text: (item as Record<string, string>).text }] : []);
  const text = stringValue(legacy);
  return text.trim() ? [{ id: `legacy-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, text }] : [];
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : value === 0 ? "0" : ""; }
