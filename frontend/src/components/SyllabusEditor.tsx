import { ArrowDownUp, ArrowLeft, CheckCircle2, ChevronDown, GitCompareArrows, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Syllabus, updateSyllabus } from "@/services/syllabi";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { FieldHistoryControl, FieldHistorySidebar, HistoryField } from "@/components/FieldHistory";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { SelectMenu } from "@/components/SelectMenu";
import { AssessmentTabs } from "@/components/AssessmentTabs";
import { BibliographyEditor, PloEditor } from "@/components/StructuredEntryEditors";
import { deliveryPercentageError, ploEntries } from "@/services/syllabusContent";

const SECTIONS = [
  ["identification", "1. Course identification"], ["contacts", "2. Academic contacts"], ["description", "3. Course description"],
  ["delivery", "4. Course delivery"], ["learningOutcomes", "5. Learning outcomes"], ["schedule", "6. Course schedule"],
  ["bibliography", "7. Bibliography"], ["teachingApproach", "8. Teaching approach"], ["assessment", "9. Course assessment"],
  ["documentControl", "10. Document control"],
] as const;

const GRADE_EQUIVALENCE_TEXT = "Sorbonne University Abu Dhabi uses the French grading system, with marks ranging from 0 to 20. The University Student Handbook provides the applicable grade-equivalence guidance. This institutional reference is displayed here and cannot be edited in an individual course syllabus.";

type Props = { syllabus: Syllabus; onBack: () => void; onSaved: (syllabus: Syllabus) => void; onCompare: () => void };
type Row = Record<string, string> & { id: string };

