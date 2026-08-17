import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SectionEditorShell } from "@/components/SectionEditorShell";
import {
  CatalogueCategory,
  CatalogueEntry,
  CatalogueEntryInput,
  createCatalogueEntry,
  listCatalogueEntries,
  retireCatalogueEntry,
  updateCatalogueEntry,
} from "@/services/syllabusCatalogues";

type CatalogueSection = "people" | "programmes" | "competencies" | "teaching-presets" | "assessment" | "bibliography";

const sections = [
  { id: "people", label: "People" },
  { id: "programmes", label: "Programmes & PLOs" },
  { id: "competencies", label: "SCEN competencies" },
  { id: "teaching-presets", label: "Teaching presets" },
  { id: "assessment", label: "Assessment types & rubrics" },
  { id: "bibliography", label: "Bibliography" },
];

export function SyllabusCatalogues({ onBack }: { onBack: () => void }) {
  const [activeSection, setActiveSection] = useState<CatalogueSection>("people");
  return <SectionEditorShell
    backLabel="Back to syllabus library"
    onBack={onBack}
    eyebrow="Shared syllabus data"
    title="Manage catalogues"
    subtitle="Maintain the approved choices available in compatible syllabus templates."
    actions={null}
    sections={sections}
    activeSection={activeSection}
    onSectionChange={(id) => setActiveSection(id as CatalogueSection)}
  >
    {activeSection === "people" ? <PeopleCatalogue /> : null}
    {activeSection === "programmes" ? <ProgrammesCatalogue /> : null}
    {activeSection === "competencies" ? <SimpleCatalogue category="competencies" title="SCEN competencies" description="Reference competencies for the SCEN curriculum. They are maintained here but are not mapped into course outcomes in this phase." createLabel="Add competency" /> : null}
    {activeSection === "teaching-presets" ? <TeachingPresetsCatalogue /> : null}
    {activeSection === "assessment" ? <AssessmentCatalogue /> : null}
    {activeSection === "bibliography" ? <BibliographyCatalogue /> : null}
  </SectionEditorShell>;
}

function CatalogueHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col gap-3 border-b border-[#e5e7eb] pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-[#667085]">{description}</p></div>{action}</div>;
}

function useCatalogue(category: CatalogueCategory, query = "", parentId?: string) {
  return useQuery({ queryKey: ["syllabus-catalogues", category, query, parentId ?? ""], queryFn: () => listCatalogueEntries(category, { query, parentId, includeRetired: true, limit: 100 }) });
}

function PeopleCatalogue() {
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const catalogue = useCatalogue("people", query);
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="People" description="A shared directory for instructors and academic coordinators. Linked contact details remain live in syllabi; retiring a person preserves existing links." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"><FilePlus2 size={16} /> Add person</button>} />
    <SearchField label="Search people" value={query} onChange={setQuery} />
    {showCreate ? <PersonForm onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}
    <CatalogueEntries category="people" entries={catalogue.data ?? []} isLoading={catalogue.isLoading} renderDetails={(entry) => <PersonDetails entry={entry} />} />
  </div>;
}

function PersonDetails({ entry }: { entry: CatalogueEntry }) {
  const payload = entry.payload;
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === "string") : [];
  return <p className="mt-1 text-sm text-[#667085]">{[roles.map((role) => role === "instructor" ? "Instructor" : "Coordinator").join(" · "), stringValue(payload.email), stringValue(payload.affiliations)].filter(Boolean).join(" · ") || "No contact details added."}</p>;
}

function PersonForm({ entry, onCancel, onSaved }: { entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient();
  const payload = entry?.payload ?? {};
  const [label, setLabel] = useState(entry?.label ?? "");
  const [rank, setRank] = useState(stringValue(payload.academicRank));
  const [email, setEmail] = useState(stringValue(payload.email));
  const [phone, setPhone] = useState(stringValue(payload.phone));
  const [affiliations, setAffiliations] = useState(stringValue(payload.affiliations));
  const [officeHours, setOfficeHours] = useState(stringValue(payload.officeHours));
  const [isInstructor, setIsInstructor] = useState(Array.isArray(payload.roles) && payload.roles.includes("instructor"));
  const [isCoordinator, setIsCoordinator] = useState(Array.isArray(payload.roles) && payload.roles.includes("coordinator"));
  const save = useMutation({
    mutationFn: () => {
      const input: CatalogueEntryInput = { label: label.trim(), payload: { academicRank: rank.trim(), email: email.trim(), phone: phone.trim(), affiliations: affiliations.trim(), officeHours: officeHours.trim(), roles: [isInstructor ? "instructor" : null, isCoordinator ? "coordinator" : null].filter(Boolean) } };
      return entry ? updateCatalogueEntry("people", entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry("people", input);
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "people"] }); onSaved(); },
  });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (label.trim()) save.mutate(); }
  return <form onSubmit={submit} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 md:grid-cols-2"><Field label="Full name"><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field><Field label="Academic rank / status"><input value={rank} onChange={(event) => setRank(event.target.value)} className={inputClass} /></Field><Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></Field><Field label="Phone"><input value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} /></Field><Field label="Affiliations" hint="One or more affiliations, separated by commas."><input value={affiliations} onChange={(event) => setAffiliations(event.target.value)} className={inputClass} /></Field><Field label="Office hours and location"><input value={officeHours} onChange={(event) => setOfficeHours(event.target.value)} className={inputClass} /></Field><div className="flex flex-wrap gap-4 md:col-span-2"><CheckBox label="Available as instructor" checked={isInstructor} onChange={setIsInstructor} /><CheckBox label="Available as academic coordinator" checked={isCoordinator} onChange={setIsCoordinator} /></div><FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save person" : "Add person"} /></form>;
}

