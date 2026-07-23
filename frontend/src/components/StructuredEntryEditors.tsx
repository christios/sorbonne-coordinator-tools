import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";
import { SelectMenu } from "@/components/SelectMenu";
import { AssessmentEntry, PloEntry, ResourceEntry, Rubric, assessmentEntries, bibliographyEntries, ploEntries, rubricEntries } from "@/services/syllabusContent";

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
    <div className="grid w-full min-w-0 max-w-full gap-7">
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
    <section className="w-full min-w-0 max-w-full">
      <div className="flex w-full min-w-0 max-w-full items-start justify-between gap-3">
        <div className="min-w-0"><h4 className="text-sm font-semibold text-[#344054]">{title}</h4><p className="mt-1 text-sm text-[#667085]">Add only the details needed to identify each source.</p></div>
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
    <article className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-[#d9dee7] bg-[#fdfdfd]">
      <div className="flex min-w-0 items-center gap-3 p-3">
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ChevronDown size={17} className={`shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="truncate text-sm font-semibold text-[#344054]">{resourceSummary(entry, kind) || `${kindLabel(kind)} ${index + 1}`}</span></button>
        <button type="button" onClick={() => onRemove(entry.id)} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${kindLabel(kind).toLowerCase()} ${index + 1}`}><X size={17} /></button>
      </div>
      {open ? <div className="grid min-w-0 gap-4 border-t border-[#e5e7eb] p-4">
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
  return <section><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#344054]">Programme learning outcomes</h4><button type="button" onClick={() => onChange([...entries, { id: crypto.randomUUID() }])} className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add outcome</button></div><div className="mt-3 grid gap-3">{entries.map((entry, index) => <PloCard key={entry.id} entry={entry} index={index} onChange={update} onRemove={() => onChange(entries.filter((item) => item.id !== entry.id))} {...history} />)}</div>{entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No programme learning outcomes added.</p> : null}</section>;
}

function PloCard({ entry, index, onChange, onRemove, ...history }: HistoryContext & { entry: PloEntry; index: number; onChange: (id: string, field: keyof PloEntry, next: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!ploSummary(entry, index));
  const update = (field: keyof PloEntry, next: string) => onChange(entry.id, field, next);
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]"><div className="flex items-start gap-3 p-3"><button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-start gap-2 text-left"><ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">PLO {index + 1}</span><span className="mt-0.5 block text-sm text-[#475467]">{ploSummary(entry, index) || "Untitled outcome"}</span></span></button><button type="button" onClick={onRemove} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove PLO ${index + 1}`}><X size={17} /></button></div>{open ? <div className="border-t border-[#e5e7eb] p-4">{entry.legacyText !== undefined ? <EntryInput label="Imported outcome" value={entry.legacyText} onChange={(next) => update("legacyText", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].legacyText`, label: `PLO ${index + 1} · Imported outcome` }} {...history} /> : <div className="grid gap-4 sm:grid-cols-[160px_1fr]"><EntryInput label="PLO code" value={entry.code ?? ""} onChange={(next) => update("code", next)} field={{ path: `learningOutcomes.plos[${entry.id}].code`, label: `PLO ${index + 1} · PLO code` }} {...history} /><EntryInput label="Outcome" value={entry.outcome ?? ""} onChange={(next) => update("outcome", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].outcome`, label: `PLO ${index + 1} · Outcome` }} {...history} /></div>}</div> : null}</article>;
}

function ploSummary(entry: PloEntry, index: number) { const text = entry.legacyText || entry.outcome || ""; return text.replace(new RegExp(`^PLO\\s*${index + 1}\\s*[:.]?\\s*`, "i"), ""); }

const AI_POLICIES = ["AI Prohibited", "AI Permitted as a Support Tool", "Restricted AI Use", "AI Required", "Other (Specify)"];
const AI_ALLOWED_USES = ["Brainstorming or generating initial ideas", "Language editing", "Structuring or organising ideas", "Clarifying concepts or obtaining explanations"];

export function AssessmentEditor({ value, outcomes, onChange, ...history }: HistoryContext & { value: Record<string, unknown>; outcomes: Array<Record<string, string> & { id: string }>; onChange: (value: Record<string, unknown>) => void }) {
  const entries = assessmentEntries(value.items);
  const update = (id: string, field: keyof AssessmentEntry, next: string | string[]) => onChange({ ...value, items: entries.map((entry) => entry.id === id ? { ...entry, [field]: next } : entry) });
  const remove = (id: string) => onChange({ ...value, items: entries.filter((entry) => entry.id !== id) });
  return <div className="grid gap-7"><section><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-[#344054]">Summary of graded learning activities</h4><p className="mt-1 text-sm text-[#667085]">Add one assessment at a time and link it to the relevant course outcomes.</p></div><button type="button" onClick={() => onChange({ ...value, items: [...entries, { id: crypto.randomUUID() }] })} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add assessment</button></div><div className="mt-3 grid gap-3">{entries.map((entry, index) => <AssessmentCard key={entry.id} entry={entry} index={index} outcomes={outcomes} onChange={update} onRemove={remove} {...history} />)}</div>{entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No assessments added.</p> : null}</section><AiPolicyEditor value={value} onChange={onChange} {...history} /><RubricEditor value={value.rubrics} onChange={(rubrics) => onChange({ ...value, rubrics })} {...history} /><NarrativeField label="Assessment methodologies" value={stringValue(value.methodologies)} onChange={(methodologies) => onChange({ ...value, methodologies })} field={{ path: "assessment.methodologies", label: "Assessment methodologies" }} {...history} /><NarrativeField label="Late submission policy" value={stringValue(value.lateSubmissionPolicy)} onChange={(lateSubmissionPolicy) => onChange({ ...value, lateSubmissionPolicy })} field={{ path: "assessment.lateSubmissionPolicy", label: "Late submission policy" }} {...history} /></div>;
}

function AssessmentCard({ entry, index, outcomes, onChange, onRemove, ...history }: HistoryContext & { entry: AssessmentEntry; index: number; outcomes: Array<Record<string, string> & { id: string }>; onChange: (id: string, field: keyof AssessmentEntry, value: string | string[]) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(!entry.type && !entry.date);
  const selectedIds = Array.isArray(entry.cloIds) ? entry.cloIds : outcomes.filter((outcome) => stringValue(entry.clos).includes(outcome.clo ?? "")).map((outcome) => outcome.id);
  const set = (field: keyof AssessmentEntry, value: string | string[]) => onChange(entry.id, field, value);
  const toggleClo = (outcome: Record<string, string> & { id: string }) => {
    const next = selectedIds.includes(outcome.id) ? selectedIds.filter((id) => id !== outcome.id) : [...selectedIds, outcome.id];
    set("cloIds", next);
    set("clos", outcomes.filter((item) => next.includes(item.id)).map((item) => item.clo).filter(Boolean).join(", "));
  };
  const path = `assessment.items[${entry.id}]`;
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]"><div className="flex items-center gap-3 p-3"><button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ChevronDown size={17} className={`shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="truncate text-sm font-semibold text-[#344054]">{stringValue(entry.type) || `Assessment ${index + 1}`}{entry.date ? ` · ${entry.date}` : ""}</span></button><button type="button" onClick={() => onRemove(entry.id)} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove assessment ${index + 1}`}><X size={17} /></button></div>{open ? <div className="grid gap-4 border-t border-[#e5e7eb] p-4"><div className="grid gap-4 sm:grid-cols-2"><EntryInput label="Assessment date" value={stringValue(entry.date)} onChange={(next) => set("date", next)} type="date" field={{ path: `${path}.date`, label: `Assessment ${index + 1} · Assessment date` }} {...history} /><EntryInput label="Assessment type" value={stringValue(entry.type)} onChange={(next) => set("type", next)} field={{ path: `${path}.type`, label: `Assessment ${index + 1} · Assessment type` }} {...history} /><EntryInput label="Weight (%)" value={stringValue(entry.weight)} onChange={(next) => set("weight", next)} type="number" min={0} max={100} step={1} field={{ path: `${path}.weight`, label: `Assessment ${index + 1} · Weight` }} {...history} /><label className="grid gap-1 text-sm font-medium text-[#344054]">Applicable AI policy<SelectMenu label={`Assessment ${index + 1} AI policy`} value={stringValue(entry.aiPolicy ?? entry.ai)} onChange={(next) => { set("aiPolicy", next); set("ai", next); }} options={AI_POLICIES.map((policy) => ({ value: policy, label: policy }))} trailing={<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: `${path}.aiPolicy`, label: `Assessment ${index + 1} · AI policy` }} onOpenSidebar={history.onOpenHistory} />} /></label></div><details className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e79]">CLOs assessed{selectedIds.length ? ` (${selectedIds.length})` : ""}</summary><div className="relative mt-3 grid gap-2">{outcomes.length ? outcomes.map((outcome) => <label key={outcome.id} className="flex items-start gap-2 rounded-md px-1 py-1 text-sm text-[#344054]"><input type="checkbox" checked={selectedIds.includes(outcome.id)} onChange={() => toggleClo(outcome)} /><span>{outcome.clo || "Untitled CLO"}</span></label>) : <p className="text-sm text-[#667085]">Add course learning outcomes first, then select the ones assessed here.</p>}<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: `${path}.cloIds`, label: `Assessment ${index + 1} · CLOs assessed` }} onOpenSidebar={history.onOpenHistory} placement="top" /></div></details></div> : null}</article>;
}

function AiPolicyEditor({ value, onChange, ...history }: HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const policy = stringValue(value.aiPolicy) || "AI Prohibited";
  const allowedUses = Array.isArray(value.aiAllowedUses) ? value.aiAllowedUses.filter((item): item is string => typeof item === "string") : [];
  const setUse = (use: string) => onChange({ ...value, aiAllowedUses: allowedUses.includes(use) ? allowedUses.filter((item) => item !== use) : [...allowedUses, use] });
  return <section><h4 className="text-sm font-semibold text-[#344054]">AI policy</h4><div className="mt-3 grid gap-4"><label className="grid gap-1 text-sm font-medium text-[#344054]">Course-level policy<SelectMenu label="Course-level AI policy" value={policy} onChange={(aiPolicy) => onChange({ ...value, aiPolicy })} options={AI_POLICIES.map((option) => ({ value: option, label: option }))} trailing={<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: "assessment.aiPolicy", label: "AI policy" }} onOpenSidebar={history.onOpenHistory} />} /></label>{policy === "AI Permitted as a Support Tool" ? <fieldset className="rounded-md border border-[#d9dee7] p-4"><legend className="px-1 text-sm font-semibold text-[#344054]">Permitted uses</legend><div className="mt-2 grid gap-2">{AI_ALLOWED_USES.map((use) => <label key={use} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={allowedUses.includes(use)} onChange={() => setUse(use)} />{use}</label>)}</div><EntryInput label="Other permitted use" value={stringValue(value.aiOtherUse)} onChange={(aiOtherUse) => onChange({ ...value, aiOtherUse })} field={{ path: "assessment.aiOtherUse", label: "Other permitted AI use" }} {...history} /></fieldset> : null}{policy === "AI Prohibited" ? <EntryInput label="Verification mechanism" value={stringValue(value.aiVerificationMechanism)} onChange={(aiVerificationMechanism) => onChange({ ...value, aiVerificationMechanism })} field={{ path: "assessment.aiVerificationMechanism", label: "AI verification mechanism" }} {...history} /> : null}{policy === "Other (Specify)" ? <NarrativeField label="Specify the AI policy" value={stringValue(value.aiCustomPolicy)} onChange={(aiCustomPolicy) => onChange({ ...value, aiCustomPolicy })} field={{ path: "assessment.aiCustomPolicy", label: "Custom AI policy" }} {...history} /> : null}<NarrativeField label="Additional instructions regarding AI" value={stringValue(value.aiInstructions)} onChange={(aiInstructions) => onChange({ ...value, aiInstructions })} field={{ path: "assessment.aiInstructions", label: "Additional instructions regarding AI" }} {...history} /></div></section>;
}

function RubricEditor({ value, onChange, ...history }: HistoryContext & { value: unknown; onChange: (value: Rubric[]) => void }) {
  const rubrics = rubricEntries(value);
  const updateRubric = (id: string, updater: (rubric: Rubric) => Rubric) => onChange(rubrics.map((rubric) => rubric.id === id ? updater(rubric) : rubric));
  return <section><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-[#344054]">Grading rubrics</h4><p className="mt-1 text-sm text-[#667085]">Use one rubric per assessment type.</p></div><button type="button" onClick={() => onChange([...rubrics, { id: crypto.randomUUID(), criteria: [] }])} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add rubric</button></div><div className="mt-3 grid gap-3">{rubrics.map((rubric, rubricIndex) => <article key={rubric.id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"><div className="flex items-start justify-between gap-3"><div className="flex-1"><EntryInput label="Assessment type" value={rubric.assignment ?? ""} onChange={(assignment) => updateRubric(rubric.id, (current) => ({ ...current, assignment }))} field={{ path: `assessment.rubrics[${rubric.id}].assignment`, label: `Rubric ${rubricIndex + 1} · Assessment type` }} {...history} /></div><button type="button" onClick={() => onChange(rubrics.filter((item) => item.id !== rubric.id))} className="mt-7 text-sm font-semibold text-[#a6292f] hover:underline">Remove</button></div><div className="mt-4 grid gap-3">{rubric.criteria.map((criterion, criterionIndex) => <div key={criterion.id} className="rounded-md border border-[#e5e7eb] bg-white p-3"><div className="mb-3 flex justify-between gap-3"><p className="text-sm font-semibold text-[#344054]">Criterion {criterionIndex + 1}</p><button type="button" onClick={() => updateRubric(rubric.id, (current) => ({ ...current, criteria: current.criteria.filter((item) => item.id !== criterion.id) }))} className="text-sm font-semibold text-[#a6292f] hover:underline">Remove</button></div><div className="grid gap-3"><EntryInput label="Criterion" value={criterion.criterion ?? ""} onChange={(next) => updateCriterion(updateRubric, rubric.id, criterion.id, { criterion: next })} field={{ path: `assessment.rubrics[${rubric.id}].criteria[${criterion.id}].criterion`, label: `Rubric ${rubricIndex + 1} · Criterion ${criterionIndex + 1}` }} {...history} /><div className="grid gap-3 sm:grid-cols-3"><EntryInput label="Inadequate (0–9)" value={criterion.inadequate ?? ""} onChange={(next) => updateCriterion(updateRubric, rubric.id, criterion.id, { inadequate: next })} multiline field={{ path: `assessment.rubrics[${rubric.id}].criteria[${criterion.id}].inadequate`, label: `Rubric ${rubricIndex + 1} · Inadequate` }} {...history} /><EntryInput label="Meets expectations (10–15)" value={criterion.meets ?? ""} onChange={(next) => updateCriterion(updateRubric, rubric.id, criterion.id, { meets: next })} multiline field={{ path: `assessment.rubrics[${rubric.id}].criteria[${criterion.id}].meets`, label: `Rubric ${rubricIndex + 1} · Meets expectations` }} {...history} /><EntryInput label="Exceeds expectations (16–20)" value={criterion.exceeds ?? ""} onChange={(next) => updateCriterion(updateRubric, rubric.id, criterion.id, { exceeds: next })} multiline field={{ path: `assessment.rubrics[${rubric.id}].criteria[${criterion.id}].exceeds`, label: `Rubric ${rubricIndex + 1} · Exceeds expectations` }} {...history} /></div></div></div>)}<button type="button" onClick={() => updateRubric(rubric.id, (current) => ({ ...current, criteria: [...current.criteria, { id: crypto.randomUUID() }] }))} className="text-left text-sm font-semibold text-[#1f4e79] hover:underline">+ Add criterion</button></div></article>)}</div>{rubrics.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No grading rubrics added.</p> : null}</section>;
}

function updateCriterion(updateRubric: (id: string, updater: (rubric: Rubric) => Rubric) => void, rubricId: string, criterionId: string, change: Partial<Rubric["criteria"][number]>) { updateRubric(rubricId, (rubric) => ({ ...rubric, criteria: rubric.criteria.map((criterion) => criterion.id === criterionId ? { ...criterion, ...change } : criterion) })); }

function NarrativeField({ label, value, onChange, field, ...history }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField }) { return <EntryInput label={label} value={value} onChange={onChange} multiline field={field} {...history} />; }

function EntryInput({ label, value, onChange, field, syllabusId, revision, onOpenHistory, multiline = false, type = "text", min, max, step }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; type?: string; min?: number; max?: number; step?: number }) {
  return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<div className="relative">{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="w-full resize-y rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={type} value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} /></div></label>;
}

function resourceSummary(entry: ResourceEntry, kind: EntryProps["kind"]) { return kind === "website" ? entry.organisation || entry.url || entry.legacyText : entry.title || entry.legacyText || entry.authors; }
function kindLabel(kind: EntryProps["kind"]) { return kind === "book" ? "Book" : kind === "website" ? "Website" : "Journal article"; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
