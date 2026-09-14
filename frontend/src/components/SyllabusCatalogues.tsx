import { SelectMenu } from "@/components/SelectMenu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadCloud, FilePlus2, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PloAlignmentField } from "@/components/PloAlignmentField";
import { SectionEditorShell } from "@/components/SectionEditorShell";
import {
  CatalogueCategory,
  CatalogueEntry,
  CatalogueEntryInput,
  PeopleImportResult,
  createCatalogueEntry,
  importPeopleFromPortal,
  listCatalogueEntries,
  retireCatalogueEntry,
  updateCatalogueEntry,
} from "@/services/syllabusCatalogues";

type CatalogueSection = "people" | "programmes" | "curriculum-mapping" | "competencies" | "graduate-competencies" | "teaching-presets" | "assessment" | "ai-policies" | "bibliography";

const sections = [
  { id: "people", label: "People" },
  { id: "programmes", label: "Programmes & PLOs" },
  { id: "competencies", label: "SCEN competencies" },
  { id: "graduate-competencies", label: "SUAD graduate competencies" },
  { id: "teaching-presets", label: "Teaching presets" },
  { id: "curriculum-mapping", label: "Curriculum mapping" },
  { id: "assessment", label: "Assessment types & rubrics" },
  { id: "ai-policies", label: "AI policies" },
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
    {activeSection === "competencies" ? <CompetenciesCatalogue /> : null}
    {activeSection === "graduate-competencies" ? <SimpleCatalogue category="graduate-competencies" title="SUAD graduate competencies" description="The institution's graduate competencies. Each SCEN competency points at the ones it develops." createLabel="New graduate competency" /> : null}
    {activeSection === "teaching-presets" ? <TeachingPresetsCatalogue /> : null}
    {activeSection === "curriculum-mapping" ? <CurriculumMappingCatalogue /> : null}
    {activeSection === "assessment" ? <AssessmentCatalogue /> : null}
    {activeSection === "ai-policies" ? <SimpleCatalogue category="ai-policies" title="AI policies" description="The policies a graded activity may apply. Courses choose from these; they do not write their own." createLabel="New AI policy" /> : null}
    {activeSection === "bibliography" ? <BibliographyCatalogue /> : null}
  </SectionEditorShell>;
}

function CatalogueHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-start gap-3 border-b border-[#e5e7eb] pb-4"><div><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-[#667085]">{description}</p></div>{action}</div>;
}

function useCatalogue(category: CatalogueCategory, query = "", parentId?: string) {
  return useQuery({ queryKey: ["syllabus-catalogues", category, query, parentId ?? ""], queryFn: () => listCatalogueEntries(category, { query, parentId, includeRetired: true, limit: 200 }) });
}

function PeopleCatalogue() {
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const catalogue = useCatalogue("people", query);
  const client = useQueryClient();
  const importFromPortal = useMutation({
    mutationFn: importPeopleFromPortal,
    onSuccess: () => client.invalidateQueries({ queryKey: ["syllabus-catalogues", "people"] }),
  });
  const imported = importFromPortal.data;
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="People" description="A shared directory for instructors and academic coordinators. Linked contact details remain live in syllabi; retiring a person preserves existing links." action={<div className="flex flex-wrap gap-2"><button type="button" onClick={() => importFromPortal.mutate()} disabled={importFromPortal.isPending} className="inline-flex items-center gap-2 rounded-md border border-[#1f4e79] px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#eef4fa] disabled:opacity-60">{importFromPortal.isPending ? <Loader2 size={16} className="animate-spin" /> : <DownloadCloud size={16} />} Import teachers from the portal</button><button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"><FilePlus2 size={16} /> Add person</button></div>} />
    {imported ? <p className="mt-3 rounded-md border border-[#cfe3d3] bg-[#f2f9f4] px-3 py-2 text-sm text-[#2f6b41]">{importSummary(imported)}</p> : null}
    {importFromPortal.error ? <p className="mt-3 rounded-md border border-[#f0c6c6] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">{(importFromPortal.error as Error).message}</p> : null}
    <SearchField label="Search people" value={query} onChange={setQuery} />
    {showCreate ? <PersonForm onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}
    <CatalogueEntries category="people" entries={catalogue.data ?? []} isLoading={catalogue.isLoading} renderDetails={(entry) => <PersonDetails entry={entry} />} />
  </div>;
}

/** Says what the import did in the terms an administrator cares about. */
function importSummary({ added, updated, unchanged, retired }: PeopleImportResult) {
  const parts = [
    added.length ? `${added.length} added` : "",
    updated.length ? `${updated.length} updated` : "",
    unchanged.length ? `${unchanged.length} already here` : "",
    retired.length ? `${retired.length} left retired` : "",
  ].filter(Boolean);
  return parts.length ? `Teachers from Students and Timetables: ${parts.join(", ")}.` : "Nobody is listed as teaching yet.";
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
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]"><section className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Programmes" description="Programme sets can be selected by compatible SCEN syllabi. Selecting one makes its approved PLOs available for alignment." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> Add programme</button>} />{showCreate ? <SimpleEntryForm category="programmes" fieldLabel="Programme name" onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="programmes" entries={programmes.data ?? []} isLoading={programmes.isLoading} selectedId={selected?.id} onSelect={setSelectedId} /></section><section className="rounded-lg border border-[#d9dee7] bg-white p-5">{selected ? <PloCatalogue programme={selected} /> : <EmptyState>Choose or add a programme to manage its programme learning outcomes.</EmptyState>}</section></div>;
}