function ProgrammesCatalogue() {
  const [showCreate, setShowCreate] = useState(false);
  const programmes = useCatalogue("programmes");
  const [selectedId, setSelectedId] = useState("");
  const selected = programmes.data?.find((programme) => programme.id === selectedId) ?? programmes.data?.[0];
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"><section className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Programmes" description="Programme sets can be selected by compatible SCEN syllabi. Selecting one makes its approved PLOs available for alignment." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> Add programme</button>} />{showCreate ? <SimpleEntryForm category="programmes" fieldLabel="Programme name" onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="programmes" entries={programmes.data ?? []} isLoading={programmes.isLoading} selectedId={selected?.id} onSelect={setSelectedId} /></section><section className="rounded-lg border border-[#d9dee7] bg-white p-5">{selected ? <PloCatalogue programme={selected} /> : <EmptyState>Choose or add a programme to manage its programme learning outcomes.</EmptyState>}</section></div>;
}

function PloCatalogue({ programme }: { programme: CatalogueEntry }) {
  const [showCreate, setShowCreate] = useState(false);
  const plos = useCatalogue("plos", "", programme.id);
  return <><CatalogueHeader title={`${programme.label} PLOs`} description="These outcomes become read-only choices when this programme is selected in a SCEN syllabus." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79]"><FilePlus2 size={16} /> Add PLO</button>} />{showCreate ? <PloForm programme={programme} onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="plos" entries={plos.data ?? []} isLoading={plos.isLoading} renderDetails={(entry) => <p className="mt-1 text-sm leading-6 text-[#667085]">{stringValue(entry.payload.outcome)}</p>} /></>;
}

