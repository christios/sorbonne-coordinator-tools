import {
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  GitCompareArrows,
  Loader2,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  downloadSyllabusExport,
  getFieldHistory,
  getSyllabus,
  Syllabus,
  SyllabusTemplate,
  syllabusTemplateDocumentUrl,
  updateSyllabus,
} from "@/services/syllabi";
import { AcademicContactsEditor } from "@/components/AcademicContactsEditor";
import { CourseIdentificationEditor } from "@/components/CourseIdentificationEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { HistoryTextField } from "@/components/HistoryTextField";
import {
  FieldHistoryControl,
  FieldHistoryProvider,
  FieldHistorySidebar,
  HistoryField,
} from "@/components/FieldHistory";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { AssessmentTabs } from "@/components/AssessmentTabs";
import { AddEntryButton } from "@/components/AddEntryButton";
import { SectionEditorShell } from "@/components/SectionEditorShell";
import { SyllabusSubsection } from "@/components/SyllabusSubsection";
import { saveFailureState, type SyllabusSaveState } from "@/components/syllabusSaveState";
import {
  BibliographyEditor,
  PloEditor,
} from "@/components/StructuredEntryEditors";
import {
  deliveryPercentageError,
  ploDisplayLabel,
  ploEntries,
} from "@/services/syllabusContent";
import { CatalogueEntry, listCatalogueEntries } from "@/services/syllabusCatalogues";

const GRADE_EQUIVALENCE_TEXT =
  "Sorbonne University Abu Dhabi uses the French grading system, with marks ranging from 0 to 20. The University Student Handbook provides the applicable grade-equivalence guidance. This institutional reference is displayed here and cannot be edited in an individual course syllabus.";

type Props = {
  syllabus: Syllabus;
  template: SyllabusTemplate;
  onBack: () => void;
  onSaved: (syllabus: Syllabus) => void;
  onCompare: () => void;
  onHeaderCollapseChange?: (collapsed: boolean) => void;
  compactHeaderActions?: ReactNode;
};
type Row = Record<string, string> & { id: string };