function PloCatalogue({ programme }: { programme: CatalogueEntry }) {
  const [showCreate, setShowCreate] = useState(false);
  const plos = useCatalogue("plos", "", programme.id);
  return <><CatalogueHeader title={`${programme.label} PLOs`} description="These outcomes become read-only choices when this programme is selected in a SCEN syllabus." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79]"><FilePlus2 size={16} /> Add PLO</button>} />{showCreate ? <PloForm programme={programme} onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="plos" entries={plos.data ?? []} isLoading={plos.isLoading} renderDetails={(entry) => <p className="mt-1 text-sm leading-6 text-[#667085]">{stringValue(entry.payload.outcome)}</p>} /></>;
}

function PloForm({ programme, entry, onCancel, onSaved }: { programme: CatalogueEntry; entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient(); const payload = entry?.payload ?? {}; const [code, setCode] = useState(stringValue(payload.code)); const [outcome, setOutcome] = useState(stringValue(payload.outcome));
  const save = useMutation({ mutationFn: () => { const input: CatalogueEntryInput = { label: code.trim() || "PLO", parentId: programme.id, sortOrder: entry?.sortOrder, payload: { code: code.trim(), outcome: outcome.trim() } }; return entry ? updateCatalogueEntry("plos", entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry("plos", input); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "plos"] }); onSaved(); } });
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
  const [showCreate, setShowCreate] = useState(false);
  const data = useCatalogue("assessment-types");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Assessment types" description="Every graded activity picks one of these. Each carries the grading rubric that appears in the syllabus and in the exported document." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> Add assessment type</button>} />{showCreate ? <AssessmentTypeForm onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="assessment-types" entries={data.data ?? []} isLoading={data.isLoading} renderDetails={(entry) => <p className="mt-1 text-sm text-[#667085]">{criteriaOf(entry).length ? `${criteriaOf(entry).length} rubric criteria` : "No rubric yet"}</p>} /></div>;
}

type RubricCriterion = { name?: string; inadequate?: string; meets?: string; exceeds?: string };

function criteriaOf(entry?: CatalogueEntry): RubricCriterion[] {
  const value = entry?.payload.criteria;
  return Array.isArray(value) ? (value as RubricCriterion[]) : [];
}

