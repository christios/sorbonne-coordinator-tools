import { AddEntryButton } from "@/components/AddEntryButton";
import { FieldRow } from "@/components/FieldRow";
import { SyllabusField } from "@/components/SyllabusField";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";
import { PloAlignmentField } from "@/components/PloAlignmentField";
import { ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";

import { FieldHistoryControl, HistoryField } from "@/components/FieldHistory";
import { DateField } from "@/components/DateField";
import { SelectMenu } from "@/components/SelectMenu";
import { HistoryTextField } from "@/components/HistoryTextField";
import { InfoTip } from "@/components/InfoTip";
import { BibliographyReferenceFinder } from "@/components/BibliographyReferenceFinder";
import { AssessmentEntry, PloEntry, ResourceEntry, RubricInUse, assessmentEntries, bibliographyEntries, ploEntries, rubricsInUse } from "@/services/syllabusContent";
import { CatalogueEntry } from "@/services/syllabusCatalogues";
import { OTHER_AI_OPTION, activityAiPolicy, aiOption, aiOptions, aiOptionsInUse, templatePermittedUse } from "@/services/aiPolicy";
import { BibliographyLookupItem } from "@/services/bibliographyLookup";

type HistoryContext = { syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void };

type EntryProps = HistoryContext & {
  title: string;
  entries: ResourceEntry[];
  kind: "book" | "website" | "article";
  path: string;
  onChange: (entries: ResourceEntry[]) => void;
};

export function BibliographyEditor({ value, onChange, ...history }: HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const [tab, setTab] = useState<"books" | "websites" | "articles">("books");
  const books = bibliographyEntries(value.books);
  const websites = bibliographyEntries(value.websites);
  const articles = bibliographyEntries(value.journalArticles);
  const tabs = [{ key: "books" as const, label: "Books" }, { key: "websites" as const, label: "Websites" }, { key: "articles" as const, label: "Journal articles" }];
  return <div><div role="tablist" aria-label="Bibliography editor" className="flex gap-1 overflow-x-auto border-b border-[#d9dee7]">{tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === item.key ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"}`}>{item.label}</button>)}</div><div role="tabpanel" className="mt-5 min-w-0">{tab === "books" ? <ResourceList title="Books" entries={books} kind="book" path="bibliography.books" onChange={(next) => onChange({ ...value, books: next })} {...history} /> : null}{tab === "websites" ? <ResourceList title="Websites" entries={websites} kind="website" path="bibliography.websites" onChange={(next) => onChange({ ...value, websites: next })} {...history} /> : null}{tab === "articles" ? <ResourceList title="Journal articles" entries={articles} kind="article" path="bibliography.journalArticles" onChange={(next) => onChange({ ...value, journalArticles: next })} {...history} /> : null}</div></div>;
}

function ResourceList({ title, entries, kind, path, onChange, ...history }: EntryProps) {
  const add = () => onChange([...entries, { id: crypto.randomUUID(), entryMode: "freeform" }]);
  const update = (id: string, patch: Partial<ResourceEntry>) => onChange(entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const remove = (id: string) => onChange(entries.filter((entry) => entry.id !== id));
  const action = kind === "book" ? "Add book" : kind === "website" ? "Add website" : "Add article";
  return (
    <section className="w-full min-w-0 max-w-full">
      <div className="min-w-0"><h4 className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">{title}<InfoTip label={`What to enter for ${title.toLowerCase()}`}>Add only the details needed to identify each source.</InfoTip></h4></div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
        {entries.map((entry, index) => (
          <ResourceCard key={entry.id} entry={entry} index={index} kind={kind} path={`${path}[${entry.id}]`} onChange={update} onRemove={remove} {...history} />
        ))}
      </div>
      {entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No {title.toLowerCase()} added.</p> : null}
      <AddEntryButton onClick={add} label={action} />
    </section>
  );
}

function ResourceCard({ entry, index, kind, path, onChange, onRemove, ...history }: HistoryContext & { entry: ResourceEntry; index: number; kind: EntryProps["kind"]; path: string; onChange: (id: string, patch: Partial<ResourceEntry>) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(Boolean(entry.legacyText) || !resourceSummary(entry, kind));
  const set = (field: keyof ResourceEntry, value: string) => onChange(entry.id, { [field]: value });
  const mode = entry.legacyText !== undefined ? "freeform" : entry.entryMode ?? "structured";
  const setMode = (next: "structured" | "freeform") => onChange(entry.id, { entryMode: next });
  const applyReference = (result: BibliographyLookupItem) => {
    if (kind !== "website") onChange(entry.id, referencePatch(kind, result));
  };
  const input = (label: string, field: keyof ResourceEntry, multiline = false, type = "text", size: FieldSize = "full") => <EntryInput key={field} label={label} value={entry[field] ?? ""} onChange={(value) => set(field, value)} multiline={multiline} type={type} size={size} field={{ path: `${path}.${field}`, label: `${kindLabel(kind)} ${index + 1} · ${label}` }} {...history} />;
  return (
    <article className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-[#d9dee7] bg-[#fdfdfd]">
      <div className="flex min-w-0 items-center gap-3 p-3">
        <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ChevronDown size={17} className={`shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="truncate text-sm font-semibold text-[#344054]">{resourceSummary(entry, kind) || `${kindLabel(kind)} ${index + 1}`}</span></button>
        <button type="button" onClick={() => onRemove(entry.id)} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${kindLabel(kind).toLowerCase()} ${index + 1}`}><X size={17} /></button>
      </div>
      {open ? <div className="grid grid-cols-[minmax(0,1fr)] min-w-0 gap-4 border-t border-[#e5e7eb] p-4">
        {entry.legacyText !== undefined ? input("Imported reference", "legacyText", false, "text", "sentence") : <><div className="flex justify-center"><div className="flex w-fit rounded-md border border-[#cbd5e1] bg-white p-1"><button type="button" onClick={() => setMode("structured")} className={`rounded px-2.5 py-1 text-sm font-semibold ${mode === "structured" ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}>Structured</button><button type="button" onClick={() => setMode("freeform")} className={`rounded px-2.5 py-1 text-sm font-semibold ${mode === "freeform" ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}>Freeform</button></div></div>{kind !== "website" ? <BibliographyReferenceFinder kind={kind} onApply={applyReference} /> : null}{mode === "freeform" ? input("Reference", "freeformText", false, "text", "sentence") : <><ResourceCoreFields kind={kind} input={input} /><details className="group rounded-md border border-[#e5e7eb] bg-white px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-[#1f4e79]">Add publication details</summary><FieldRow className="mt-4"><ResourceDetails kind={kind} input={input} /></FieldRow></details></>}</>}
      </div> : null}
    </article>
  );
}

function ResourceCoreFields({ kind, input }: { kind: EntryProps["kind"]; input: (label: string, field: keyof ResourceEntry, multiline?: boolean, type?: string, size?: FieldSize) => React.ReactNode }) {
  if (kind === "website") return <FieldRow>{input("Name or organisation", "organisation", false, "text", "name")}{input("URL", "url", false, "url", "line")}</FieldRow>;
  if (kind === "article") return <FieldRow>{input("Author(s)", "authors", false, "text", "name")}{input("Article title", "title", false, "text", "line")}{input("Journal", "journal", false, "text", "name")}</FieldRow>;
  return <FieldRow>{input("Author(s)", "authors", false, "text", "name")}{input("Title", "title", false, "text", "line")}</FieldRow>;
}

function ResourceDetails({ kind, input }: { kind: EntryProps["kind"]; input: (label: string, field: keyof ResourceEntry, multiline?: boolean, type?: string, size?: FieldSize) => React.ReactNode }) {
  if (kind === "website") return <>{input("Accessed date", "accessedDate", false, "date", "code")}</>;
  if (kind === "article") return <>{input("Year", "year", false, "number", "counter")}{input("Volume", "volume", false, "text", "counter")}{input("Issue", "issue", false, "text", "counter")}{input("Pages", "pages", false, "text", "code")}{input("DOI or URL", "doi", false, "url", "line")}</>;
  return <>{input("Year", "year", false, "number", "counter")}{input("Edition", "edition", false, "text", "code")}{input("Publisher", "publisher", false, "text", "name")}{input("ISBN or URL", "isbn", false, "text", "name")}</>;
}

export function PloEditor({ value, onChange, ...history }: HistoryContext & { value: unknown; onChange: (value: PloEntry[]) => void }) {
  const entries = ploEntries(value);
  const update = (id: string, field: keyof PloEntry, next: string) => onChange(entries.map((entry) => entry.id === id ? { ...entry, [field]: next } : entry));
  return <section><div className="flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#344054]">Programme learning outcomes</h4><button type="button" onClick={() => onChange([...entries, { id: crypto.randomUUID() }])} className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> Add outcome</button></div><div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">{entries.map((entry, index) => <PloCard key={entry.id} entry={entry} index={index} onChange={update} onRemove={() => onChange(entries.filter((item) => item.id !== entry.id))} {...history} />)}</div>{entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No programme learning outcomes added.</p> : null}</section>;
}

function PloCard({ entry, index, onChange, onRemove, ...history }: HistoryContext & { entry: PloEntry; index: number; onChange: (id: string, field: keyof PloEntry, next: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(!ploSummary(entry, index));
  const update = (field: keyof PloEntry, next: string) => onChange(entry.id, field, next);
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]"><div className="flex items-start gap-3 p-3"><button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-start gap-2 text-left"><ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">PLO {index + 1}</span><span className="mt-0.5 block text-sm text-[#475467]">{ploSummary(entry, index) || "Untitled outcome"}</span></span></button><button type="button" onClick={onRemove} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove PLO ${index + 1}`}><X size={17} /></button></div>{open ? <div className="border-t border-[#e5e7eb] p-4">{entry.legacyText !== undefined ? <EntryInput label="Imported outcome" value={entry.legacyText} onChange={(next) => update("legacyText", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].legacyText`, label: `PLO ${index + 1} · Imported outcome` }} {...history} /> : <EntryInput label="Outcome" value={entry.outcome ?? ""} onChange={(next) => update("outcome", next)} multiline field={{ path: `learningOutcomes.plos[${entry.id}].outcome`, label: `PLO ${index + 1} · Outcome` }} {...history} />}</div> : null}</article>;
}

function ploSummary(entry: PloEntry, index: number) { const text = entry.legacyText || entry.outcome || ""; return text.replace(new RegExp(`^PLO\\s*${index + 1}\\s*[:.]?\\s*`, "i"), ""); }


export type CloKey = "cloIds" | "catalogueCloIds";

export function AssessmentItemsEditor({ value, outcomes, assessmentTypes = [], aiPolicies = [], cloKey = "cloIds", onChange, ...history }: HistoryContext & { value: Record<string, unknown>; outcomes: Array<Record<string, string> & { id: string }>; assessmentTypes?: CatalogueEntry[]; aiPolicies?: CatalogueEntry[]; cloKey?: CloKey; onChange: (value: Record<string, unknown>) => void }) {
  const scheduleBy = stringValue(value.scheduleBy) === "week" ? "week" : "date";
  const entries = assessmentEntries(value.items);
  const update = (id: string, changes: Partial<AssessmentEntry>) => onChange({ ...value, items: entries.map((entry) => entry.id === id ? { ...entry, ...changes } : entry) });
  const remove = (id: string) => onChange({ ...value, items: entries.filter((entry) => entry.id !== id) });
  return <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">Summary of graded learning activities<InfoTip label="How to add the graded activities">Add one assessment at a time and link it to the relevant course outcomes.</InfoTip></h4></div><fieldset className="shrink-0"><legend className="text-sm font-medium text-[#344054]">Show each assessment by</legend><div className="mt-1 inline-flex rounded-md border border-[#b7bec8] bg-white p-0.5">{([["date","Date"],["week","Week"]] as const).map(([mode,modeLabel]) => <button key={mode} type="button" aria-pressed={scheduleBy === mode} onClick={() => onChange({ ...value, scheduleBy: mode })} className={`rounded px-3 py-1 text-sm font-semibold ${scheduleBy === mode ? "bg-[#1f4e79] text-white" : "text-[#1f4e79] hover:bg-[#f2f7fb]"}`}>{modeLabel}</button>)}</div></fieldset></div><div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">{entries.map((entry, index) => <AssessmentCard key={entry.id} entry={entry} index={index} outcomes={outcomes} assessmentTypes={assessmentTypes} aiPolicies={aiPolicies} courseAiPolicy={stringValue(value.aiPolicy)} cloKey={cloKey} scheduleBy={scheduleBy} onChange={update} onRemove={remove} {...history} />)}</div>{entries.length === 0 ? <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No assessments added.</p> : null}<AddEntryButton onClick={() => onChange({ ...value, items: [...entries, { id: crypto.randomUUID() }] })} label="Add assessment" /></section>;
}

/**
 * The AI policy tab: no course-wide choice any more. Each option the graded activities apply
 * is shown open, with the template's wording and the details that option asks for, in the
 * order the template's table lists them (November 2026 review).
 */
export function AssessmentAiPolicyEditor({ value, onChange, activities, aiFallback, aiPolicies = [], ...history }: HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; activities?: AssessmentEntry[]; /** The course-wide policy an older syllabus set; none once converted. */ aiFallback?: string; aiPolicies?: CatalogueEntry[] }) {
  const graded = activities ?? assessmentEntries(value.items);
  const fallback = aiFallback ?? stringValue(value.aiPolicy);
  const options = aiOptions(aiPolicies);
  const inUse = aiOptionsInUse(graded, fallback);
  const usedBy = (label: string) => graded.filter((activity) => aiOption(activityAiPolicy(activity, fallback).label) === label);
  const named = (activity: AssessmentEntry, index: number) => stringValue(activity.name) || stringValue(activity.type) || `Assessment ${graded.indexOf(activity) + 1 || index + 1}`;
  const allowedUses = Array.isArray(value.aiAllowedUses) ? value.aiAllowedUses.filter((item): item is string => typeof item === "string").map(templatePermittedUse) : [];
  const setUse = (use: string) => onChange({ ...value, aiAllowedUses: allowedUses.includes(use) ? allowedUses.filter((item) => item !== use) : [...allowedUses, use] });
  return <section className="grid grid-cols-[minmax(0,1fr)] gap-4">
    <div><h4 className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">AI policy<InfoTip label="Where the options come from">Each graded activity chooses its AI policy. Every option they choose is shown here, as the syllabus prints it, with what it asks of you.</InfoTip></h4><p className="mt-1 text-sm text-[#667085]">One section per AI policy your graded activities apply.</p></div>
    {inUse.length ? inUse.map((label) => {
      const option = options.find((item) => item.label === label);
      const activitiesUsing = usedBy(label);
      return <article key={label} aria-label={label} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4">
        <p className="text-sm font-semibold text-[#344054]">{label}</p>
        <p className="mt-0.5 text-sm text-[#667085]">Applied by {activitiesUsing.map(named).join(", ")}</p>
        {option?.wording ? <p className="mt-3 whitespace-pre-line text-sm text-[#475467]">{option.wording}</p> : null}
        {label === "AI Prohibited" ? <div className="mt-4"><EntryInput label="Verification mechanism" value={stringValue(value.aiVerificationMechanism)} onChange={(aiVerificationMechanism) => onChange({ ...value, aiVerificationMechanism })} field={{ path: "assessment.aiVerificationMechanism", label: "AI verification mechanism" }} {...history} /></div> : null}
        {label === "AI Permitted as a Support Tool" ? <fieldset className="mt-4"><legend className="text-sm font-semibold text-[#344054]">Permitted uses</legend><div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">{(option?.permittedUses ?? []).map((use) => <label key={use} className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={allowedUses.includes(use)} onChange={() => setUse(use)} />{use}</label>)}</div><OtherPermittedUsesEditor value={value} onChange={onChange} {...history} /></fieldset> : null}
        {label === OTHER_AI_OPTION ? <ul className="mt-3 grid gap-1 text-sm text-[#475467]">{activitiesUsing.map((activity, index) => <li key={activity.id}><span className="font-medium text-[#344054]">{named(activity, index)}:</span> {stringValue(activity.aiOtherText) || <span className="text-[#a6292f]">not described yet — describe it on the activity</span>}</li>)}</ul> : null}
      </article>;
    }) : <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">Choose an AI policy for each graded activity and its section will appear here.</p>}
    <NarrativeField label="Additional instructions regarding AI" value={stringValue(value.aiInstructions)} onChange={(aiInstructions) => onChange({ ...value, aiInstructions })} field={{ path: "assessment.aiInstructions", label: "Additional instructions regarding AI" }} {...history} />
  </section>;
}

type OtherPermittedUse = { id: string; text: string };

function OtherPermittedUsesEditor({ value, onChange, ...history }: HistoryContext & { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const uses = otherPermittedUses(value);
  const save = (next: OtherPermittedUse[]) => onChange({ ...value, aiOtherUses: next, aiOtherUse: next.map((item) => item.text).filter(Boolean).join("\n") });
  return <section className="mt-4"><h5 className="text-sm font-semibold text-[#344054]">Other permitted uses</h5>{uses.length ? <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">{uses.map((item, index) => <div key={item.id} className="flex items-end gap-2"><div className="min-w-0 flex-1"><EntryInput label={`Other permitted use ${index + 1}`} value={item.text} onChange={(text) => save(uses.map((entry) => entry.id === item.id ? { ...entry, text } : entry))} field={{ path: `assessment.aiOtherUses[${item.id}].text`, label: `Other permitted use ${index + 1}` }} {...history} /></div><button type="button" onClick={() => save(uses.filter((entry) => entry.id !== item.id))} className="mb-0.5 rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove other permitted use ${index + 1}`}><X size={17} /></button></div>)}</div> : null}<AddEntryButton onClick={() => save([...uses, { id: crypto.randomUUID(), text: "" }])} label="Add permitted use" /></section>;
}

function otherPermittedUses(value: Record<string, unknown>): OtherPermittedUse[] {
  if (Array.isArray(value.aiOtherUses)) return value.aiOtherUses.flatMap((item, index) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? [{ id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, string>).id : `legacy-other-use-${index}`, text: (item as Record<string, string>).text }] : []);
  const legacy = stringValue(value.aiOtherUse);
  return legacy.trim() ? [{ id: "legacy-other-use-0", text: legacy }] : [];
}

export function AssessmentGradingEditor({ value, activities, assessmentTypes = [], ...history }: HistoryContext & { value: Record<string, unknown>; activities?: AssessmentEntry[]; assessmentTypes?: CatalogueEntry[]; onChange?: (value: Record<string, unknown>) => void }) {
  void history;
  // The rubrics follow from the graded activities, exactly as the document prints them, so
  // there is nothing to tick here and nothing that can disagree with section 9.1.
  const shown = rubricsInUse(activities ?? assessmentEntries(value.items), value.rubrics, assessmentTypes);
  return <section><div><h4 className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">Grading rubrics<InfoTip label="Where the rubrics come from">They are maintained in the catalogue and appear here automatically.</InfoTip></h4><p className="mt-1 text-sm text-[#667085]">One rubric per assessment type used in this course.</p></div>{shown.length ? <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">{shown.map((rubric) => <RubricTable key={rubric.id} rubric={rubric} />)}</div> : <p className="mt-3 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">Choose an assessment type for each graded activity and its rubric will appear here.</p>}</section>;
}

function RubricTable({ rubric }: { rubric: RubricInUse }) {
  const criteria = rubric.criteria;
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"><p className="text-sm font-semibold text-[#344054]">{rubric.label}</p>{criteria.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[46rem] border-collapse text-left text-sm"><thead><tr className="text-[#344054]"><th className="border-b border-[#d9dee7] py-2 pr-3 font-semibold">Criteria</th><th className="border-b border-[#d9dee7] py-2 pr-3 font-semibold">Inadequate (0–9)</th><th className="border-b border-[#d9dee7] py-2 pr-3 font-semibold">Meets expectations (10–15)</th><th className="border-b border-[#d9dee7] py-2 font-semibold">Exceeds expectations (16–20)</th></tr></thead><tbody>{criteria.map((criterion, index) => <tr key={index} className="align-top text-[#475467]"><td className="border-b border-[#eef1f5] py-2 pr-3 font-medium text-[#344054]">{criterion.name}</td><td className="border-b border-[#eef1f5] py-2 pr-3">{criterion.inadequate}</td><td className="border-b border-[#eef1f5] py-2 pr-3">{criterion.meets}</td><td className="border-b border-[#eef1f5] py-2">{criterion.exceeds}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-[#667085]">This rubric has not been written yet.</p>}</article>;
}

/**
 * What a graded activity says about itself: when, what kind, how much it counts, which outcomes
 * it assesses and the AI policy it applies. The assessment list of an older syllabus and the
 * course schedule's graded cards (November 2026) ask exactly the same of it.
 *
 * `timing` is how it is placed: by date or by week on the assessment list, as the syllabus
 * chose; in the schedule always by week, a date being optional.
 */
export function GradedActivityFields({ entry, index, path, name = `Assessment ${index + 1}`, outcomes, assessmentTypes = [], aiPolicies = [], courseAiPolicy = "", cloKey = "cloIds", timing, onChange, ...history }: HistoryContext & { entry: AssessmentEntry; index: number; /** Where the activity's fields are stored, for their history. */ path: string; /** How the activity is named in field history. */ name?: string; outcomes: Array<Record<string, string> & { id: string }>; assessmentTypes?: CatalogueEntry[]; aiPolicies?: CatalogueEntry[]; courseAiPolicy?: string; cloKey?: CloKey; timing: "date" | "week" | "both"; onChange: (changes: Partial<AssessmentEntry>) => void }) {
  const inheritedAiPolicy = stringValue(entry.aiPolicy ?? entry.ai) ? "" : courseAiPolicy;
  const selectedIds = selectedCloIds(entry, outcomes, cloKey);
  const set = (field: keyof AssessmentEntry, value: string | string[]) => onChange({ [field]: value });
  const typeOptions = assessmentTypes.map((item) => ({ value: item.id, label: item.label }));
  return <><FieldRow>{timing !== "date" ? <EntryInput label="Week" value={stringValue(entry.week)} onChange={(next) => set("week", next)} type="number" min={1} step={1} size="counter" field={{ path: `${path}.week`, label: `${name} · Week` }} {...history} /> : null}{timing !== "week" ? <EntryInput label={timing === "both" ? "Assessment date (optional)" : "Assessment date"} value={stringValue(entry.date)} onChange={(next) => set("date", next)} type="date" size="code" field={{ path: `${path}.date`, label: `${name} · Assessment date` }} {...history} /> : null}{typeOptions.length ? <SyllabusField label="Assessment type" fieldKey={`${path}.assessmentTypeId`} size="name" hint="The kinds of assessment the department allows, each with its own grading rubric. An administrator maintains them in Manage catalogues → Assessment types & rubrics."><SelectMenu label={`Assessment ${index + 1} type`} value={stringValue(entry.assessmentTypeId)} onChange={(next) => { const chosen = assessmentTypes.find((item) => item.id === next); onChange({ assessmentTypeId: next, type: chosen?.label ?? "" }); }} wrap options={typeOptions} placeholder="Select assessment type" /></SyllabusField> : <EntryInput label="Assessment type" value={stringValue(entry.type)} onChange={(next) => set("type", next)} size="name" field={{ path: `${path}.type`, label: `${name} · Assessment type` }} {...history} />}<EntryInput label="Name for this activity (optional)" value={stringValue(entry.name)} onChange={(next) => set("name", next)} size="name" field={{ path: `${path}.name`, label: `${name} · Name` }} {...history} /><EntryInput label="Weight (%)" value={stringValue(entry.weight)} onChange={(next) => set("weight", next)} type="number" min={0} max={100} step={1} size="counter" field={{ path: `${path}.weight`, label: `${name} · Weight` }} {...history} /><SyllabusField label="Applicable AI policy" fieldKey={`${path}.aiPolicy`} size="name" hint="One of the five options of the syllabus template's AI policy table. The AI policy tab then asks for the details of each option the course uses."><SelectMenu label={`Assessment ${index + 1} AI policy`} value={aiOption(entry.aiPolicy ?? entry.ai) || stringValue(entry.aiPolicy ?? entry.ai)} onChange={(next) => { const option = aiOptions(aiPolicies).find((item) => item.label === next); onChange({ aiPolicyId: option?.id ?? "", aiPolicy: next, ai: next }); }} wrap placeholder={inheritedAiPolicy ? `From the course: ${inheritedAiPolicy}` : "Select the AI policy"} options={aiOptions(aiPolicies).map((option) => ({ value: option.label, label: option.label }))} trailing={<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: `${path}.aiPolicy`, label: `${name} · AI policy` }} onOpenSidebar={history.onOpenHistory} />} /></SyllabusField>{aiOption(entry.aiPolicy ?? entry.ai) === OTHER_AI_OPTION ? <EntryInput label="Describe the AI policy for this activity" value={stringValue(entry.aiOtherText)} onChange={(next) => set("aiOtherText", next)} size="sentence" field={{ path: `${path}.aiOtherText`, label: `${name} · AI policy (other)` }} {...history} /> : null}</FieldRow><PloAlignmentField label="CLOs assessed" pickerLabel={`Add CLO assessed by assessment ${index + 1}`} emptyText="No course outcomes selected yet." addText="Add CLO assessed" value={selectedIds.map((id) => cloLabel(outcomes, id)).filter(Boolean).join("\n")} onChange={(next) => { const labels = next.split("\n").filter(Boolean); const ids = labels.map((label) => outcomes.find((outcome) => cloLabel(outcomes, outcome.id) === label)?.id).filter((id): id is string => Boolean(id)); onChange(cloKey === "catalogueCloIds" ? { catalogueCloIds: ids } : { cloIds: ids, clos: labels.join("\n") }); }} options={outcomes.map((outcome) => ({ value: cloLabel(outcomes, outcome.id), label: cloLabel(outcomes, outcome.id) }))} history={<FieldHistoryControl syllabusId={history.syllabusId} revision={history.revision} field={{ path: `${path}.${cloKey}`, label: `${name} · CLOs assessed` }} onOpenSidebar={history.onOpenHistory} placement="label" />} /></>;
}

function selectedCloIds(entry: AssessmentEntry, outcomes: Array<Record<string, string> & { id: string }>, cloKey: CloKey): string[] {
  return cloKey === "catalogueCloIds"
    ? (Array.isArray(entry.catalogueCloIds) ? entry.catalogueCloIds : []).filter((id) => outcomes.some((outcome) => outcome.id === id))
    : Array.isArray(entry.cloIds) ? entry.cloIds : outcomes.filter((outcome) => stringValue(entry.clos).includes(outcome.clo ?? "")).map((outcome) => outcome.id);
}

function AssessmentCard({ entry, index, outcomes, assessmentTypes = [], aiPolicies = [], courseAiPolicy = "", cloKey = "cloIds", scheduleBy = "date", onChange, onRemove, ...history }: HistoryContext & { entry: AssessmentEntry; index: number; /** Which outcomes the activity assesses: the syllabus's own, or (Head-of-Department mode) the catalogue's. */ cloKey?: CloKey; scheduleBy?: "date" | "week"; outcomes: Array<Record<string, string> & { id: string }>; assessmentTypes?: CatalogueEntry[]; aiPolicies?: CatalogueEntry[]; /** The one course-level policy an older syllabus set, applied while the activity has none. */ courseAiPolicy?: string; onChange: (id: string, changes: Partial<AssessmentEntry>) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(!entry.type && !entry.date);
  const selectedIds = selectedCloIds(entry, outcomes, cloKey);
  return <article className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd]"><div className="flex items-center gap-3 p-3"><button type="button" onClick={() => setOpen((current) => !current)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><ChevronDown size={17} className={`shrink-0 text-[#667085] transition-transform ${open ? "rotate-180" : ""}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#344054]">{stringValue(entry.name) || stringValue(entry.type) || `Assessment ${index + 1}`}</span><span className="mt-0.5 block truncate text-sm font-normal text-[#667085]">{assessmentSummary({ ...entry, cloIds: selectedIds }, outcomes, scheduleBy) || "Not filled in yet"}</span></span></button><button type="button" onClick={() => onRemove(entry.id)} className="rounded p-1 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove assessment ${index + 1}`}><X size={17} /></button></div>{open ? <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-[#e5e7eb] p-4"><GradedActivityFields entry={entry} index={index} path={`assessment.items[${entry.id}]`} outcomes={outcomes} assessmentTypes={assessmentTypes} aiPolicies={aiPolicies} courseAiPolicy={courseAiPolicy} cloKey={cloKey} timing={scheduleBy} onChange={(changes) => onChange(entry.id, changes)} {...history} /></div> : null}</article>;
}


function NarrativeField({ label, value, onChange, field, ...history }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField }) { return <EntryInput label={label} value={value} onChange={onChange} multiline field={field} {...history} />; }

function EntryInput({ label, value, onChange, field, syllabusId, revision, onOpenHistory, multiline = false, type = "text", min, max, step, size = "full", hint }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; type?: string; min?: number; max?: number; step?: number; size?: FieldSize; hint?: string }) {
  if (type === "date") return <div className={`grid content-start gap-1 ${fieldSizeClass[size]}`}><DateField label={label} value={value} onChange={onChange} trailing={<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement="center" />} /></div>;
  return <HistoryTextField label={label} value={value} onChange={onChange} multiline={multiline} minRows={3} type={type} min={min} max={max} step={step} size={size} hint={hint} grow={!multiline && type === "text"} history={{ field, onOpenHistory }} />;
}

function resourceSummary(entry: ResourceEntry, kind: EntryProps["kind"]) { return kind === "website" ? entry.organisation || entry.url || entry.freeformText || entry.legacyText : entry.title || entry.freeformText || entry.legacyText || entry.authors; }
function kindLabel(kind: EntryProps["kind"]) { return kind === "book" ? "Book" : kind === "website" ? "Website" : "Journal article"; }
function referencePatch(kind: "book" | "article", result: BibliographyLookupItem): Partial<ResourceEntry> {
  const shared = { entryMode: "structured" as const, title: result.title, authors: result.authors.join(", "), year: result.year ?? "" };
  return kind === "book"
    ? { ...shared, publisher: result.publisher ?? "", isbn: result.isbn ?? result.url ?? "" }
    : { ...shared, journal: result.journal ?? "", volume: result.volume ?? "", issue: result.issue ?? "", pages: result.pages ?? "", doi: result.doi ?? result.url ?? "" };
}
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }

/** Assessments refer to an outcome by its number, so the number travels with the label. */
function cloLabel(outcomes: Array<Record<string, string> & { id: string }>, id: string) {
  const index = outcomes.findIndex((outcome) => outcome.id === id);
  if (index < 0) return "";
  const text = (outcomes[index].clo ?? "").trim() || "Untitled CLO";
  return /^CLO\s*\d/i.test(text) ? text : `CLO ${index + 1}: ${text}`;
}

/** What a closed card should tell you, so it need not be opened to be read. */
function assessmentSummary(
  entry: AssessmentEntry,
  outcomes: Array<Record<string, string> & { id: string }>,
  scheduleBy: "date" | "week",
) {
  const when = scheduleBy === "week" ? (stringValue(entry.week) ? `Week ${stringValue(entry.week)}` : "") : stringValue(entry.date);
  const weight = stringValue(entry.weight);
  const clos = (Array.isArray(entry.cloIds) ? entry.cloIds : [])
    .map((id) => outcomes.findIndex((outcome) => outcome.id === id))
    .filter((position) => position >= 0)
    .map((position) => `CLO ${position + 1}`);
  return [
    when,
    stringValue(entry.type),
    weight ? `${weight}%` : "",
    clos.length ? clos.join(", ") : "",
    stringValue(entry.aiPolicy ?? entry.ai),
  ]
    .filter(Boolean)
    .join(" · ");
}