export function SyllabusEditor({
  syllabus,
  template,
  onBack,
  onSaved,
  onCompare,
  onHeaderCollapseChange,
  compactHeaderActions,
}: Props) {
  const [draft, setDraft] = useState(syllabus);
  const [active, setActive] = useState(
    template.sections[0]?.id ?? "identification",
  );
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SyllabusSaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadConfirmationOpen, setReloadConfirmationOpen] = useState(false);
  const [exportState, setExportState] = useState<
    "idle" | "exporting" | "error"
  >("idle");
  const [historyField, setHistoryField] = useState<HistoryField | null>(null);
  const requestId = useRef(0);
  const draftRef = useRef(syllabus);
  const saveInFlight = useRef(false);
  const saveConflict = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draftRef.current.id !== syllabus.id || !dirty) {
      draftRef.current = syllabus;
      setDraft(syllabus);
      setDirty(false);
      setSaveState("saved");
      setSaveError(null);
      saveConflict.current = false;
    }
  }, [dirty, syllabus]);
  useEffect(() => {
    if (!template.sections.some((section) => section.id === active))
      setActive(template.sections[0]?.id ?? "identification");
  }, [active, template]);
  useEffect(() => {
    if (!dirty || saveConflict.current) return;
    const timer = window.setTimeout(async () => {
      // A later keystroke may run while this request is in flight. Persisting
      // that stale snapshot would immediately create a revision conflict.
      if (saveInFlight.current) return;
      const snapshot = draftRef.current;
      const id = ++requestId.current;
      saveInFlight.current = true;
      setSaveState("saving");
      setSaveError(null);
      try {
        const saved = await updateSyllabus(snapshot.id, {
          expectedRevision: snapshot.revision,
          content: snapshot.content,
          courseTitle: snapshot.courseTitle,
          courseCode: snapshot.courseCode,
          academicYear: snapshot.academicYear,
        });
        if (id === requestId.current) {
          if (draftRef.current === snapshot) {
            draftRef.current = saved;
            setDraft(saved);
            setDirty(false);
          } else {
            // Keep a later local edit, but rebase it on the revision we just
            // saved. The effect will then persist it in a separate request.
            setDraft((current) => {
              const rebased = { ...current, revision: saved.revision, updatedAt: saved.updatedAt };
              draftRef.current = rebased;
              return rebased;
            });
          }
          setSaveState("saved");
          saveConflict.current = false;
          onSaved(saved);
        }
      } catch (error) {
        if (id === requestId.current) {
          const failure = saveFailureState(error);
          saveConflict.current = failure === "conflict";
          setSaveState(failure);
          setSaveError(error instanceof Error ? error.message : "Save failed. Please try again.");
        }
      } finally {
        saveInFlight.current = false;
      }
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
      const lineHeight =
        Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 24;
      const minimumHeight =
        lineHeight * Number(textarea.getAttribute("rows") || 3);
      textarea.style.height = `${Math.max(textarea.scrollHeight, minimumHeight)}px`;
    };
    const resizeAll = () =>
      editor
        .querySelectorAll<HTMLTextAreaElement>("textarea")
        .forEach(adjustHeight);
    const handleInput = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement)
        adjustHeight(event.target);
    };
    resizeAll();
    editor.addEventListener("input", handleInput);
    return () => editor.removeEventListener("input", handleInput);
  }, [draft, active]);

  function edit(updater: (current: Syllabus) => Syllabus) {
    setDraft((current) => {
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
    setDirty(true);
    if (saveState === "error") {
      setSaveState("saved");
      setSaveError(null);
    }
  }
  async function reloadLatestSyllabus() {
    try {
      const latest = await getSyllabus(draft.id);
      draftRef.current = latest;
      setDraft(latest);
      setDirty(false);
      setSaveState("saved");
      setSaveError(null);
      saveConflict.current = false;
      setReloadConfirmationOpen(false);
      onSaved(latest);
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Could not reload the latest syllabus.");
    }
  }
  function editContent(section: string, value: unknown) {
    edit((current) => ({
      ...current,
      content: { ...current.content, [section]: value },
    }));
  }
  function editMetadata(
    field: "courseTitle" | "courseCode" | "academicYear",
    value: string,
  ) {
    edit((current) => ({ ...current, [field]: value }));
  }
  async function exportDocx() {
    setExportState("exporting");
    try {
      let saved = draft;
      if (dirty) {
        const id = ++requestId.current;
        setSaveState("saving");
        saved = await updateSyllabus(draft.id, {
          expectedRevision: draft.revision,
          content: draft.content,
          courseTitle: draft.courseTitle,
          courseCode: draft.courseCode,
          academicYear: draft.academicYear,
        });
        if (id === requestId.current) {
          setDraft(saved);
          setDirty(false);
          setSaveState("saved");
          onSaved(saved);
        }
      }
      await downloadSyllabusExport(saved.id);
      setExportState("idle");
    } catch {
      setExportState("error");
    }
  }

  return (
    <FieldHistoryProvider
      enabled
      source={{
        resourceType: "syllabus",
        resourceId: draft.id,
        revision: draft.revision,
        loadHistory: (fieldPath) => getFieldHistory(draft.id, fieldPath),
      }}
    >
      <SectionEditorShell
        containerRef={editorRef}
        backLabel="Back to syllabus library"
        onBack={onBack}
        eyebrow={draft.academicYear}
        title={draft.courseTitle}
        subtitle={draft.courseCode || "Course code not set"}
        titleMeta={
          <a
            href={syllabusTemplateDocumentUrl(template)}
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[#1f4e79] hover:underline"
          >
            <FileText size={15} aria-hidden="true" /> {template.name}
          </a>
        }
        sections={template.sections}
        activeSection={active}
        onSectionChange={setActive}
        onHeaderCollapseChange={onHeaderCollapseChange}
        compactHeaderActions={compactHeaderActions}
        actions={
          <>
            <SaveStatus
              state={saveState}
              error={saveError}
              onReload={() => setReloadConfirmationOpen(true)}
            />
            <button
              type="button"
              onClick={() => void exportDocx()}
              disabled={exportState === "exporting"}
              className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:cursor-wait disabled:opacity-60"
            >
              <>
                {exportState === "exporting" ? (
                  <Loader2 className="animate-spin" size={17} />
                ) : (
                  <Download size={17} />
                )}
              </>{" "}
              {exportState === "exporting" ? "Preparing DOCX" : "Export DOCX"}
            </button>
            <button
              type="button"
              onClick={onCompare}
              className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
            >
              <GitCompareArrows size={17} /> Compare years
            </button>
            {exportState === "error" ? (
              <span role="alert" className="text-sm font-medium text-[#a6292f]">
                Export failed — please try again.
              </span>
            ) : null}
          </>
        }
      >
        <SectionForm
          active={active}
          draft={draft}
          editContent={editContent}
          editMetadata={editMetadata}
          onOpenHistory={setHistoryField}
        />
        <FieldHistorySidebar
          field={historyField}
          onClose={() => setHistoryField(null)}
        />
        <ConfirmDialog
          open={reloadConfirmationOpen}
          title="Reload the latest syllabus?"
          description="This will replace the unsaved changes in this browser with the latest saved version. Copy anything you need to keep before continuing."
          confirmLabel="Reload latest version"
          onConfirm={() => void reloadLatestSyllabus()}
          onClose={() => setReloadConfirmationOpen(false)}
        />
      </SectionEditorShell>
    </FieldHistoryProvider>
  );
}

export function SaveStatus({
  state,
  error,
  onReload,
}: {
  state: SyllabusSaveState;
  error?: string | null;
  onReload?: () => void;
}) {
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-2 text-sm text-[#667085]">
        <Loader2 className="animate-spin" size={16} /> Saving
      </span>
    );
  if (state === "conflict")
    return (
      <span role="alert" className="inline-flex items-center gap-2 text-sm text-[#a6292f]">
        <TriangleAlert size={16} /> This syllabus was updated in another tab.
        {onReload ? <button type="button" onClick={onReload} className="font-semibold underline underline-offset-2">Reload latest version</button> : null}
      </span>
    );
  if (state === "error")
    return (
      <span role="alert" className="inline-flex items-center gap-2 text-sm text-[#a6292f]" title={error ?? undefined}>
        <TriangleAlert size={16} /> {error || "Save failed. Your changes are still on this page."}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[#24805a]">
      <CheckCircle2 size={16} /> Saved
    </span>
  );
}

function SectionForm({
  active,
  draft,
  editContent,
  editMetadata,
  onOpenHistory,
}: {
  active: string;
  draft: Syllabus;
  editContent: (section: string, value: unknown) => void;
  editMetadata: (
    field: "courseTitle" | "courseCode" | "academicYear",
    value: string,
  ) => void;
  onOpenHistory: (field: HistoryField) => void;
}) {
  const content = draft.content as Record<string, unknown>;
  const people = useQuery({ queryKey: ["syllabus-catalogues", "people", "editor"], queryFn: () => listCatalogueEntries("people", { includeRetired: true }) });
  const programmes = useQuery({ queryKey: ["syllabus-catalogues", "programmes", "editor"], queryFn: () => listCatalogueEntries("programmes") });
  const identification = sectionFrom(content.identification);
  const catalogueProgrammeId = stringify(identification.cataloguePloProgrammeId || identification.catalogueProgrammeId);
  const cataloguePlos = useQuery({ queryKey: ["syllabus-catalogues", "plos", catalogueProgrammeId], queryFn: () => listCatalogueEntries("plos", { parentId: catalogueProgrammeId, includeRetired: true }), enabled: Boolean(catalogueProgrammeId) });
  const teachingPresets = useQuery({ queryKey: ["syllabus-catalogues", "teaching-presets", "editor"], queryFn: () => listCatalogueEntries("teaching-presets") });
  const assessmentTypes = useQuery({ queryKey: ["syllabus-catalogues", "assessment-types", "editor"], queryFn: () => listCatalogueEntries("assessment-types") });
  const section = (
    Array.isArray(content[active]) ? {} : (content[active] ?? {})
  ) as Record<string, unknown>;
  const history = (label: string) => ({
    syllabusId: draft.id,
    revision: draft.revision,
    field: { path: fieldPath(active, label), label },
    onOpenSidebar: onOpenHistory,
  });
  const text = (
    label: string,
    value: unknown,
    onChange: (value: string) => void,
    multiline = false,
  ) => (
    <Field
      label={label}
      value={stringify(value)}
      onChange={onChange}
      multiline={multiline}
      isDate={isDateField(active, label)}
      history={history(label)}
    />
  );
  const numeric = (
    label: string,
    value: unknown,
    onChange: (value: string) => void,
    options: {
      min?: number;
      max?: number;
      step?: number;
      invalid?: boolean;
    } = {},
  ) => (
    <Field
      label={label}
      value={stringify(value)}
      onChange={onChange}
      inputType="number"
      min={options.min}
      max={options.max}
      step={options.step}
      invalid={options.invalid}
      history={history(label)}
    />
  );
  if (draft.templateId === "fys-2025-26") {
    const save = (next: Record<string, unknown>) => editContent(active, next);
    if (active === "courseDetails") return <Section title="Course details">{text("Foundation Year in", section.foundationYear, (foundationYear) => save({ ...section, foundationYear }))}{text("Semester", section.semester, (semester) => save({ ...section, semester }))}{text("Weight of the course in the semester’s grade", section.courseWeight, (courseWeight) => save({ ...section, courseWeight }))}{numeric("Course contact hours", section.totalContactHours, (totalContactHours) => save({ ...section, totalContactHours }))}{text("Prerequisites and co-requisites", section.prerequisites, (prerequisites) => save({ ...section, prerequisites }), true)}</Section>;
    if (active === "facultyDetails") return <Section title="Faculty details"><FysFacultyDirectoryPicker value={section} people={people.data ?? []} onChange={save} />{!stringify(section.personId) ? <>{text("Name and status", section.staffText, (staffText) => save({ ...section, staffText }), true)}{text("Institution", section.institution, (institution) => save({ ...section, institution }))}{text("Office hours", section.officeHours, (officeHours) => save({ ...section, officeHours }), true)}{text("Office phone", section.officePhone, (officePhone) => save({ ...section, officePhone }))}{text("Email", section.email, (email) => save({ ...section, email }), true)}</> : null}</Section>;
    if (active === "description") return <Section title="Course description">{text("Course description", section.overview, (overview) => save({ overview }), true)}</Section>;
    if (active === "learningOutcomes") return <Section title="Course learning outcomes"><p className="text-sm text-[#667085]">Enter one CLO per line.</p>{text("Course learning outcomes", section.closText, (closText) => save({ ...section, closText }), true)}</Section>;
    if (active === "requiredMaterials") return <Section title="Required materials"><BibliographyEditor value={section} onChange={save} syllabusId={draft.id} revision={draft.revision} onOpenHistory={onOpenHistory} />{text("Course textbooks and recommended reading", section.textbooks, (textbooks) => save({ ...section, textbooks }), true)}{text("Supplemental resources", section.supplementalResources, (supplementalResources) => save({ ...section, supplementalResources }), true)}{text("Equipment students may require", section.equipment, (equipment) => save({ ...section, equipment }), true)}</Section>;
    if (active === "teachingMethodologies") return <Section title="Teaching methodologies">{text("Teaching methods and hours", section.notes, (notes) => save({ ...section, notes }), true)}</Section>;
    if (active === "assessment") return <Section title="Course assessment">{text("Continuous assessment", section.continuousText, (continuousText) => save({ ...section, continuousText }), true)}{text("Final assessment", section.finalText, (finalText) => save({ ...section, finalText }), true)}{text("Laboratory assessment", section.laboratoryText, (laboratoryText) => save({ ...section, laboratoryText }), true)}</Section>;
    if (active === "schedule") return <Section title="Teaching schedule">{text("Week, session, topic, and assessment details", section.scheduleText, (scheduleText) => editContent(active, { scheduleText }), true)}</Section>;
  }
  if (active === "identification")
    return (
      <CourseIdentificationEditor
        value={section}
        courseTitle={draft.courseTitle}
        courseCode={draft.courseCode}
        academicYear={draft.academicYear}
        onChange={(identification) => editContent(active, identification)}
        onMetadataChange={editMetadata}
        syllabusId={draft.id}
        revision={draft.revision}
        onOpenHistory={onOpenHistory}
        programmes={(programmes.data ?? []).map((programme) => ({ value: programme.id, label: programme.label }))}
      />
    );
  if (active === "contacts")
    return (
      <AcademicContactsEditor
        value={section}
        onChange={(contacts) => editContent(active, contacts)}
        syllabusId={draft.id}
        revision={draft.revision}
        onOpenHistory={onOpenHistory}
        people={people.data ?? []}
      />
    );
  if (active === "description")
    return (
      <Section title="Course description">
        {text(
          "Course description",
          section.overview,
          (value) => editContent(active, { overview: value }),
          true,
        )}
      </Section>
    );
  if (active === "delivery") {
    const faceToFace = stringify(section.faceToFacePercent);
    const online = stringify(section.onlinePercent);
    const percentageError = deliveryPercentageError(faceToFace, online);
    return (
      <div className="grid gap-4">
        <SyllabusSubsection title="Delivery mode"><SelectField
          label="Delivery mode"
          value={stringify(section.mode)}
          onChange={(value) => editContent(active, { ...section, mode: value })}
          history={history("Delivery mode")}
          options={["Face-to-Face Delivery", "Blended Learning Delivery"]}
          placeholder="Select delivery mode"
        /></SyllabusSubsection>
        <SyllabusSubsection title="Delivery allocation">
        {numeric(
          "Face-to-face (%)",
          faceToFace,
          (value) =>
            editContent(active, { ...section, faceToFacePercent: value }),
          { min: 0, max: 100, step: 1, invalid: Boolean(percentageError) },
        )}
        {numeric(
          "Online (%)",
          online,
          (value) => editContent(active, { ...section, onlinePercent: value }),
          { min: 0, max: 100, step: 1, invalid: Boolean(percentageError) },
        )}
        {percentageError ? (
          <p role="alert" className="text-sm font-medium text-[#a6292f]">
            {percentageError}
          </p>
        ) : null}
        </SyllabusSubsection>
      </div>
    );
  }
  if (active === "learningOutcomes")
    return (
      <LearningOutcomesEditor
        section={section}
        onChange={(next) => editContent(active, next)}
        syllabusId={draft.id}
        revision={draft.revision}
        onOpenHistory={onOpenHistory}
        cataloguePlos={cataloguePlos.data ?? []}
        catalogueProgrammeId={catalogueProgrammeId}
      />
    );
  if (active === "schedule") {
    const sessions = ((content.schedule as Row[]) ?? []).map((session) =>
      session.preClass === undefined && session.activities
        ? { ...session, preClass: session.activities }
        : session,
    );
    return (
      <Section title="Course schedule">
        <ScheduleEditor
          rows={sessions}
          onChange={(schedule) => editContent(active, schedule)}
          syllabusId={draft.id}
          revision={draft.revision}
          onOpenHistory={onOpenHistory}
        />
      </Section>
    );
  }
  if (active === "bibliography")
    return (
      <Section title="Supplemental bibliographical resources">
        <BibliographyEditor
          value={section}
          onChange={(bibliography) => editContent(active, bibliography)}
          syllabusId={draft.id}
          revision={draft.revision}
          onOpenHistory={onOpenHistory}
        />
      </Section>
    );
  if (active === "teachingApproach")
    return (
      <div className="grid gap-4">
        <TeachingPresetPicker value={section} presets={teachingPresets.data ?? []} onApply={(next) => editContent(active, next)} />
        <SyllabusSubsection title="Teaching methods and learning activities">{text(
          "Teaching methods and learning activities",
          section.methods,
          (value) => editContent(active, { ...section, methods: value }),
          true,
        )}</SyllabusSubsection>
        <SyllabusSubsection title="Student engagement">{text(
          "Student engagement",
          section.engagement,
          (value) => editContent(active, { ...section, engagement: value }),
          true,
        )}</SyllabusSubsection>
        <SyllabusSubsection title="Feedback and academic progress">{text(
          "Feedback and academic progress",
          section.feedback,
          (value) => editContent(active, { ...section, feedback: value }),
          true,
        )}</SyllabusSubsection>
      </div>
    );
  if (active === "assessment")
    return (
      <div className="grid gap-4">
        <SyllabusSubsection title="Course assessment">
        <AssessmentTabs
          value={section}
          outcomes={(sectionFrom(content.learningOutcomes).clos as Row[]) ?? []}
          onChange={(assessment) => editContent(active, assessment)}
          syllabusId={draft.id}
          revision={draft.revision}
          onOpenHistory={onOpenHistory}
          assessmentTypes={assessmentTypes.data ?? []}
        />
        </SyllabusSubsection>
        <LockedSection
          title="University table of grade equivalence"
          text={GRADE_EQUIVALENCE_TEXT}
        />
      </div>
    );
  return (
    <div className="grid gap-4">
      <SyllabusSubsection title="Document details">
      {text("Document creation date", section.creationDate, (value) =>
        editContent(active, { ...section, creationDate: value }),
      )}
      {text("Department name", section.departmentName, (value) =>
        editContent(active, { ...section, departmentName: value }),
      )}
      {text("Version number", section.versionNumber, (value) =>
        editContent(active, { ...section, versionNumber: value }),
      )}
      </SyllabusSubsection>
      <SyllabusSubsection title="Approval">
      {text("Syllabus approval date", section.approvalDate, (value) =>
        editContent(active, { ...section, approvalDate: value }),
      )}
      {text("Name and status of approver", section.approver, (value) =>
        editContent(active, { ...section, approver: value }),
      )}
      </SyllabusSubsection>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <SyllabusSubsection title={title}>{children}</SyllabusSubsection>
  );
}

function TeachingPresetPicker({ value, presets, onApply }: { value: Record<string, unknown>; presets: CatalogueEntry[]; onApply: (value: Record<string, unknown>) => void }) {
  const [selected, setSelected] = useState<string[]>(Array.isArray(value.teachingPresetIds) ? value.teachingPresetIds.filter((item): item is string => typeof item === "string") : []);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const chosen = presets.filter((preset) => selected.includes(preset.id));
  const compiled = (key: "methods" | "engagement" | "feedback") => chosen.map((preset) => stringify(preset.payload[key]).trim()).filter(Boolean).join("\n\n");
  const apply = () => { onApply({ ...value, teachingPresetIds: selected, methods: compiled("methods"), engagement: compiled("engagement"), feedback: compiled("feedback") }); setConfirmApply(false); };
  const hasExistingContent = [value.methods, value.engagement, value.feedback].some((item) => stringify(item).trim());
  if (!presets.length) return null;
  return <section className="rounded-md border border-[#d9dee7] bg-[#f8fafc] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h4 className="text-sm font-semibold text-[#344054]">Teaching approach presets</h4><p className="mt-1 text-sm text-[#667085]">Select one or more approved approaches, review the combined text, then apply it deliberately.</p></div><button type="button" onClick={() => setShowPreview((current) => !current)} className="w-fit rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79]">{showPreview ? "Hide preview" : "Preview"}</button></div><div className="mt-3 grid gap-2">{presets.map((preset) => <label key={preset.id} className="flex items-start gap-2 rounded-md bg-white px-3 py-2 text-sm text-[#344054]"><input type="checkbox" checked={selected.includes(preset.id)} onChange={() => setSelected((current) => current.includes(preset.id) ? current.filter((id) => id !== preset.id) : [...current, preset.id])} /><span>{preset.label}</span></label>)}</div>{showPreview ? <div className="mt-4 rounded-md border border-[#d9dee7] bg-white p-4"><p className="text-sm font-semibold text-[#344054]">Combined preview</p>{(["methods", "engagement", "feedback"] as const).map((key) => <div key={key} className="mt-3"><p className="text-sm font-semibold capitalize text-[#475467]">{key === "methods" ? "Teaching methods" : key === "engagement" ? "Student engagement" : "Feedback and academic progress"}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#667085]">{compiled(key) || "No text is supplied by the selected presets."}</p></div>)}<button type="button" disabled={!chosen.length} onClick={() => hasExistingContent ? setConfirmApply(true) : apply()} className="mt-4 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">Apply to this syllabus</button></div> : null}<ConfirmDialog open={confirmApply} title="Replace teaching-approach text?" description="Applying this preview will replace the three existing teaching-approach fields. Your current text will not be changed unless you confirm." confirmLabel="Replace and apply" onConfirm={apply} onClose={() => setConfirmApply(false)} /></section>;
}

function FysFacultyDirectoryPicker({ value, people, onChange }: { value: Record<string, unknown>; people: CatalogueEntry[]; onChange: (value: Record<string, unknown>) => void }) {
  const personId = stringify(value.personId);
  const selected = people.find((person) => person.id === personId);
  const options = people.filter((person) => Array.isArray(person.payload.roles) && person.payload.roles.includes("instructor")).map((person) => ({ value: person.id, label: person.label }));
  if (!options.length) return null;
  return <div className="grid gap-3"><label className="grid gap-1 text-sm font-medium text-[#344054]"><span>Faculty member from People directory <span className="font-normal text-[#667085]">(optional)</span></span><SelectMenu label="Faculty member from People directory" value={personId} onChange={(nextId) => onChange({ ...value, personId: nextId || undefined })} placeholder="Enter faculty details manually" searchable options={[{ value: "", label: "Enter faculty details manually" }, ...options]} /></label>{selected ? <div className="rounded-md border border-[#d9dee7] bg-[#f8fafc] p-4 text-sm text-[#475467]"><p className="font-semibold text-[#344054]">{selected.label}</p><p className="mt-1">{[stringify(selected.payload.academicRank), stringify(selected.payload.affiliations), stringify(selected.payload.officeHours), stringify(selected.payload.email)].filter(Boolean).join(" · ") || "Directory details will appear in exports."}</p><p className="mt-2 text-xs text-[#667085]">Live directory details are read-only in the syllabus.</p></div> : null}</div>;
}
function LearningOutcomesEditor({
  section,
  onChange,
  syllabusId,
  revision,
  onOpenHistory,
  cataloguePlos,
  catalogueProgrammeId,
}: {
  section: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
  cataloguePlos: CatalogueEntry[];
  catalogueProgrammeId: string;
}) {
  const [tab, setTab] = useState<"plos" | "clos">("plos");
  const tabs = [
    { key: "plos" as const, label: "Programme learning outcomes" },
    { key: "clos" as const, label: "Course learning outcomes" },
  ];
  const localPloOptions = ploEntries(section.plos).map((plo, index) => {
    const label = ploDisplayLabel(plo, index);
    return { value: label, label };
  });
  const cataloguePloOptions = cataloguePlos.map((plo) => {
    const code = stringify(plo.payload.code) || plo.label;
    const outcome = stringify(plo.payload.outcome);
    const label = outcome ? `${code}: ${outcome}` : code;
    return { value: label, label, catalogueId: plo.id };
  });
  const catalogueMode = Boolean(catalogueProgrammeId);
  return (
    <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5">
      <h3 className="text-lg font-semibold text-[#171717]">
        Learning outcomes
      </h3>
      <div
        role="tablist"
        aria-label="Learning outcomes editor"
        className="mt-5 flex gap-1 border-b border-[#d9dee7]"
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === item.key ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-5 min-w-0">
        {tab === "plos" ? (
          catalogueMode ? <CataloguePloList entries={cataloguePlos} /> : <PloEditor
            value={section.plos}
            onChange={(plos) => onChange({ ...section, plos })}
            syllabusId={syllabusId}
            revision={revision}
            onOpenHistory={onOpenHistory}
          />
        ) : (
          <RowsEditor
            title="Course learning outcomes and alignment"
            columns={[
              ["clo", "Course learning outcome"],
              ["plo", "Aligned PLOs"],
              ["skills", "Graduate skills"],
            ]}
            rows={(section.clos as Row[]) ?? []}
            onChange={(clos) => onChange({ ...section, clos })}
            selectOptions={{ plo: catalogueMode ? cataloguePloOptions : localPloOptions }}
            onPloChange={catalogueMode ? (row, labels) => ({ ...row, plo: labels, ploIds: labels.split("\n").map((label) => cataloguePloOptions.find((option) => option.value === label)?.catalogueId).filter(Boolean).join("\n") }) : undefined}
            addLabel="Add outcome"
            historyPath="learningOutcomes.clos"
            syllabusId={syllabusId}
            revision={revision}
            onOpenHistory={onOpenHistory}
          />
        )}
      </div>
    </section>
  );
}

function CataloguePloList({ entries }: { entries: CatalogueEntry[] }) {
  if (!entries.length) return <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">This programme has no approved PLOs yet. Manage them in the catalogue workspace.</p>;
  return <section><p className="mb-3 text-sm text-[#667085]">Approved PLOs are managed centrally and are read-only here. Choose one or more of them when aligning a CLO.</p><div className="grid gap-3">{entries.map((entry) => <article key={entry.id} className="rounded-lg border border-[#d9dee7] bg-[#f8fafc] p-4"><p className="text-sm font-semibold text-[#344054]">{stringify(entry.payload.code) || entry.label}</p><p className="mt-1 text-sm leading-6 text-[#475467]">{stringify(entry.payload.outcome)}</p></article>)}</div></section>;
}
function Field({
  label,
  value,
  onChange,
  multiline,
  isDate,
  inputType = "text",
  min,
  max,
  step,
  invalid,
  history,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  isDate?: boolean;
  inputType?: "text" | "number";
  min?: number;
  max?: number;
  step?: number;
  invalid?: boolean;
  history: {
    syllabusId: string;
    revision: number;
    field: HistoryField;
    onOpenSidebar: (field: HistoryField) => void;
  };
}) {
  if (isDate)
    return (
      <DateField
        label={label}
        value={dateInputValue(value)}
        onChange={onChange}
        trailing={<FieldHistoryControl {...history} placement="center" />}
      />
    );
  return (
    <HistoryTextField
      label={label}
      value={value}
      onChange={onChange}
      multiline={multiline}
      minRows={4}
      type={inputType}
      min={min}
      max={max}
      step={step}
      invalid={invalid}
      history={{ field: history.field, onOpenHistory: history.onOpenSidebar }}
    />
  );
}
function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  history,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  history: {
    syllabusId: string;
    revision: number;
    field: HistoryField;
    onOpenSidebar: (field: HistoryField) => void;
  };
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#344054]">
      {label}
      <SelectMenu
        label={label}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        options={options.map((option) => ({ value: option, label: option }))}
        trailing={<FieldHistoryControl {...history} />}
      />
    </label>
  );
}
function LockedSection({ title, text }: { title: string; text: string }) {
  return (
    <SyllabusSubsection title={title}>
      <div className="rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-4 text-sm leading-6 text-[#475467]">
        <p className="mb-2 font-semibold text-[#344054]">
          University standard text
        </p>
        {text}
      </div>
    </SyllabusSubsection>
  );
}
function RowsEditor({
  title,
  columns,
  rows,
  onChange,
  selectOptions,
  addLabel = "Add row",
  historyPath,
  syllabusId,
  revision,
  onOpenHistory,
  onPloChange,
}: {
  title: string;
  columns: string[][];
  rows: Row[];
  onChange: (rows: Row[]) => void;
  selectOptions?: Record<string, Array<{ value: string; label: string }>>;
  addLabel?: string;
  historyPath: string;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
  onPloChange?: (row: Row, labels: string) => Row;
}) {
  const normalized = Array.isArray(rows) ? rows : [];
  const [movingRowId, setMovingRowId] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");
  const [expandedRowIds, setExpandedRowIds] = useState<string[]>([]);
  useEffect(() => {
    if (!movingRowId) return;
    const closeWhenClickingAway = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-move-menu]")
      ) {
        setMovingRowId(null);
        setMoveQuery("");
      }
    };
    document.addEventListener("pointerdown", closeWhenClickingAway);
    return () =>
      document.removeEventListener("pointerdown", closeWhenClickingAway);
  }, [movingRowId]);
  const moveRowBefore = (sourceId: string, destinationId?: string) => {
    const source = normalized.find((row) => row.id === sourceId);
    if (!source) return;
    const withoutSource = normalized.filter((row) => row.id !== sourceId);
    const destinationIndex = destinationId
      ? withoutSource.findIndex((row) => row.id === destinationId)
      : withoutSource.length;
    onChange([
      ...withoutSource.slice(0, destinationIndex),
      source,
      ...withoutSource.slice(destinationIndex),
    ]);
    setMovingRowId(null);
    setMoveQuery("");
  };
  const addRow = () => {
    const id = crypto.randomUUID();
    onChange([...normalized, { id }]);
    setExpandedRowIds((current) => [...current, id]);
    window.requestAnimationFrame(() =>
      document
        .getElementById(`row-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  const outcomeRows = columns.some(([key]) => key === "clo");
  return (
    <section className="mt-2">
      <h4 className="mb-3 text-sm font-semibold text-[#344054]">{title}</h4>
      <div className="grid gap-4">
        {normalized.map((row, index) => {
          const destinations = normalized.filter(
            (item) =>
              item.id !== row.id &&
              rowIdentity(item, columns)
                .toLowerCase()
                .includes(moveQuery.toLowerCase()),
          );
          const isExpanded = !outcomeRows || expandedRowIds.includes(row.id);
          const updateRow = (key: string, value: string) =>
            onChange(
              normalized.map((item, itemIndex) =>
                itemIndex === index ? key === "plo" && onPloChange ? onPloChange(item, value) : { ...item, [key]: value } : item,
              ),
            );
          return (
            <fieldset
              id={`row-${row.id}`}
              key={row.id}
              className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4"
            >
              <div className="relative flex items-start justify-between gap-3">
                {outcomeRows ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRowIds((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  >
                    <ChevronDown
                      size={17}
                      className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[#344054]">
                        CLO {index + 1}
                      </span>
                      <span className="mt-0.5 block text-sm text-[#475467]">
                        {outcomeSummary(row.clo, index) || "Untitled outcome"}
                      </span>
                    </span>
                  </button>
                ) : (
                  <p className="min-w-0 flex-1 break-words text-sm font-semibold text-[#344054]">
                    {rowIdentity(row, columns)}
                  </p>
                )}
                <div
                  data-move-menu
                  className="flex shrink-0 items-center gap-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMovingRowId(row.id);
                      setMoveQuery("");
                    }}
                    className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]"
                    aria-label={`Move ${rowIdentity(row, columns)}`}
                    title="Move row"
                  >
                    <ArrowDownUp size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        normalized.filter(
                          (_, itemIndex) => itemIndex !== index,
                        ),
                      )
                    }
                    className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]"
                    aria-label={`Remove ${rowIdentity(row, columns)}`}
                    title="Remove row"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
                {movingRowId === row.id ? (
                  <div
                    data-move-menu
                    className="absolute right-0 top-full z-[90] isolate mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg"
                  >
                    <p className="text-sm font-semibold text-[#344054]">
                      Place this row before
                    </p>
                    <input
                      type="search"
                      value={moveQuery}
                      onChange={(event) => setMoveQuery(event.target.value)}
                      placeholder="Search destination rows"
                      className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
                      autoFocus
                    />
                    <div className="mt-2 max-h-56 overflow-y-auto">
                      {destinations.map((destination, destinationIndex) => (
                        <button
                          type="button"
                          key={destination.id}
                          onClick={() => moveRowBefore(row.id, destination.id)}
                          className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"
                        >
                          <span className="text-[#667085]">
                            {destinationIndex + 1}.{" "}
                          </span>
                          {rowIdentity(destination, columns)}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => moveRowBefore(row.id)}
                      className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                    >
                      Move to end
                    </button>
                  </div>
                ) : null}
              </div>
              {isExpanded ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {columns.map(([key, label]) => {
                    const field = {
                      path: `${historyPath}[${row.id}].${key}`,
                      label: `${title} · ${label}`,
                    };
                    const value = row[key] ?? "";
                    const multiline = shouldUseMultiline(key, value);
                    const useDatePicker = shouldUseDatePicker(key, value);
                    const options = selectOptions?.[key];
                    const availableOptions =
                      options &&
                      value &&
                      !options.some((option) => option.value === value)
                        ? [{ value, label: value }, ...options]
                        : options;
                    const historyControl = (
                      <FieldHistoryControl
                        syllabusId={syllabusId}
                        revision={revision}
                        field={field}
                        onOpenSidebar={onOpenHistory}
                        placement={multiline ? "top" : "center"}
                      />
                    );
                    if (useDatePicker) {
                      return (
                        <div
                          key={key}
                          className={multiline ? "lg:col-span-2" : ""}
                        >
                          <DateField
                            label={label}
                            value={dateInputValue(value)}
                            onChange={(next) => updateRow(key, next)}
                            trailing={historyControl}
                          />
                        </div>
                      );
                    }
                    if (key === "plo" && options) {
                      return (
                        <PloAlignmentField
                          key={key}
                          label={label}
                          pickerLabel={`Add aligned PLO to CLO ${index + 1}`}
                          value={value}
                          onChange={(next) => updateRow(key, next)}
                          options={options}
                          history={(
                            <FieldHistoryControl
                              syllabusId={syllabusId}
                              revision={revision}
                              field={field}
                              onOpenSidebar={onOpenHistory}
                              placement="label"
                            />
                          )}
                        />
                      );
                    }
                    return availableOptions ? (
                      <label
                        key={key}
                        className={`grid gap-1 text-sm font-medium text-[#344054] ${multiline ? "lg:col-span-2" : ""}`}
                      >
                        {label}
                        <SelectMenu
                          label={label}
                          value={value}
                          onChange={(next) => updateRow(key, next)}
                          placeholder="Select a programme learning outcome"
                          options={availableOptions}
                          trailing={historyControl}
                        />
                      </label>
                    ) : (
                      <HistoryTextField
                        key={key}
                        label={label}
                        value={value}
                        onChange={(next) => updateRow(key, next)}
                        multiline={multiline}
                        minRows={3}
                        className={multiline ? "lg:col-span-2" : ""}
                        history={{ field, onOpenHistory }}
                      />
                    );
                  })}
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      {normalized.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">
          No rows added yet.
        </p>
      ) : null}
      <AddEntryButton onClick={addRow} label={addLabel} />
    </section>
  );
}

