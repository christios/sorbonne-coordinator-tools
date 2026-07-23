import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";
import { PloEntry, ResourceEntry, bibliographyEntries, ploEntries } from "@/services/syllabusContent";

type HistoryContext = { syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void };

type EntryProps = HistoryContext & {
  title: string;
  entries: ResourceEntry[];
  kind: "book" | "website" | "article";
  path: string;
  onChange: (entries: ResourceEntry[]) => void;
};

export function BibliographyEditor({ value, onChange, ...history }: HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const books = bibliographyEntries(value.books);
  const websites = bibliographyEntries(value.websites);
  const articles = bibliographyEntries(value.journalArticles);
  return (
    <div className="grid gap-7">
      <ResourceList title="Books" entries={books} kind="book" path="bibliography.books" onChange={(next) => onChange({ ...value, books: next })} {...history} />
      <ResourceList title="Websites" entries={websites} kind="website" path="bibliography.websites" onChange={(next) => onChange({ ...value, websites: next })} {...history} />
      <ResourceList title="Journal articles" entries={articles} kind="article" path="bibliography.journalArticles" onChange={(next) => onChange({ ...value, journalArticles: next })} {...history} />
    </div>
  );
}

function ResourceList({ title, entries, kind, path, onChange, ...history }: EntryProps) {
  const add = () => onChange([...entries, { id: crypto.randomUUID() }]);
  const update = (id: string, field: keyof ResourceEntry, value: string) => onChange(entries.map((entry) => entry.id === id ? { ...entry, [field]: value } : entry));
  const remove = (id: string) => onChange(entries.filter((entry) => entry.id !== id));
  const action = kind === "book" ? "Add book" : kind === "website" ? "Add website" : "Add article";
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div><h4 className="text-sm font-semibold text-[#344054]">{title}</h4><p className="mt-1 text-sm text-[#667085]">Add only the details needed to identify each source.</p></div>
        <button type="button" onClick={add} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> {action}</button>
      </div>
      <div className="mt-3 grid gap-3">
        {entries.map((entry, index) => (
          <ResourceCard key={entry.id} entry={entry} index={index} kind={kind} path={`${path}[${entry.id}]`} onChange={update} onRemove={remove} {...history} />
        ))}
      </div>
      {entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No {title.toLowerCase()} added.</p> : null}
    </section>
  );
}

function ResourceCard({ entry, index, kind, path, onChange, onRemove, ...history }: HistoryContext & { entry: ResourceEntry; index: number; kind: EntryProps["kind"]; path: string; onChange: (id: string, field: keyof ResourceEntry, value: string) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(Boolean(entry.legacyText) || !resourceSummary(entry, kind));
  const set = (field: keyof ResourceEntry, value: string) => onChange(entry.id, field, value);
  const input = (label: string, field: keyof ResourceEntry, multiline = false, type = "text") => <EntryInput key={field} label={label} value={entry[field] ?? ""} onChange={(value) => set(field, value)} multiline={multiline} type={type} field={{ path: `${path}.${field}`, label: `${kindLabel(kind)} ${index + 1} · ${label}` }} {...history} />;
  return (
    <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]">
      <div className="flex items-center gap-3 p-3">
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ChevronDown size={17} className={`shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="truncate text-sm font-semibold text-[#344054]">{resourceSummary(entry, kind) || `${kindLabel(kind)} ${index + 1}`}</span></button>
        <button type="button" onClick={() => onRemove(entry.id)} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${kindLabel(kind).toLowerCase()} ${index + 1}`}><X size={17} /></button>
      </div>
      {open ? <div className="grid gap-4 border-t border-[#e5e7eb] p-4">
        {entry.legacyText !== undefined ? input("Imported reference", "legacyText", true) : <ResourceCoreFields kind={kind} input={input} />}
        {entry.legacyText === undefined ? <details className="group rounded-md border border-[#e5e7eb] bg-white px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e79]">Add publication details</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><ResourceDetails kind={kind} input={input} /></div></details> : null}
      </div> : null}
    </article>
  );
}