export function SyllabusEditor({ syllabus, onBack, onSaved, onCompare }: Props) {
  const [draft, setDraft] = useState(syllabus);
  const [active, setActive] = useState<(typeof SECTIONS)[number][0]>("identification");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [historyField, setHistoryField] = useState<HistoryField | null>(null);
  const requestId = useRef(0);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(syllabus); setDirty(false); setSaveState("saved"); }, [syllabus]);
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(async () => {
      const id = ++requestId.current;
      setSaveState("saving");
      try {
        const saved = await updateSyllabus(draft.id, {
          expectedRevision: draft.revision,
          content: draft.content,
          courseTitle: draft.courseTitle,
          courseCode: draft.courseCode,
          academicYear: draft.academicYear,
        });
        if (id === requestId.current) { setDraft(saved); setDirty(false); setSaveState("saved"); onSaved(saved); }
      } catch { if (id === requestId.current) setSaveState("error"); }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, onSaved]);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const adjustHeight = (textarea: HTMLTextAreaElement) => {
      textarea.style.resize = "none";
      textarea.style.overflowY = "hidden";
      textarea.style.height = "auto";
      const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
      const minimumHeight = lineHeight * Number(textarea.getAttribute("rows") || 3);
      textarea.style.height = `${Math.max(textarea.scrollHeight, minimumHeight)}px`;
    };
    const resizeAll = () => editor.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(adjustHeight);
    const handleInput = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement) adjustHeight(event.target);
    };
    resizeAll();
    editor.addEventListener("input", handleInput);
    return () => editor.removeEventListener("input", handleInput);
  }, [draft, active]);

  function edit(updater: (current: Syllabus) => Syllabus) { setDraft((current) => updater(current)); setDirty(true); }
  function editContent(section: string, value: unknown) { edit((current) => ({ ...current, content: { ...current.content, [section]: value } })); }
  function editMetadata(field: "courseTitle" | "courseCode" | "academicYear", value: string) { edit((current) => ({ ...current, [field]: value })); }

  return (
    <div ref={editorRef} className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-[#d9dee7] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><button onClick={onBack} className="mt-1 rounded-md p-2 text-[#344054] hover:bg-[#e8edf3]" aria-label="Back to syllabus library"><ArrowLeft size={19} /></button><div><p className="text-sm font-medium text-[#a6292f]">{draft.academicYear}</p><h2 className="text-xl font-semibold text-[#171717]">{draft.courseTitle}</h2><p className="text-sm text-[#667085]">{draft.courseCode || "Course code not set"}</p></div></div>
        <div className="flex flex-wrap items-center gap-3"><SaveStatus state={saveState} /><button onClick={onCompare} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><GitCompareArrows size={17} /> Compare years</button></div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[245px_minmax(0,1fr)]">
        <nav aria-label="Syllabus sections" className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit">
          {SECTIONS.map(([key, label]) => <button key={key} onClick={() => setActive(key)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${active === key ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}>{label}</button>)}
        </nav>
        {active === "learningOutcomes" ? <SectionForm active={active} draft={draft} editContent={editContent} editMetadata={editMetadata} onOpenHistory={setHistoryField} /> : <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5"><SectionForm active={active} draft={draft} editContent={editContent} editMetadata={editMetadata} onOpenHistory={setHistoryField} /></section>}
      </div>
      <FieldHistorySidebar syllabusId={draft.id} revision={draft.revision} field={historyField} onClose={() => setHistoryField(null)} />
    </div>
  );
}

function SaveStatus({ state }: { state: "saved" | "saving" | "error" }) {
  if (state === "saving") return <span className="inline-flex items-center gap-2 text-sm text-[#667085]"><Loader2 className="animate-spin" size={16} /> Saving</span>;
  if (state === "error") return <span className="inline-flex items-center gap-2 text-sm text-[#a6292f]"><TriangleAlert size={16} /> Save failed — retrying on your next edit</span>;
  return <span className="inline-flex items-center gap-2 text-sm text-[#24805a]"><CheckCircle2 size={16} /> Saved</span>;
}

function SectionForm({ active, draft, editContent, editMetadata, onOpenHistory }: { active: string; draft: Syllabus; editContent: (section: string, value: unknown) => void; editMetadata: (field: "courseTitle" | "courseCode" | "academicYear", value: string) => void; onOpenHistory: (field: HistoryField) => void }) {
  const content = draft.content as Record<string, unknown>;
  const section = (Array.isArray(content[active]) ? {} : content[active] ?? {}) as Record<string, unknown>;
  const history = (label: string) => ({ syllabusId: draft.id, revision: draft.revision, field: { path: fieldPath(active, label), label }, onOpenSidebar: onOpenHistory });
  const text = (label: string, value: unknown, onChange: (value: string) => void, multiline = false) => <Field label={label} value={stringify(value)} onChange={onChange} multiline={multiline} isDate={isDateField(active, label)} history={history(label)} />;
  const numeric = (label: string, value: unknown, onChange: (value: string) => void, options: { min?: number; max?: number; step?: number; invalid?: boolean } = {}) => <Field label={label} value={stringify(value)} onChange={onChange} inputType="number" min={options.min} max={options.max} step={options.step} invalid={options.invalid} history={history(label)} />;
  if (active === "identification") { const hours = record(section.contactHours); return <Section title="Course identification">{text("Course title", draft.courseTitle, (value) => editMetadata("courseTitle", value))}{text("Course code", draft.courseCode, (value) => editMetadata("courseCode", value))}{text("Academic year", draft.academicYear, (value) => editMetadata("academicYear", value))}{text("Degree level and semester", section.degreeLevelAndSemester, (value) => editContent(active, { ...section, degreeLevelAndSemester: value }))}{text("Programme title", section.programmeTitle, (value) => editContent(active, { ...section, programmeTitle: value }))}{numeric("Number of ECTS", section.ects, (value) => editContent(active, { ...section, ects: value }), { min: 0, step: 0.5 })}<div className="rounded-md border border-[#d9dee7] p-4"><h4 className="text-sm font-semibold text-[#344054]">Course contact hours</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">{["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"].map((label) => <div key={label}>{numeric(label, hours[label] ?? "", (value) => editContent(active, { ...section, contactHours: { ...hours, [label]: value } }), { min: 0, step: 0.5 })}</div>)}</div></div>{text("Prerequisites and co-requisites", section.prerequisites, (value) => editContent(active, { ...section, prerequisites: value }), true)}{text("Equipment", section.equipment, (value) => editContent(active, { ...section, equipment: value }), true)}</Section>; }
  if (active === "contacts") { const instructor = record(section.instructor); const administrativeContact = typeof section.administrativeContact === "string" ? { contactDetails: section.administrativeContact } : record(section.administrativeContact); return <Section title="Academic contacts">{["Name", "Academic rank / status", "Affiliation(s)", "Office hours and location", "Email"].map((label) => <div key={label}>{text(label, instructor[label] ?? "", (value) => editContent(active, { ...section, instructor: { ...instructor, [label]: value } }), label === "Office hours and location")}</div>)}{text("Academic coordinator name", administrativeContact.name, (value) => editContent(active, { ...section, administrativeContact: { ...administrativeContact, name: value } }))}{text("Academic coordinator contact details", administrativeContact.contactDetails, (value) => editContent(active, { ...section, administrativeContact: { ...administrativeContact, contactDetails: value } }), true)}</Section>; }
  if (active === "description") return <Section title="Course description">{text("Course description", section.overview, (value) => editContent(active, { overview: value }), true)}</Section>;
  if (active === "delivery") { const faceToFace = stringify(section.faceToFacePercent); const online = stringify(section.onlinePercent); const percentageError = deliveryPercentageError(faceToFace, online); return <Section title="Course delivery"><SelectField label="Delivery mode" value={stringify(section.mode)} onChange={(value) => editContent(active, { ...section, mode: value })} history={history("Delivery mode")} options={["Face-to-Face Delivery", "Blended Learning Delivery"]} placeholder="Select delivery mode" />{numeric("Face-to-face (%)", faceToFace, (value) => editContent(active, { ...section, faceToFacePercent: value }), { min: 0, max: 100, step: 1, invalid: Boolean(percentageError) })}{numeric("Online (%)", online, (value) => editContent(active, { ...section, onlinePercent: value }), { min: 0, max: 100, step: 1, invalid: Boolean(percentageError) })}{percentageError ? <p role="alert" className="text-sm font-medium text-[#a6292f]">{percentageError}</p> : null}</Section>; }
  if (active === "learningOutcomes") return <LearningOutcomesEditor section={section} onChange={(next) => editContent(active, next)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} />;
  if (active === "schedule") { const sessions = ((content.schedule as Row[]) ?? []).map((session) => session.preClass === undefined && session.activities ? { ...session, preClass: session.activities } : session); return <Section title="Course schedule"><ScheduleEditor rows={sessions} onChange={(schedule) => editContent(active, schedule)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>; }
  if (active === "bibliography") return <Section title="Supplemental bibliographical resources"><BibliographyEditor value={section} onChange={(bibliography) => editContent(active, bibliography)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>;
  if (active === "teachingApproach") return <Section title="Teaching and learning approach">{text("Teaching methods and learning activities", section.methods, (value) => editContent(active, { ...section, methods: value }), true)}{text("Student engagement", section.engagement, (value) => editContent(active, { ...section, engagement: value }), true)}{text("Feedback and academic progress", section.feedback, (value) => editContent(active, { ...section, feedback: value }), true)}</Section>;
  if (active === "assessment") return <Section title="Course assessment"><AssessmentTabs value={section} outcomes={(sectionFrom(content.learningOutcomes).clos as Row[]) ?? []} onChange={(assessment) => editContent(active, assessment)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /><LockedSection title="University table of grade equivalence" text={GRADE_EQUIVALENCE_TEXT} /></Section>;
  return <Section title="Document control">{text("Document creation date", section.creationDate, (value) => editContent(active, { ...section, creationDate: value }))}{text("Department name", section.departmentName, (value) => editContent(active, { ...section, departmentName: value }))}{text("Syllabus approval date", section.approvalDate, (value) => editContent(active, { ...section, approvalDate: value }))}{text("Version number", section.versionNumber, (value) => editContent(active, { ...section, versionNumber: value }))}{text("Name and status of approver", section.approver, (value) => editContent(active, { ...section, approver: value }))}</Section>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><div className="mt-5 grid gap-4">{children}</div></>; }
function LearningOutcomesEditor({ section, onChange, syllabusId, revision, onOpenHistory }: { section: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void }) { const [tab, setTab] = useState<"plos" | "clos">("plos"); const tabs = [{ key: "plos" as const, label: "Programme learning outcomes" }, { key: "clos" as const, label: "Course learning outcomes" }]; const ploOptions = ploEntries(section.plos).map((plo, index) => { const label = plo.code ? `${plo.code}${plo.outcome ? `: ${plo.outcome}` : ""}` : plo.legacyText || `PLO ${index + 1}`; return { value: label, label }; }); return <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5"><h3 className="text-lg font-semibold text-[#171717]">Learning outcomes</h3><div role="tablist" aria-label="Learning outcomes editor" className="mt-5 flex gap-1 border-b border-[#d9dee7]">{tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === item.key ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"}`}>{item.label}</button>)}</div><div role="tabpanel" className="mt-5 min-w-0">{tab === "plos" ? <PloEditor value={section.plos} onChange={(plos) => onChange({ ...section, plos })} syllabusId={syllabusId} revision={revision} onOpenHistory={onOpenHistory} /> : <RowsEditor title="Course learning outcomes and alignment" columns={[["clo", "Course learning outcome"], ["plo", "Aligned PLOs"], ["skills", "Graduate skills"]]} rows={(section.clos as Row[]) ?? []} onChange={(clos) => onChange({ ...section, clos })} selectOptions={{ plo: ploOptions }} addLabel="Add outcome" historyPath="learningOutcomes.clos" syllabusId={syllabusId} revision={revision} onOpenHistory={onOpenHistory} />}</div></section>; }
function Field({ label, value, onChange, multiline, isDate, inputType = "text", min, max, step, invalid, history }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; isDate?: boolean; inputType?: "text" | "number"; min?: number; max?: number; step?: number; invalid?: boolean; history: { syllabusId: string; revision: number; field: HistoryField; onOpenSidebar: (field: HistoryField) => void } }) { const fieldValue = isDate ? dateInputValue(value) : value; const inputClass = `w-full rounded-md border px-3 py-2 pr-10 font-normal ${invalid ? "border-[#a6292f] focus:border-[#a6292f] focus:ring-[#fde2e2]" : "border-[#b7bec8] focus:border-[#1f4e79] focus:ring-[#d7e5f3]"} focus:outline-none focus:ring-2`; return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<div className="relative">{multiline ? <AutoResizeTextarea value={value} onChange={(event) => onChange(event.target.value)} minRows={4} className="rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6" /> : <input type={isDate ? "date" : inputType} value={fieldValue} min={min} max={max} step={step} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} className={inputClass} />}<FieldHistoryControl {...history} placement={multiline ? "top" : "center"} /></div></label>; }
function SelectField({ label, value, onChange, options, placeholder, history }: { label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder?: string; history: { syllabusId: string; revision: number; field: HistoryField; onOpenSidebar: (field: HistoryField) => void } }) {
  return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<SelectMenu label={label} value={value} onChange={onChange} placeholder={placeholder} options={options.map((option) => ({ value: option, label: option }))} trailing={<FieldHistoryControl {...history} />} /></label>;
}
function LockedSection({ title, text }: { title: string; text: string }) { return <><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><div className="mt-5 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-4 text-sm leading-6 text-[#475467]"><p className="mb-2 font-semibold text-[#344054]">University standard text</p>{text}</div></>; }
function RowsEditor({ title, columns, rows, onChange, selectOptions, addLabel = "Add row", historyPath, syllabusId, revision, onOpenHistory }: { title: string; columns: string[][]; rows: Row[]; onChange: (rows: Row[]) => void; selectOptions?: Record<string, Array<{ value: string; label: string }>>; addLabel?: string; historyPath: string; syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void }) {
  const normalized = Array.isArray(rows) ? rows : [];
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");
  const [expandedRowIds, setExpandedRowIds] = useState<string[]>([]);
  useEffect(() => {
    if (!movingRowId) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-move-menu]")) {
        setMovingRowId(null);
        setMoveQuery("");
      }
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () => document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, [movingRowId]);
  const moveRowBefore = (sourceId: string, destinationId?: string) => {
    const source = normalized.find((row) => row.id === sourceId);
    if (!source) return;
    const withoutSource = normalized.filter((row) => row.id !== sourceId);
    const destinationIndex = destinationId ? withoutSource.findIndex((row) => row.id === destinationId) : withoutSource.length;
    onChange([...withoutSource.slice(0, destinationIndex), source, ...withoutSource.slice(destinationIndex)]);
    setMovingRowId(null);
    setMoveQuery("");
  };
  const addRow = () => { const id = crypto.randomUUID(); onChange([...normalized, { id }]); setExpandedRowIds((current) => [...current, id]); window.requestAnimationFrame(() => document.getElementById(`row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); };
  const outcomeRows = columns.some(([key]) => key === "clo");
  return <section className="mt-2"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#344054]">{title}</h4><button type="button" onClick={addRow} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><Plus size={16} /> {addLabel}</button></div><div className="grid gap-4">{normalized.map((row, index) => { const destinations = normalized.filter((item) => item.id !== row.id && rowIdentity(item, columns).toLowerCase().includes(moveQuery.toLowerCase())); const isExpanded = !outcomeRows || expandedRowIds.includes(row.id); const updateRow = (key: string, value: string) => onChange(normalized.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)); return <fieldset id={`row-${row.id}`} key={row.id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"><div className="relative flex items-start justify-between gap-3">{outcomeRows ? <button type="button" onClick={() => setExpandedRowIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} className="flex min-w-0 flex-1 items-start gap-2 text-left"><ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${isExpanded ? "rotate-180" : ""}`} /><span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">CLO {index + 1}</span><span className="mt-0.5 block text-sm text-[#475467]">{outcomeSummary(row.clo, index) || "Untitled outcome"}</span></span></button> : <p className="min-w-0 flex-1 break-words text-sm font-semibold text-[#344054]">{rowIdentity(row, columns)}</p>}<div data-move-menu className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => { setMovingRowId(row.id); setMoveQuery(""); }} className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]" aria-label={`Move ${rowIdentity(row, columns)}`} title="Move row"><ArrowDownUp size={17} /></button><button type="button" onClick={() => onChange(normalized.filter((_, itemIndex) => itemIndex !== index))} className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${rowIdentity(row, columns)}`} title="Remove row"><Trash2 size={17} /></button></div>{movingRowId === row.id ? <div data-move-menu className="absolute right-0 top-full z-[90] isolate mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg"><p className="text-sm font-semibold text-[#344054]">Place this row before</p><input type="search" value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} placeholder="Search destination rows" className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus /><div className="mt-2 max-h-56 overflow-y-auto">{destinations.map((destination, destinationIndex) => <button type="button" key={destination.id} onClick={() => moveRowBefore(row.id, destination.id)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"><span className="text-[#667085]">{destinationIndex + 1}. </span>{rowIdentity(destination, columns)}</button>)}</div><button type="button" onClick={() => moveRowBefore(row.id)} className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Move to end</button></div> : null}</div>{isExpanded ? <div className="mt-4 grid gap-4 lg:grid-cols-2">{columns.map(([key, label]) => { const field = { path: `${historyPath}[${row.id}].${key}`, label: `${title} · ${label}` }; const value = row[key] ?? ""; const multiline = shouldUseMultiline(key, value); const useDatePicker = shouldUseDatePicker(key, value); const options = selectOptions?.[key]; const availableOptions = options && value && !options.some((option) => option.value === value) ? [{ value, label: value }, ...options] : options; return <label key={key} className={`grid gap-1 text-sm font-medium text-[#344054] ${multiline ? "lg:col-span-2" : ""}`}>{label}{availableOptions ? <SelectMenu label={label} value={value} onChange={(next) => updateRow(key, next)} placeholder="Select a programme learning outcome" options={availableOptions} trailing={<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} />} /> : <div className="relative">{multiline ? <textarea value={value} onChange={(event) => updateRow(key, event.target.value)} rows={3} className="w-full resize-y rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={useDatePicker ? "date" : "text"} value={useDatePicker ? dateInputValue(value) : value} onChange={(event) => updateRow(key, event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} /></div>}</label>; })}</div> : null}</fieldset>; })}</div>{normalized.length === 0 ? <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No rows added yet.</p> : null}</section>;
}
function shouldUseMultiline(key: string, value: string) { return value.length > 90 || ["activities", "preClass", "assessments", "clos", "skills", "criteria", "meets", "exceeds"].includes(key); }
function rowIdentity(row: Row, columns: string[][]) { const preferredKeys = ["session", "topic", "clo", "type", "assignment", "date"]; return preferredKeys.map((key) => row[key]).find((item) => item?.trim()) ?? columns.map(([key]) => row[key]).find((item) => item?.trim()) ?? "Untitled row"; }
function outcomeSummary(value: string | undefined, index: number) { return (value ?? "").replace(new RegExp(`^CLO\\s*${index + 1}\\s*[:.]?\\s*`, "i"), ""); }
function shouldUseDatePicker(key: string, value: string) { return key === "date" && (value === "" || dateInputValue(value) !== ""); }
function fieldPath(active: string, label: string) { const fieldNames: Record<string, Record<string, string>> = { identification: { "Course title": "metadata.courseTitle", "Course code": "metadata.courseCode", "Academic year": "metadata.academicYear", "Degree level and semester": "identification.degreeLevelAndSemester", "Programme title": "identification.programmeTitle", "Number of ECTS": "identification.ects", "Prerequisites and co-requisites": "identification.prerequisites", Equipment: "identification.equipment" }, description: { "Course description": "description.overview" }, delivery: { "Delivery mode": "delivery.mode", "Face-to-face (%)": "delivery.faceToFacePercent", "Online (%)": "delivery.onlinePercent" }, learningOutcomes: { "Programme learning outcomes (one per line)": "learningOutcomes.plos" }, bibliography: { Books: "bibliography.books", Websites: "bibliography.websites", "Journal articles": "bibliography.journalArticles" }, teachingApproach: { "Teaching methods and learning activities": "teachingApproach.methods", "Student engagement": "teachingApproach.engagement", "Feedback and academic progress": "teachingApproach.feedback" }, assessment: { "AI policy": "assessment.aiPolicy", "Additional instructions regarding AI": "assessment.aiInstructions", "Assessment methodologies": "assessment.methodologies", "Late submission policy": "assessment.lateSubmissionPolicy" }, documentControl: { "Document creation date": "documentControl.creationDate", "Department name": "documentControl.departmentName", "Syllabus approval date": "documentControl.approvalDate", "Version number": "documentControl.versionNumber", "Name and status of approver": "documentControl.approver" } }; if (active === "identification" && ["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"].includes(label)) return `identification.contactHours.${label}`; if (active === "contacts") { if (label === "Academic coordinator name") return "contacts.administrativeContact.name"; if (label === "Academic coordinator contact details") return "contacts.administrativeContact.contactDetails"; return `contacts.instructor.${label}`; } return fieldNames[active]?.[label] ?? `${active}.${label}`; }
function isDateField(active: string, label: string) { return active === "documentControl" && ["Document creation date", "Syllabus approval date"].includes(label); }
function dateInputValue(value: string) { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : ""; }
function stringify(value: unknown) { return typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sectionFrom(value: unknown): Record<string, unknown> { return record(value); }
