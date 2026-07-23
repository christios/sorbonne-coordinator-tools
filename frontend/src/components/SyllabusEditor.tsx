import { ArrowLeft, CheckCircle2, GitCompareArrows, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Syllabus, updateSyllabus } from "@/services/syllabi";
import { FieldHistoryControl, FieldHistorySidebar, HistoryField } from "@/components/FieldHistory";
import { SelectMenu } from "@/components/SelectMenu";
import { AssessmentEditor, BibliographyEditor, PloEditor } from "@/components/StructuredEntryEditors";

const SECTIONS = [
  ["identification", "1. Course identification"], ["contacts", "2. Academic contacts"], ["description", "3. Course description"],
  ["delivery", "4. Course delivery"], ["learningOutcomes", "5. Learning outcomes"], ["schedule", "6. Course schedule"],
  ["bibliography", "7. Bibliography"], ["teachingApproach", "8. Teaching approach"], ["assessment", "9. Course assessment"],
  ["integrity", "10. Integrity policy"], ["etiquette", "11. Classroom etiquette"], ["documentControl", "12. Document control"],
] as const;

const INTEGRITY_TEXT = "Students are expected to comply at all times with all applicable University policies and regulations. Unless expressly authorised by the instructor, the use of generative artificial intelligence tools in coursework, assessments, or examinations is prohibited.";
const ETIQUETTE_TEXT = "The quality of a course depends on the engagement of everyone who participates. Students are expected to arrive prepared, participate constructively, communicate respectfully, and keep personal devices out of sight unless their use is authorised for learning.";

type Props = { syllabus: Syllabus; onBack: () => void; onSaved: (syllabus: Syllabus) => void; onCompare: () => void };
type Row = Record<string, string> & { id: string };