/** An assessment type and its rubric are one record: the type is what a graded activity picks. */
function AssessmentTypeForm({ entry, onCancel, onSaved }: { entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient();
  const [label, setLabel] = useState(entry?.label ?? "");
  const [criteria, setCriteria] = useState<RubricCriterion[]>(criteriaOf(entry));
  const save = useMutation({
    mutationFn: () => {
      const kept = criteria.filter((item) => (item.name ?? "").trim());
      const input: CatalogueEntryInput = {
        label: label.trim(),
        payload: { ...entry?.payload, criteria: kept },
        parentId: entry?.parentId,
        sortOrder: entry?.sortOrder,
      };
      return entry
        ? updateCatalogueEntry("assessment-types", entry.id, { ...input, expectedRevision: entry.revision })
        : createCatalogueEntry("assessment-types", input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "assessment-types"] });
      onSaved();
    },
  });
  const update = (index: number, change: Partial<RubricCriterion>) =>
    setCriteria((current) => current.map((item, position) => (position === index ? { ...item, ...change } : item)));
  return <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4">
    <Field label="Assessment type"><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field>
    <div>
      <p className="text-sm font-semibold text-[#344054]">Grading rubric</p>
      <p className="mt-1 text-sm text-[#667085]">Shown in every syllabus that assesses this way, and written into the exported document.</p>
      <div className="mt-3 grid gap-3">
        {criteria.map((criterion, index) => <div key={index} className="rounded-md border border-[#e5e7eb] bg-white p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1"><Field label={`Criterion ${index + 1}`}><input value={criterion.name ?? ""} onChange={(event) => update(index, { name: event.target.value })} className={inputClass} /></Field></div>
            <button type="button" onClick={() => setCriteria((current) => current.filter((_, position) => position !== index))} className="mt-7 shrink-0 text-sm font-semibold text-[#a6292f] hover:underline">Remove</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Inadequate (0–9)"><AutoResizeTextarea minRows={2} value={criterion.inadequate ?? ""} onChange={(event) => update(index, { inadequate: event.target.value })} className={textareaClass} /></Field>
            <Field label="Meets expectations (10–15)"><AutoResizeTextarea minRows={2} value={criterion.meets ?? ""} onChange={(event) => update(index, { meets: event.target.value })} className={textareaClass} /></Field>
            <Field label="Exceeds expectations (16–20)"><AutoResizeTextarea minRows={2} value={criterion.exceeds ?? ""} onChange={(event) => update(index, { exceeds: event.target.value })} className={textareaClass} /></Field>
          </div>
        </div>)}
      </div>
      <button type="button" onClick={() => setCriteria((current) => [...current, {}])} className="mt-3 text-left text-sm font-semibold text-[#1f4e79] hover:underline">+ Add criterion</button>
    </div>
    <FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save changes" : "Add to catalogue"} />
  </form>;
}


function BibliographyCatalogue() {
  const categories = useCatalogue("bibliography-types");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="Bibliography" description="The shared bibliography editor supports these source categories in compatible templates. Each source can be entered as structured data or a paste-friendly freeform reference." />{categories.isLoading ? <Loading /> : <div className="mt-5 grid gap-3 md:grid-cols-3">{(categories.data ?? []).map((entry) => <div key={entry.id} className="rounded-lg border border-[#d9dee7] bg-[#f8fafc] p-4"><h4 className="font-semibold text-[#344054]">{entry.label}</h4><p className="mt-1 text-sm leading-6 text-[#667085]">Structured and freeform entry are both preserved for clean exports and imported legacy references.</p></div>)}</div>}</div>;
}

function SimpleCatalogue({ category, title, description, createLabel }: { category: CatalogueCategory; title: string; description: string; createLabel: string }) {
  const [showCreate, setShowCreate] = useState(false); const data = useCatalogue(category);
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title={title} description={description} action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> {createLabel}</button>} />{showCreate ? <SimpleEntryForm category={category} fieldLabel="Name" onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category={category} entries={data.data ?? []} isLoading={data.isLoading} /></div>;
}