function PloForm({ programme, entry, onCancel, onSaved }: { programme: CatalogueEntry; entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient(); const payload = entry?.payload ?? {}; const [code, setCode] = useState(stringValue(payload.code)); const [outcome, setOutcome] = useState(stringValue(payload.outcome));
  const save = useMutation({ mutationFn: () => { const input: CatalogueEntryInput = { label: `${code.trim() || "PLO"}${outcome.trim() ? ` · ${outcome.trim().slice(0, 80)}` : ""}`, parentId: programme.id, sortOrder: entry?.sortOrder, payload: { code: code.trim(), outcome: outcome.trim() } }; return entry ? updateCatalogueEntry("plos", entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry("plos", input); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "plos"] }); onSaved(); } });
  return <form onSubmit={(event) => { event.preventDefault(); if (outcome.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4"><Field label="PLO code"><input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. PLO 1" className={inputClass} /></Field><Field label="Programme learning outcome"><AutoResizeTextarea required minRows={3} value={outcome} onChange={(event) => setOutcome(event.target.value)} className={textareaClass} /></Field><FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save PLO" : "Add PLO"} /></form>;
}

function TeachingPresetsCatalogue() {
  const [showCreate, setShowCreate] = useState(false); const data = useCatalogue("teaching-presets");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Teaching presets" description="Maintain approaches that compatible SCEN syllabi may preview, then explicitly apply to their teaching-approach content." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> Add preset</button>} />{showCreate ? <TeachingPresetForm onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="teaching-presets" entries={data.data ?? []} isLoading={data.isLoading} renderDetails={(entry) => <p className="mt-1 text-sm text-[#667085]">{[stringValue(entry.payload.methods), stringValue(entry.payload.engagement), stringValue(entry.payload.feedback)].filter(Boolean).length} prepared section(s)</p>} /></div>;
}

function TeachingPresetForm({ entry, onCancel, onSaved }: { entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient(); const payload = entry?.payload ?? {}; const [label, setLabel] = useState(entry?.label ?? ""); const [methods, setMethods] = useState(stringValue(payload.methods)); const [engagement, setEngagement] = useState(stringValue(payload.engagement)); const [feedback, setFeedback] = useState(stringValue(payload.feedback));
  const save = useMutation({ mutationFn: () => { const input: CatalogueEntryInput = { label: label.trim(), payload: { methods: methods.trim(), engagement: engagement.trim(), feedback: feedback.trim() } }; return entry ? updateCatalogueEntry("teaching-presets", entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry("teaching-presets", input); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "teaching-presets"] }); onSaved(); } });
  return <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4"><Field label="Preset name"><input required value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field><Field label="Teaching methods"><AutoResizeTextarea minRows={3} value={methods} onChange={(event) => setMethods(event.target.value)} className={textareaClass} /></Field><Field label="Student engagement"><AutoResizeTextarea minRows={3} value={engagement} onChange={(event) => setEngagement(event.target.value)} className={textareaClass} /></Field><Field label="Feedback"><AutoResizeTextarea minRows={3} value={feedback} onChange={(event) => setFeedback(event.target.value)} className={textareaClass} /></Field><FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save preset" : "Add preset"} /></form>;
}

function AssessmentCatalogue() {
  const [tab, setTab] = useState<"assessment-types" | "rubric-presets">("assessment-types");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><div className="flex border-b border-[#d9dee7]" role="tablist" aria-label="Assessment catalogues"><CatalogueTab active={tab === "assessment-types"} onClick={() => setTab("assessment-types")}>Assessment types</CatalogueTab><CatalogueTab active={tab === "rubric-presets"} onClick={() => setTab("rubric-presets")}>Rubric presets</CatalogueTab></div>{tab === "assessment-types" ? <SimpleCatalogue category="assessment-types" title="Assessment types" description="These choices appear on SCEN graded-activity cards. They do not automatically alter an assessment's rubric." createLabel="Add assessment type" /> : <SimpleCatalogue category="rubric-presets" title="Rubric presets" description="Maintain rubric references centrally. Applying a rubric automatically is intentionally deferred." createLabel="Add rubric preset" />}</div>;
}

function BibliographyCatalogue() {
  const categories = useCatalogue("bibliography-types");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Bibliography" description="The shared bibliography editor supports these source categories in compatible templates. Each source can be entered as structured data or a paste-friendly freeform reference." />{categories.isLoading ? <Loading /> : <div className="mt-5 grid gap-3 md:grid-cols-3">{(categories.data ?? []).map((entry) => <div key={entry.id} className="rounded-lg border border-[#d9dee7] bg-[#f8fafc] p-4"><h4 className="font-semibold text-[#344054]">{entry.label}</h4><p className="mt-1 text-sm leading-6 text-[#667085]">Structured and freeform entry are both preserved for clean exports and imported legacy references.</p></div>)}</div>}</div>;
}

function SimpleCatalogue({ category, title, description, createLabel }: { category: CatalogueCategory; title: string; description: string; createLabel: string }) {
  const [showCreate, setShowCreate] = useState(false); const data = useCatalogue(category);
  return <div className={category === "assessment-types" || category === "rubric-presets" ? "pt-5" : "rounded-lg border border-[#d9dee7] bg-white p-5"}><CatalogueHeader title={title} description={description} action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> {createLabel}</button>} />{showCreate ? <SimpleEntryForm category={category} fieldLabel={category === "rubric-presets" ? "Rubric preset name" : "Name"} onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category={category} entries={data.data ?? []} isLoading={data.isLoading} /></div>;
}

function SimpleEntryForm({ category, entry, fieldLabel, onCancel, onSaved }: { category: CatalogueCategory; entry?: CatalogueEntry; fieldLabel: string; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient(); const [label, setLabel] = useState(entry?.label ?? ""); const [details, setDetails] = useState(stringValue(entry?.payload.details)); const save = useMutation({ mutationFn: () => { const input: CatalogueEntryInput = { label: label.trim(), payload: details.trim() ? { ...entry?.payload, details: details.trim() } : entry?.payload ?? {}, parentId: entry?.parentId, sortOrder: entry?.sortOrder }; return entry ? updateCatalogueEntry(category, entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry(category, input); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", category] }); onSaved(); } });
  return <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4"><Field label={fieldLabel}><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field><Field label="Supporting details" hint="Optional"><AutoResizeTextarea minRows={2} value={details} onChange={(event) => setDetails(event.target.value)} className={textareaClass} /></Field><FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save changes" : "Add to catalogue"} /></form>;
}

function CatalogueEntries({ category, entries, isLoading, renderDetails, selectedId, onSelect }: { category: CatalogueCategory; entries: CatalogueEntry[]; isLoading: boolean; renderDetails?: (entry: CatalogueEntry) => React.ReactNode; selectedId?: string; onSelect?: (id: string) => void }) {
  const [retireCandidate, setRetireCandidate] = useState<CatalogueEntry | null>(null); const [editing, setEditing] = useState<CatalogueEntry | null>(null); const client = useQueryClient();
  const retire = useMutation({ mutationFn: (entry: CatalogueEntry) => retireCatalogueEntry(category, entry.id, entry.revision), onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", category] }); setRetireCandidate(null); } });
  if (isLoading) return <Loading />;
  if (!entries.length) return <EmptyState>No records yet.</EmptyState>;
  return <><div className="mt-5 grid gap-3">{entries.map((entry) => <article key={entry.id} className={`rounded-lg border p-4 ${entry.isRetired ? "border-[#e5e7eb] bg-[#f8fafc] opacity-75" : selectedId === entry.id ? "border-[#1f4e79] bg-[#f2f7fb]" : "border-[#d9dee7] bg-white"}`}><div className="flex items-start gap-3"><button type="button" onClick={() => onSelect?.(entry.id)} className={`min-w-0 flex-1 text-left ${onSelect ? "cursor-pointer" : "cursor-default"}`}><div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-[#344054]">{entry.label}</h4>{entry.isRetired ? <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs font-semibold text-[#667085]">Retired</span> : null}</div>{renderDetails?.(entry)}</button>{!entry.isRetired ? <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => setEditing(entry)} aria-label={`Edit ${entry.label}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#1f4e79] hover:bg-[#e8edf3]"><Pencil size={16} /></button><button type="button" onClick={() => setRetireCandidate(entry)} aria-label={`Retire ${entry.label}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#b4232d] hover:bg-[#fff1f2]"><Trash2 size={16} /></button></div> : null}</div></article>)}</div>{editing ? <EditEntry category={category} entry={editing} onClose={() => setEditing(null)} /> : null}<ConfirmDialog open={Boolean(retireCandidate)} title={`Retire ${retireCandidate?.label ?? "catalogue entry"}?`} description="It will no longer be available for new selections. Existing syllabus references will continue to resolve." confirmLabel={retire.isPending ? "Retiring…" : "Retire"} onClose={() => setRetireCandidate(null)} onConfirm={() => retireCandidate && retire.mutate(retireCandidate)} /></>;
}

function EditEntry({ category, entry, onClose }: { category: CatalogueCategory; entry: CatalogueEntry; onClose: () => void }) {
  if (category === "people") return <PersonForm entry={entry} onCancel={onClose} onSaved={onClose} />;
  if (category === "teaching-presets") return <TeachingPresetForm entry={entry} onCancel={onClose} onSaved={onClose} />;
  if (category === "plos") return <PloForm programme={{ ...entry, id: entry.parentId ?? "" }} entry={entry} onCancel={onClose} onSaved={onClose} />;
  return <SimpleEntryForm category={category} entry={entry} fieldLabel={category === "programmes" ? "Programme name" : category === "rubric-presets" ? "Rubric preset name" : "Name"} onCancel={onClose} onSaved={onClose} />;
}

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="relative mt-5 block"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" /><input type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} className="w-full rounded-md border border-[#b7bec8] py-2 pl-9 pr-3 text-sm focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /></label>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="grid gap-1 text-sm font-medium text-[#344054]"><span>{label}{hint ? <span className="ml-1 font-normal text-[#667085]">{hint}</span> : null}</span>{children}</label>; }
function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="inline-flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-[#98a2b3] text-[#1f4e79] focus:ring-[#d7e5f3]" />{label}</label>; }
function FormActions({ isSaving, error, onCancel, submitLabel }: { isSaving: boolean; error: Error | null; onCancel: () => void; submitLabel: string }) { return <div className="flex flex-wrap items-center gap-3"><button disabled={isSaving} className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">{isSaving ? "Saving…" : submitLabel}</button><button type="button" onClick={onCancel} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">Cancel</button>{error ? <p role="alert" className="text-sm text-[#8f1f25]">{error.message}</p> : null}</div>; }
function CatalogueTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`border-b-2 px-3 py-3 text-sm font-semibold ${active ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:text-[#344054]"}`}>{children}</button>; }
function Loading() { return <div className="mt-5 flex items-center gap-2 text-sm text-[#667085]"><Loader2 size={16} className="animate-spin" /> Loading catalogue…</div>; }
function EmptyState({ children }: { children: React.ReactNode }) { return <p className="mt-5 rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-sm text-[#667085]">{children}</p>; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
const inputClass = "rounded-md border border-[#b7bec8] bg-white px-3 py-2 font-normal text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";
const textareaClass = "rounded-md border border-[#b7bec8] bg-white px-3 py-2 font-normal leading-6 text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";