export function SyllabusEditor({ syllabus, onBack, onSaved, onCompare }: Props) {
  const [draft, setDraft] = useState(syllabus);
  const [active, setActive] = useState<(typeof SECTIONS)[number][0]>("identification");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [historyField, setHistoryField] = useState<HistoryField | null>(null);
  const requestId = useRef(0);

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

  function edit(updater: (current: Syllabus) => Syllabus) { setDraft((current) => updater(current)); setDirty(true); }
  function editContent(section: string, value: unknown) { edit((current) => ({ ...current, content: { ...current.content, [section]: value } })); }
  function editMetadata(field: "courseTitle" | "courseCode" | "academicYear", value: string) { edit((current) => ({ ...current, [field]: value })); }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-[#d9dee7] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3"><button onClick={onBack} className="mt-1 rounded-md p-2 text-[#344054] hover:bg-[#e8edf3]" aria-label="Back to syllabus library"><ArrowLeft size={19} /></button><div><p className="text-sm font-medium text-[#a6292f]">{draft.academicYear}</p><h2 className="text-xl font-semibold text-[#171717]">{draft.courseTitle}</h2><p className="text-sm text-[#667085]">{draft.courseCode || "Course code not set"}</p></div></div>
        <div className="flex flex-wrap items-center gap-3"><SaveStatus state={saveState} /><button onClick={onCompare} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><GitCompareArrows size={17} /> Compare years</button></div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[245px_minmax(0,1fr)]">
        <nav aria-label="Syllabus sections" className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit">
          {SECTIONS.map(([key, label]) => <button key={key} onClick={() => setActive(key)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${active === key ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}>{label}</button>)}
        </nav>
        <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5"><SectionForm active={active} draft={draft} editContent={editContent} editMetadata={editMetadata} onOpenHistory={setHistoryField} /></section>
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
  if (active === "identification") { const hours = record(section.contactHours); return <Section title="Course identification">{text("Course title", draft.courseTitle, (value) => editMetadata("courseTitle", value))}{text("Course code", draft.courseCode, (value) => editMetadata("courseCode", value))}{text("Academic year", draft.academicYear, (value) => editMetadata("academicYear", value))}{text("Degree level and semester", section.degreeLevelAndSemester, (value) => editContent(active, { ...section, degreeLevelAndSemester: value }))}{text("Programme title", section.programmeTitle, (value) => editContent(active, { ...section, programmeTitle: value }))}{text("Number of ECTS", section.ects, (value) => editContent(active, { ...section, ects: value }))}<div className="rounded-md border border-[#d9dee7] p-4"><h4 className="text-sm font-semibold text-[#344054]">Course contact hours</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">{["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"].map((label) => <div key={label}>{text(label, hours[label] ?? "", (value) => editContent(active, { ...section, contactHours: { ...hours, [label]: value } }))}</div>)}</div></div>{text("Prerequisites and co-requisites", section.prerequisites, (value) => editContent(active, { ...section, prerequisites: value }), true)}{text("Equipment", section.equipment, (value) => editContent(active, { ...section, equipment: value }), true)}</Section>; }
  if (active === "contacts") { const instructor = record(section.instructor); return <Section title="Academic contacts">{["Name", "Academic rank / status", "Affiliation(s)", "Office hours and location", "Email"].map((label) => <div key={label}>{text(label, instructor[label] ?? "", (value) => editContent(active, { ...section, instructor: { ...instructor, [label]: value } }), label === "Office hours and location")}</div>)}{text("Academic coordinator name and contact details", section.administrativeContact, (value) => editContent(active, { ...section, administrativeContact: value }), true)}</Section>; }
  if (active === "description") return <Section title="Course description">{text("Course description", section.overview, (value) => editContent(active, { overview: value }), true)}</Section>;
  if (active === "delivery") return <Section title="Course delivery"><SelectField label="Delivery mode" value={stringify(section.mode)} onChange={(value) => editContent(active, { ...section, mode: value })} history={history("Delivery mode")} options={["Face-to-Face Delivery", "Blended Learning Delivery"]} placeholder="Select delivery mode" />{text("Face-to-face (%)", section.faceToFacePercent, (value) => editContent(active, { ...section, faceToFacePercent: value }))}{text("Online (%)", section.onlinePercent, (value) => editContent(active, { ...section, onlinePercent: value }))}</Section>;
  if (active === "learningOutcomes") return <Section title="Learning outcomes"><PloEditor value={section.plos} onChange={(plos) => editContent(active, { ...section, plos })} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /><RowsEditor title="Course learning outcomes and alignment" columns={[["clo", "Course learning outcome"], ["plo", "Aligned PLO"], ["skills", "Graduate skills"]]} rows={(section.clos as Row[]) ?? []} onChange={(clos) => editContent(active, { ...section, clos })} historyPath="learningOutcomes.clos" syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>;
  if (active === "schedule") { const sessions = ((content.schedule as Row[]) ?? []).map((session) => session.preClass === undefined && session.activities ? { ...session, preClass: session.activities } : session); return <Section title="Course schedule"><RowsEditor title="Sessions" columns={[["session", "Session"], ["date", "Date"], ["topic", "Topic"], ["preClass", "Pre-class learning activities"], ["assessments", "Assessments"]]} rows={sessions} onChange={(schedule) => editContent(active, schedule)} historyPath="schedule" syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>; }
  if (active === "bibliography") return <Section title="Supplemental bibliographical resources"><BibliographyEditor value={section} onChange={(bibliography) => editContent(active, bibliography)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>;
  if (active === "teachingApproach") return <Section title="Teaching and learning approach">{text("Teaching methods and learning activities", section.methods, (value) => editContent(active, { ...section, methods: value }), true)}{text("Student engagement", section.engagement, (value) => editContent(active, { ...section, engagement: value }), true)}{text("Feedback and academic progress", section.feedback, (value) => editContent(active, { ...section, feedback: value }), true)}</Section>;
  if (active === "assessment") return <Section title="Course assessment"><AssessmentEditor value={section} outcomes={(sectionFrom(content.learningOutcomes).clos as Row[]) ?? []} onChange={(assessment) => editContent(active, assessment)} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} /></Section>;
  if (active === "integrity") return <LockedSection title="Integrity policy" text={INTEGRITY_TEXT} />;
  if (active === "etiquette") return <LockedSection title="Classroom etiquette" text={ETIQUETTE_TEXT} />;
  return <Section title="Document control">{text("Document creation date", section.creationDate, (value) => editContent(active, { ...section, creationDate: value }))}{text("Department name", section.departmentName, (value) => editContent(active, { ...section, departmentName: value }))}{text("Syllabus approval date", section.approvalDate, (value) => editContent(active, { ...section, approvalDate: value }))}{text("Version number", section.versionNumber, (value) => editContent(active, { ...section, versionNumber: value }))}{text("Name and status of approver", section.approver, (value) => editContent(active, { ...section, approver: value }))}</Section>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><div className="mt-5 grid gap-4">{children}</div></>; }
function Field({ label, value, onChange, multiline, isDate, history }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; isDate?: boolean; history: { syllabusId: string; revision: number; field: HistoryField; onOpenSidebar: (field: HistoryField) => void } }) { const fieldValue = isDate ? dateInputValue(value) : value; return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<div className="relative">{multiline ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={4} className="w-full resize-y rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6" /> : <input type={isDate ? "date" : "text"} value={fieldValue} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal" />}<FieldHistoryControl {...history} placement={multiline ? "top" : "center"} /></div></label>; }
function SelectField({ label, value, onChange, options, placeholder, history }: { label: string; value: string; onChange: (value: string) => void; options: string[]; placeholder?: string; history: { syllabusId: string; revision: number; field: HistoryField; onOpenSidebar: (field: HistoryField) => void } }) {
  return <label className="grid gap-1 text-sm font-medium text-[#344054]">{label}<SelectMenu label={label} value={value} onChange={onChange} placeholder={placeholder} options={options.map((option) => ({ value: option, label: option }))} trailing={<FieldHistoryControl {...history} />} /></label>;
}
function LockedSection({ title, text }: { title: string; text: string }) { return <><h3 className="text-lg font-semibold text-[#171717]">{title}</h3><div className="mt-5 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-4 text-sm leading-6 text-[#475467]"><p className="mb-2 font-semibold text-[#344054]">University standard text</p>{text}</div></>; }
function RowsEditor({ title, columns, rows, onChange, historyPath, syllabusId, revision, onOpenHistory }: { title: string; columns: string[][]; rows: Row[]; onChange: (rows: Row[]) => void; historyPath: string; syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void }) {
  const normalized = Array.isArray(rows) ? rows : [];
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");
  const moveRowBefore = (sourceId: string, destinationId?: string) => {
    const source = normalized.find((row) => row.id === sourceId);
    if (!source) return;
    const withoutSource = normalized.filter((row) => row.id !== sourceId);
    const destinationIndex = destinationId ? withoutSource.findIndex((row) => row.id === destinationId) : withoutSource.length;
    onChange([...withoutSource.slice(0, destinationIndex), source, ...withoutSource.slice(destinationIndex)]);
    setMovingRowId(null);
    setMoveQuery("");
  };
  return <section className="mt-2"><div className="mb-3 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold text-[#344054]">{title}</h4><button type="button" onClick={() => onChange([...normalized, { id: crypto.randomUUID() }])} className="rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Add row</button></div><div className="grid gap-4">{normalized.map((row, index) => { const destinations = normalized.filter((item) => item.id !== row.id && rowIdentity(item, columns).toLowerCase().includes(moveQuery.toLowerCase())); return <fieldset key={row.id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"><div className="relative mb-4 flex items-center justify-between gap-3"><p className="text-sm font-semibold text-[#344054]">{rowIdentity(row, columns)} <span className="font-normal text-[#667085]">· position {index + 1}</span></p><div className="flex items-center gap-3"><button type="button" onClick={() => { setMovingRowId(row.id); setMoveQuery(""); }} className="text-sm font-semibold text-[#1f4e79] hover:underline">Move to…</button><button type="button" onClick={() => onChange(normalized.filter((_, itemIndex) => itemIndex !== index))} className="text-sm font-semibold text-[#a6292f] hover:underline">Remove row</button></div>{movingRowId === row.id ? <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"><p className="text-sm font-semibold text-[#344054]">Place this row before</p><input type="search" value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} placeholder="Search destination rows" className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus /><div className="mt-2 max-h-56 overflow-y-auto">{destinations.map((destination, destinationIndex) => <button type="button" key={destination.id} onClick={() => moveRowBefore(row.id, destination.id)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"><span className="text-[#667085]">{destinationIndex + 1}. </span>{rowIdentity(destination, columns)}</button>)}</div><button type="button" onClick={() => moveRowBefore(row.id)} className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Move to end</button></div> : null}</div><div className="grid gap-4 lg:grid-cols-2">{columns.map(([key, label]) => { const field = { path: `${historyPath}[${row.id}].${key}`, label: `${title} · ${label}` }; const value = row[key] ?? ""; const multiline = shouldUseMultiline(key, value); const useDatePicker = shouldUseDatePicker(key, value); return <label key={key} className={`grid gap-1 text-sm font-medium text-[#344054] ${multiline ? "lg:col-span-2" : ""}`}>{label}<div className="relative">{multiline ? <textarea value={value} onChange={(event) => onChange(normalized.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item))} rows={3} className="w-full resize-y rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal leading-6 focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /> : <input type={useDatePicker ? "date" : "text"} value={useDatePicker ? dateInputValue(value) : value} onChange={(event) => onChange(normalized.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item))} className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-10 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />}<FieldHistoryControl syllabusId={syllabusId} revision={revision} field={field} onOpenSidebar={onOpenHistory} placement={multiline ? "top" : "center"} /></div></label>; })}</div></fieldset>; })}</div>{normalized.length === 0 ? <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">No rows added yet.</p> : null}</section>;
}
function shouldUseMultiline(key: string, value: string) { return value.length > 90 || ["activities", "clos", "skills", "criteria", "meets", "exceeds"].includes(key); }
function rowIdentity(row: Row, columns: string[][]) { const preferredKeys = ["session", "topic", "clo", "type", "assignment", "date"]; const value = preferredKeys.map((key) => row[key]).find((item) => item?.trim()) ?? columns.map(([key]) => row[key]).find((item) => item?.trim()) ?? "Untitled row"; return value.length > 72 ? `${value.slice(0, 69)}…` : value; }
function shouldUseDatePicker(key: string, value: string) { return key === "date" && (value === "" || dateInputValue(value) !== ""); }
function fieldPath(active: string, label: string) { const fieldNames: Record<string, Record<string, string>> = { identification: { "Course title": "metadata.courseTitle", "Course code": "metadata.courseCode", "Academic year": "metadata.academicYear", "Degree level and semester": "identification.degreeLevelAndSemester", "Programme title": "identification.programmeTitle", "Number of ECTS": "identification.ects", "Prerequisites and co-requisites": "identification.prerequisites", Equipment: "identification.equipment" }, description: { "Course description": "description.overview" }, delivery: { "Delivery mode": "delivery.mode", "Face-to-face (%)": "delivery.faceToFacePercent", "Online (%)": "delivery.onlinePercent" }, learningOutcomes: { "Programme learning outcomes (one per line)": "learningOutcomes.plos" }, bibliography: { Books: "bibliography.books", Websites: "bibliography.websites", "Journal articles": "bibliography.journalArticles" }, teachingApproach: { "Teaching methods and learning activities": "teachingApproach.methods", "Student engagement": "teachingApproach.engagement", "Feedback and academic progress": "teachingApproach.feedback" }, assessment: { "AI policy": "assessment.aiPolicy", "Additional instructions regarding AI": "assessment.aiInstructions", "Assessment methodologies": "assessment.methodologies", "Late submission policy": "assessment.lateSubmissionPolicy" }, documentControl: { "Document creation date": "documentControl.creationDate", "Department name": "documentControl.departmentName", "Syllabus approval date": "documentControl.approvalDate", "Version number": "documentControl.versionNumber", "Name and status of approver": "documentControl.approver" } }; if (active === "identification" && ["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"].includes(label)) return `identification.contactHours.${label}`; if (active === "contacts") return label === "Academic coordinator name and contact details" ? "contacts.administrativeContact" : `contacts.instructor.${label}`; return fieldNames[active]?.[label] ?? `${active}.${label}`; }
function isDateField(active: string, label: string) { return active === "documentControl" && ["Document creation date", "Syllabus approval date"].includes(label); }
function dateInputValue(value: string) { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value; const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}-${match[2]}-${match[1]}` : ""; }
function stringify(value: unknown) { return typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sectionFrom(value: unknown): Record<string, unknown> { return record(value); }