function ResourceCoreFields({ kind, input }: { kind: EntryProps["kind"]; input: (label: string, field: keyof ResourceEntry, multiline?: boolean, type?: string) => React.ReactNode }) {
  if (kind === "website") return <div className="grid gap-4 sm:grid-cols-2">{input("Name or organisation", "organisation")}{input("URL", "url", false, "url")}</div>;
  if (kind === "article") return <div className="grid gap-4 sm:grid-cols-2">{input("Author(s)", "authors")}{input("Article title", "title")}{input("Journal", "journal")}</div>;
  return <div className="grid gap-4 sm:grid-cols-2">{input("Author(s)", "authors")}{input("Title", "title")}</div>;
}

function ResourceDetails({ kind, input }: { kind: EntryProps["kind"]; input: (label: string, field: keyof ResourceEntry, multiline?: boolean, type?: string) => React.ReactNode }) {
  if (kind === "website") return <>{input("Accessed date", "accessedDate", false, "date")}</>;
  if (kind === "article") return <>{input("Year", "year", false, "number")}{input("Volume", "volume")}{input("Issue", "issue")}{input("Pages", "pages")}{input("DOI or URL", "doi", false, "url")}</>;
  return <>{input("Year", "year", false, "number")}{input("Edition", "edition")}{input("Publisher", "publisher")}{input("ISBN or URL", "isbn")}</>;
}

export function PloEditor({ value, onChange, ...history }: HistoryContext & { value: unknown; onChange: (value: PloEntry[]) => void }) {
  const entries = ploEntries(value);
  const update = (id: string, field: keyof PloEntry, next: string) => onChange(entries.map((entry) => entry.id === id ? { ...entry, [field]: next } : entry));
  return <section><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-[#344054]">Programme learning outcomes</h4><p className="mt-1 text-sm text-[#667085]">Add one programme outcome at a time.</p></div><button type="button" onClick={() => onChange([...entries, { id: crypto.randomUUID() }])} className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add PLO</button></div><div className="mt-3 grid gap-3">{entries.map((entry, index) => <article key={entry.id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold text-[#344054]">PLO {index + 1}</p><button type="button" onClick={() => onChange(entries.filter((item) => item.id !== entry.id))} className="text-sm font-semibold text-[#a6292f] hover:underline">Remove</button></div>{entry.legacyText !== undefined ? <EntryInput label="Imported outcome" value={entry.legacyText} onChange={(next) => update(entry.id, "legacyText", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].legacyText`, label: `PLO ${index + 1} · Imported outcome` }} {...history} /> : <div className="grid gap-4 sm:grid-cols-[160px_1fr]"><EntryInput label="PLO code" value={entry.code ?? ""} onChange={(next) => update(entry.id, "code", next)} field={{ path: `learningOutcomes.plos[${entry.id}].code`, label: `PLO ${index + 1} · PLO code` }} {...history} /><EntryInput label="Outcome" value={entry.outcome ?? ""} onChange={(next) => update(entry.id, "outcome", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].outcome`, label: `PLO ${index + 1} · Outcome` }} {...history} /></div>}</article>)}</div>{entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No programme learning outcomes added.</p> : null}</section>;
}

function EntryInput({ label, value, onChange, field, syllabusId, revision, onOpenHistory, multiline = false, type = "text" }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; type?: string }) {
  return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<div className="relative">{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} /></div></label>;
}

function resourceSummary(entry: ResourceEntry, kind: EntryProps["kind"]) { return kind === "website" ? entry.organisation || entry.url || entry.legacyText : entry.title || entry.legacyText || entry.authors; }
function kindLabel(kind: EntryProps["kind"]) { return kind === "book" ? "Book" : kind === "website" ? "Website" : "Journal article"; }