export function PloAlignmentField({
  label,
  pickerLabel,
  value,
  onChange,
  options,
  history,
}: {
  label: string;
  pickerLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  history?: ReactNode;
}) {
  const selectedValues = Array.from(
    new Set(
      value
        .split("\n")
        .filter(Boolean)
        .map((selectedValue) => findMatchingPloOption(selectedValue, options)?.value ?? selectedValue),
    ),
  );
  const selected = selectedValues.map(
    (selectedValue) =>
      options.find((option) => option.value === selectedValue) ?? {
        value: selectedValue,
        label: selectedValue,
      },
  );
  const availableOptions = options.filter((option) => !selectedValues.includes(option.value));

  const add = (selectedValue: string) => onChange([...selectedValues, selectedValue].join("\n"));
  const remove = (selectedValue: string) => onChange(selectedValues.filter((value) => value !== selectedValue).join("\n"));

  return (
    <div role="group" aria-label={label} className="relative grid gap-2">
      <div className="min-h-5 pr-8 text-sm font-medium text-[#344054]">{label}</div>
      {history}
      {selected.length ? (
        <ul aria-label={`Selected ${label}`} className="grid gap-2">
          {selected.map((option) => (
            <li key={option.value} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm text-[#344054]">
              <span className="min-w-0 truncate">{option.label}</span>
              <button type="button" onClick={() => remove(option.value)} className="shrink-0 rounded p-1 text-[#667085] hover:bg-[#e8edf3] hover:text-[#a6292f]" aria-label={`Remove ${option.label} from ${label}`}>
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-2 text-sm text-[#667085]">No PLOs aligned yet.</p>
      )}
      <SelectMenu
        label={pickerLabel}
        value=""
        onChange={add}
        placeholder="Add aligned PLO"
        options={availableOptions}
        disabled={availableOptions.length === 0}
      />
    </div>
  );
}

function findMatchingPloOption(value: string, options: SelectOption[]) {
  const exact = options.find((option) => option.value === value);
  if (exact) return exact;

  const identity = getPloIdentity(value);
  return identity
    ? options.find((option) => getPloIdentity(option.value) === identity)
    : undefined;
}

function getPloIdentity(value: string) {
  const match = value.match(/^PLO\s*(\d+)\b/i);
  return match ? `PLO ${match[1]}` : undefined;
}

function shouldUseMultiline(key: string, value: string) {
  return (
    value.length > 90 ||
    [
      "activities",
      "preClass",
      "assessments",
      "clos",
      "skills",
      "criteria",
      "meets",
      "exceeds",
    ].includes(key)
  );
}
function rowIdentity(row: Row, columns: string[][]) {
  const preferredKeys = [
    "session",
    "topic",
    "clo",
    "type",
    "assignment",
    "date",
  ];
  return (
    preferredKeys.map((key) => row[key]).find((item) => item?.trim()) ??
    columns.map(([key]) => row[key]).find((item) => item?.trim()) ??
    "Untitled row"
  );
}
function outcomeSummary(value: string | undefined, index: number) {
  return (value ?? "").replace(
    new RegExp(`^CLO\\s*${index + 1}\\s*[:.]?\\s*`, "i"),
    "",
  );
}
function shouldUseDatePicker(key: string, value: string) {
  return key === "date" && (value === "" || dateInputValue(value) !== "");
}
function fieldPath(active: string, label: string) {
  const fieldNames: Record<string, Record<string, string>> = {
    identification: {
      "Course title": "metadata.courseTitle",
      "Course code": "metadata.courseCode",
      "Academic year": "metadata.academicYear",
      "Degree level and semester": "identification.degreeLevelAndSemester",
      "Programme title": "identification.programmeTitle",
      "Number of ECTS": "identification.ects",
      "Prerequisites and co-requisites": "identification.prerequisites",
      Equipment: "identification.equipment",
    },
    description: { "Course description": "description.overview" },
    delivery: {
      "Delivery mode": "delivery.mode",
      "Face-to-face (%)": "delivery.faceToFacePercent",
      "Online (%)": "delivery.onlinePercent",
    },
    learningOutcomes: {
      "Programme learning outcomes (one per line)": "learningOutcomes.plos",
    },
    bibliography: {
      Books: "bibliography.books",
      Websites: "bibliography.websites",
      "Journal articles": "bibliography.journalArticles",
    },
    teachingApproach: {
      "Teaching methods and learning activities": "teachingApproach.methods",
      "Student engagement": "teachingApproach.engagement",
      "Feedback and academic progress": "teachingApproach.feedback",
    },
    assessment: {
      "AI policy": "assessment.aiPolicy",
      "Additional instructions regarding AI": "assessment.aiInstructions",
      "Assessment methodologies": "assessment.methodologies",
      "Late submission policy": "assessment.lateSubmissionPolicy",
    },
    documentControl: {
      "Document creation date": "documentControl.creationDate",
      "Department name": "documentControl.departmentName",
      "Syllabus approval date": "documentControl.approvalDate",
      "Version number": "documentControl.versionNumber",
      "Name and status of approver": "documentControl.approver",
    },
  };
  if (
    active === "identification" &&
    [
      "Lectures",
      "Tutorials",
      "Workshops",
      "Seminars",
      "Laboratory",
      "Other",
    ].includes(label)
  )
    return `identification.contactHours.${label}`;
  if (active === "contacts") {
    if (label === "Academic coordinator name")
      return "contacts.administrativeContact.name";
    if (label === "Academic coordinator contact details")
      return "contacts.administrativeContact.contactDetails";
    return `contacts.instructor.${label}`;
  }
  return fieldNames[active]?.[label] ?? `${active}.${label}`;
}
function isDateField(active: string, label: string) {
  return (
    active === "documentControl" &&
    ["Document creation date", "Syllabus approval date"].includes(label)
  );
}
function dateInputValue(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
function stringify(value: unknown) {
  return typeof value === "string"
    ? value
    : value
      ? JSON.stringify(value, null, 2)
      : "";
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function sectionFrom(value: unknown): Record<string, unknown> {
  return record(value);
}