function SimpleEntryForm({ category, entry, fieldLabel, onCancel, onSaved }: { category: CatalogueCategory; entry?: CatalogueEntry; fieldLabel: string; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient(); const [label, setLabel] = useState(entry?.label ?? ""); const [details, setDetails] = useState(stringValue(entry?.payload.details)); const save = useMutation({ mutationFn: () => { const input: CatalogueEntryInput = { label: label.trim(), payload: details.trim() ? { ...entry?.payload, details: details.trim() } : entry?.payload ?? {}, parentId: entry?.parentId, sortOrder: entry?.sortOrder }; return entry ? updateCatalogueEntry(category, entry.id, { ...input, expectedRevision: entry.revision }) : createCatalogueEntry(category, input); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", category] }); onSaved(); } });
  return <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4"><Field label={fieldLabel}><input autoFocus required value={label} onChange={(event) => setLabel(event.target.value)} className={inputClass} /></Field><Field label="Supporting details" hint="Optional"><AutoResizeTextarea minRows={2} value={details} onChange={(event) => setDetails(event.target.value)} className={textareaClass} /></Field><FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save changes" : "Add to catalogue"} /></form>;
}

function CatalogueEntries({ category, entries, isLoading, renderDetails, selectedId, onSelect }: { category: CatalogueCategory; entries: CatalogueEntry[]; isLoading: boolean; renderDetails?: (entry: CatalogueEntry) => React.ReactNode; selectedId?: string; onSelect?: (id: string) => void }) {
  const [retireCandidate, setRetireCandidate] = useState<CatalogueEntry | null>(null);
  const [editing, setEditing] = useState<CatalogueEntry | null>(null);
  const [editingDirty, setEditingDirty] = useState(false);
  const [pendingEditingAction, setPendingEditingAction] = useState<{ type: "close" } | { type: "open"; entry: CatalogueEntry } | null>(null);
  const client = useQueryClient();
  const retire = useMutation({ mutationFn: (entry: CatalogueEntry) => retireCatalogueEntry(category, entry.id, entry.revision), onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", category] }); setRetireCandidate(null); } });
  const closeEditor = () => { setEditing(null); setEditingDirty(false); };
  const openEditor = (entry: CatalogueEntry) => {
    onSelect?.(entry.id);
    setEditing(entry);
    setEditingDirty(false);
    // It opens underneath the card, which on a long list is off the bottom of the screen:
    // without this, clicking a person forty rows down looks like nothing happened at all.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById(`catalogue-editor-${entry.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      ),
    );
  };
  const requestEditingAction = (action: { type: "close" } | { type: "open"; entry: CatalogueEntry }) => {
    if (editing && editingDirty) { setPendingEditingAction(action); return; }
    if (action.type === "close") closeEditor(); else openEditor(action.entry);
  };
  const confirmDiscard = () => {
    if (!pendingEditingAction) return;
    if (pendingEditingAction.type === "close") closeEditor(); else openEditor(pendingEditingAction.entry);
    setPendingEditingAction(null);
  };
  if (isLoading) return <Loading />;
  if (!entries.length) return <EmptyState>No records yet.</EmptyState>;
  return <><div className="mt-5 grid gap-3">{entries.map((entry) => {
    const isEditing = editing?.id === entry.id;
    const toggleEditing = () => requestEditingAction(isEditing ? { type: "close" } : { type: "open", entry });
    const cardClass = entry.isRetired ? "border-[#e5e7eb] bg-[#f8fafc] opacity-75" : selectedId === entry.id || isEditing ? "border-[#1f4e79] bg-[#f2f7fb]" : "border-[#d9dee7] bg-white hover:border-[#1f4e79] hover:bg-[#f7fafd]";
    return <article key={entry.id} className={`relative min-w-0 max-w-full rounded-lg border p-4 ${isEditing ? "overflow-hidden" : ""} ${cardClass}`}>
      <div className="relative z-10 flex min-w-0 items-start gap-3"><button type="button" disabled={entry.isRetired} onClick={toggleEditing} aria-label={isEditing ? `Close editor for ${entry.label}` : `Edit ${entry.label}`} className="flex min-w-0 flex-1 items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79] focus-visible:ring-offset-2 disabled:cursor-default"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="break-words font-semibold text-[#344054]">{entry.label}</h4>{entry.isRetired ? <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs font-semibold text-[#667085]">Retired</span> : null}</div>{renderDetails?.(entry)}</div></button>{!entry.isRetired ? <div className="flex shrink-0 items-center gap-1">{/* The card itself opens the editor; this is the same control for anyone who aims at the pencil, which is most people. */}<button type="button" onClick={toggleEditing} tabIndex={-1} aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#1f4e79] hover:bg-[#eef4fa]"><Pencil size={16} /></button><button type="button" onClick={() => setRetireCandidate(entry)} aria-label={`Retire ${entry.label}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#b4232d] hover:bg-[#fff1f2]"><Trash2 size={16} /></button></div> : null}</div>{isEditing ? <div id={`catalogue-editor-${entry.id}`} className="relative z-10 mt-4 -mx-4 -mb-4 border-t border-[#d9dee7] bg-[#f8fafc] p-4 [&>form]:!mt-0 [&>form]:!rounded-none [&>form]:!border-0 [&>form]:!bg-transparent [&>form]:!p-0"><EditEntry category={category} entry={editing} onClose={closeEditor} onDirtyChange={setEditingDirty} /></div> : null}
    </article>;
  })}</div><ConfirmDialog open={Boolean(retireCandidate)} title={`Retire ${retireCandidate?.label ?? "catalogue entry"}?`} description="It will no longer be available for new selections. Existing syllabus references will continue to resolve." confirmLabel={retire.isPending ? "Retiring…" : "Retire"} onClose={() => setRetireCandidate(null)} onConfirm={() => retireCandidate && retire.mutate(retireCandidate)} /><ConfirmDialog open={Boolean(pendingEditingAction)} title="Discard unsaved changes?" description="This card has changes that have not been saved. Discard them and close the card?" confirmLabel="Discard changes" onClose={() => setPendingEditingAction(null)} onConfirm={confirmDiscard} /></>;
}

function EditEntry({ category, entry, onClose, onDirtyChange }: { category: CatalogueCategory; entry: CatalogueEntry; onClose: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const form = category === "curriculum-mapping" ? <CurriculumMappingEditForm entry={entry} onCancel={onClose} onSaved={onClose} /> : category === "people" ? <PersonForm entry={entry} onCancel={onClose} onSaved={onClose} /> : category === "teaching-presets" ? <TeachingPresetForm entry={entry} onCancel={onClose} onSaved={onClose} /> : category === "assessment-types" ? <AssessmentTypeForm entry={entry} onCancel={onClose} onSaved={onClose} /> : category === "plos" ? <PloForm programme={{ ...entry, id: entry.parentId ?? "" }} entry={entry} onCancel={onClose} onSaved={onClose} /> : <SimpleEntryForm category={category} entry={entry} fieldLabel={category === "programmes" ? "Programme name" : "Name"} onCancel={onClose} onSaved={onClose} />;
  return <div onInputCapture={() => onDirtyChange(true)} onChangeCapture={() => onDirtyChange(true)}>{form}</div>;
}

function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="relative mt-5 block"><Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" /><input type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} className="w-full rounded-md border border-[#b7bec8] py-2 pl-9 pr-3 text-sm focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /></label>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="grid gap-1 text-sm font-medium text-[#344054]"><span>{label}{hint ? <span className="ml-1 font-normal text-[#667085]">{hint}</span> : null}</span>{children}</label>; }
function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="inline-flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-[#98a2b3] text-[#1f4e79] focus:ring-[#d7e5f3]" />{label}</label>; }
function FormActions({ isSaving, error, onCancel, submitLabel }: { isSaving: boolean; error: Error | null; onCancel: () => void; submitLabel: string }) { return <div className="flex flex-wrap items-center gap-3"><button disabled={isSaving} className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">{isSaving ? "Saving…" : submitLabel}</button><button type="button" onClick={onCancel} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">Cancel</button>{error ? <p role="alert" className="text-sm text-[#8f1f25]">{error.message}</p> : null}</div>; }
function Loading() { return <div className="mt-5 flex items-center gap-2 text-sm text-[#667085]"><Loader2 size={16} className="animate-spin" /> Loading catalogue…</div>; }
function EmptyState({ children }: { children: React.ReactNode }) { return <p className="mt-5 rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-4 py-5 text-sm text-[#667085]">{children}</p>; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
const inputClass = "rounded-md border border-[#b7bec8] bg-white px-3 py-2 font-normal text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";
const textareaClass = "rounded-md border border-[#b7bec8] bg-white px-3 py-2 font-normal leading-6 text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";

function CompetenciesCatalogue() {
  const [showCreate, setShowCreate] = useState(false);
  const data = useCatalogue("competencies");
  const graduate = useCatalogue("graduate-competencies");
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5"><CatalogueHeader title="SCEN competencies" description="Reference competencies for the department. Attach the SUAD graduate competencies each one develops." action={<button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> New competency</button>} />{showCreate ? <SimpleEntryForm category="competencies" fieldLabel="Name" onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}<CatalogueEntries category="competencies" entries={data.data ?? []} isLoading={data.isLoading} renderDetails={(entry) => <GraduateCompetencyPicker entry={entry} graduate={graduate.data ?? []} />} /></div>;
}

function GraduateCompetencyPicker({ entry, graduate }: { entry: CatalogueEntry; graduate: CatalogueEntry[] }) {
  const client = useQueryClient();
  const ids = Array.isArray(entry.payload.graduateCompetencyIds) ? entry.payload.graduateCompetencyIds.map(String) : [];
  const save = useMutation({
    mutationFn: (nextIds: string[]) =>
      updateCatalogueEntry("competencies", entry.id, {
        label: entry.label,
        payload: { ...entry.payload, graduateCompetencyIds: nextIds },
        parentId: entry.parentId,
        sortOrder: entry.sortOrder,
        expectedRevision: entry.revision,
      }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "competencies"] }); },
  });
  const options = graduate.map((item) => ({ value: item.label, label: item.label }));
  const value = graduate.filter((item) => ids.includes(item.id)).map((item) => item.label).join("\n");
  return <div className="mt-3">
    <PloAlignmentField
      label="SUAD graduate competencies developed"
      pickerLabel={`Add a graduate competency to ${entry.label}`}
      emptyText="No graduate competencies attached yet."
      addText="Add graduate competency"
      value={value}
      options={options}
      onChange={(next: string) => {
        const labels = next.split("\n").filter(Boolean);
        save.mutate(graduate.filter((item) => labels.includes(item.label)).map((item) => item.id));
      }}
    />
    {save.isError ? <p role="alert" className="mt-2 text-sm text-[#8f1f25]">That change could not be saved. Reload and try again.</p> : null}
  </div>;
}

/** Which programme outcomes each course is expected to carry, as submitted to the CAA. */
function CurriculumMappingCatalogue() {
  const programmes = useCatalogue("programmes");
  const [programmeId, setProgrammeId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const chosen = programmeId || programmes.data?.[0]?.id || "";
  const mapping = useQuery({
    queryKey: ["syllabus-catalogues", "curriculum-mapping", chosen],
    queryFn: () => listCatalogueEntries("curriculum-mapping", { parentId: chosen }),
    enabled: Boolean(chosen),
  });
  const plos = useQuery({
    queryKey: ["syllabus-catalogues", "plos", chosen],
    queryFn: () => listCatalogueEntries("plos", { parentId: chosen }),
    enabled: Boolean(chosen),
  });
  const ploLabel = (id: string) => {
    const plo = plos.data?.find((entry) => entry.id === id);
    return plo ? stringValue(plo.payload.code) || plo.label : "";
  };
  return <div className="rounded-lg border border-[#d9dee7] bg-white p-5">
    <CatalogueHeader
      title="Curriculum mapping"
      description="Which programme learning outcomes each course is expected to address, as submitted to the CAA. A syllabus shows its professor what is still uncovered; it never blocks them."
      action={chosen ? <button type="button" onClick={() => setShowCreate(true)} className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> Add course</button> : undefined}
    />
    {(programmes.data ?? []).length > 1 ? <label className="mt-4 grid gap-1 text-sm font-medium text-[#344054]">Programme<SelectMenu label="Programme" value={chosen} onChange={setProgrammeId} options={(programmes.data ?? []).map((item) => ({ value: item.id, label: item.label }))} /></label> : null}
    {showCreate && chosen ? <CurriculumMappingForm programmeId={chosen} plos={plos.data ?? []} onCancel={() => setShowCreate(false)} onSaved={() => setShowCreate(false)} /> : null}
    {mapping.isLoading
      ? <p className="mt-4 text-sm text-[#667085]">Loading…</p>
      : (mapping.data ?? []).length
        ? <div className="mt-4"><CatalogueEntries category="curriculum-mapping" entries={mapping.data ?? []} isLoading={false} renderDetails={(entry) => <p className="mt-1 text-sm text-[#667085]">{[stringValue(entry.payload.courseTitle), stringValue(entry.payload.semester), (Array.isArray(entry.payload.ploIds) ? (entry.payload.ploIds as string[]) : []).map(ploLabel).filter(Boolean).join(", ") || "No outcomes yet"].filter(Boolean).join(" · ")}</p>} /></div>
        : <p className="mt-4 rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No curriculum map for this programme yet.</p>}
  </div>;
}

/** A course's row in the curriculum map: which outcomes it is expected to carry. */
function CurriculumMappingForm({ programmeId, plos, entry, onCancel, onSaved }: { programmeId: string; plos: CatalogueEntry[]; entry?: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const client = useQueryClient();
  const [code, setCode] = useState(entry?.label ?? "");
  const [title, setTitle] = useState(stringValue(entry?.payload.courseTitle));
  const [semester, setSemester] = useState(stringValue(entry?.payload.semester));
  const options = plos.map((plo) => ({ value: plo.id, label: stringValue(plo.payload.code) || plo.label }));
  const initial = Array.isArray(entry?.payload.ploIds) ? (entry?.payload.ploIds as string[]) : [];
  const [selected, setSelected] = useState<string[]>(initial);
  const save = useMutation({
    mutationFn: () => {
      const input: CatalogueEntryInput = {
        label: code.trim(),
        payload: { ...entry?.payload, courseTitle: title.trim(), semester: semester.trim(), ploIds: selected },
        parentId: programmeId,
        sortOrder: entry?.sortOrder,
      };
      return entry
        ? updateCatalogueEntry("curriculum-mapping", entry.id, { ...input, expectedRevision: entry.revision })
        : createCatalogueEntry("curriculum-mapping", input);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["syllabus-catalogues", "curriculum-mapping"] });
      onSaved();
    },
  });
  const labelFor = (id: string) => options.find((option) => option.value === id)?.label ?? "";
  return <form onSubmit={(event) => { event.preventDefault(); if (code.trim()) save.mutate(); }} className="mt-5 grid gap-4 rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4">
    <Field label="Course code"><input autoFocus required value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} /></Field>
    <Field label="Course title"><input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} /></Field>
    <Field label="Level and semester" hint="For example L1-S1"><input value={semester} onChange={(event) => setSemester(event.target.value)} className={inputClass} /></Field>
    <PloAlignmentField
      label="Expected programme learning outcomes"
      pickerLabel={`Add an expected outcome to ${code || "this course"}`}
      emptyText="No outcomes expected of this course yet."
      addText="Add expected outcome"
      value={selected.map(labelFor).filter(Boolean).join("\n")}
      onChange={(next) => setSelected(next.split("\n").filter(Boolean).map((label) => options.find((option) => option.label === label)?.value).filter((id): id is string => Boolean(id)))}
      options={options}
    />
    <FormActions isSaving={save.isPending} error={save.error} onCancel={onCancel} submitLabel={entry ? "Save changes" : "Add to the map"} />
  </form>;
}

/** Editing a mapped course needs its programme's outcomes, which the row points at. */
function CurriculumMappingEditForm({ entry, onCancel, onSaved }: { entry: CatalogueEntry; onCancel: () => void; onSaved: () => void }) {
  const programmeId = entry.parentId ?? "";
  const plos = useQuery({
    queryKey: ["syllabus-catalogues", "plos", programmeId],
    queryFn: () => listCatalogueEntries("plos", { parentId: programmeId }),
    enabled: Boolean(programmeId),
  });
  if (plos.isLoading) return <p className="mt-5 text-sm text-[#667085]">Loading outcomes…</p>;
  return <CurriculumMappingForm programmeId={programmeId} plos={plos.data ?? []} entry={entry} onCancel={onCancel} onSaved={onSaved} />;
}
