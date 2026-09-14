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
  } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { FieldInfoProvider } from "@/components/FieldInfo";
import { HistoryTextField } from "@/components/HistoryTextField";
import {
  FieldHistoryControl,
  FieldHistoryProvider,
  FieldHistorySidebar,
  HistoryField,
} from "@/components/FieldHistory";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { SelectMenu } from "@/components/SelectMenu";
import { AssessmentTabs } from "@/components/AssessmentTabs";
import { AddEntryButton } from "@/components/AddEntryButton";
import { SyllabusExportPreview } from "@/components/SyllabusExportPreview";
import { listAcademicYears, listCoursesByCode } from "@/services/courses";
import { PloAlignmentField } from "@/components/PloAlignmentField";
import { SectionEditorShell } from "@/components/SectionEditorShell";
import { FieldRow } from "@/components/FieldRow";
import { SyllabusField } from "@/components/SyllabusField";
import { SyllabusSubsection } from "@/components/SyllabusSubsection";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";
import {
  saveFailureState,
  type SyllabusSaveState,
} from "@/components/syllabusSaveState";
import {
  BibliographyEditor,
} from "@/components/StructuredEntryEditors";
import {
  deliveryPercentageError,
} from "@/services/syllabusContent";
import {
  CatalogueEntry,
  listCatalogueEntries,
} from "@/services/syllabusCatalogues";

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
  const [previewOpen, setPreviewOpen] = useState(false);
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
              const rebased = {
                ...current,
                revision: saved.revision,
                updatedAt: saved.updatedAt,
              };
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
          setSaveError(
            error instanceof Error
              ? error.message
              : "Save failed. Please try again.",
          );
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
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not reload the latest syllabus.",
      );
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

  // Guidance belongs to the field, not to one syllabus, so every syllabus shows it.
  return (
    <FieldInfoProvider
      source={{ resourceType: "syllabus-field", resourceId: "shared" }}
    >
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
                onClick={() => setPreviewOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
              >
                <FileText size={17} /> Preview export
              </button>
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
                <span
                  role="alert"
                  className="text-sm font-medium text-[#a6292f]"
                >
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
      {previewOpen ? (
        <div className="fixed inset-0 z-[120] overflow-y-auto bg-[#0f172a]/40 p-4" role="dialog" aria-label="Export preview" onClick={() => setPreviewOpen(false)}>
          <div className="mx-auto max-w-[56rem]" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex justify-end">
              <button type="button" onClick={() => setPreviewOpen(false)} className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] shadow-sm">Close preview</button>
            </div>
            <SyllabusExportPreview syllabusId={draft.id} />
          </div>
        </div>
      ) : null}
    </FieldInfoProvider>
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
      <span
        role="alert"
        className="inline-flex items-center gap-2 text-sm text-[#a6292f]"
      >
        <TriangleAlert size={16} /> This syllabus was updated in another tab.
        {onReload ? (
          <button
            type="button"
            onClick={onReload}
            className="font-semibold underline underline-offset-2"
          >
            Reload latest version
          </button>
        ) : null}
      </span>
    );
  if (state === "error")
    return (
      <span
        role="alert"
        className="inline-flex items-center gap-2 text-sm text-[#a6292f]"
        title={error ?? undefined}
      >
        <TriangleAlert size={16} />{" "}
        {error || "Save failed. Your changes are still on this page."}
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
  const people = useQuery({
    queryKey: ["syllabus-catalogues", "people", "editor"],
    // The directory now holds everyone teaching, not the handful somebody typed: ask for all of them.
    queryFn: () => listCatalogueEntries("people", { includeRetired: true, limit: 200 }),
  });
  const programmes = useQuery({
    queryKey: ["syllabus-catalogues", "programmes", "editor"],
    queryFn: () => listCatalogueEntries("programmes"),
  });
  const identification = sectionFrom(content.identification);
  const catalogueProgrammeId = stringify(
    identification.cataloguePloProgrammeId ||
      identification.catalogueProgrammeId,
  );
  const cataloguePlos = useQuery({
    queryKey: ["syllabus-catalogues", "plos", catalogueProgrammeId],
    queryFn: () =>
      listCatalogueEntries("plos", {
        parentId: catalogueProgrammeId,
        includeRetired: true,
      }),
    enabled: Boolean(catalogueProgrammeId),
  });
  const curriculumMap = useQuery({
    queryKey: ["syllabus-catalogues", "curriculum-mapping", catalogueProgrammeId],
    queryFn: () => listCatalogueEntries("curriculum-mapping", { parentId: catalogueProgrammeId }),
    enabled: Boolean(catalogueProgrammeId),
  });
  const scenCompetencies = useQuery({
    queryKey: ["syllabus-catalogues", "competencies", "editor"],
    queryFn: () => listCatalogueEntries("competencies", { includeRetired: true }),
  });
  const graduateCompetencies = useQuery({
    queryKey: ["syllabus-catalogues", "graduate-competencies", "editor"],
    queryFn: () => listCatalogueEntries("graduate-competencies", { includeRetired: true }),
  });
  const teachingPresets = useQuery({
    queryKey: ["syllabus-catalogues", "teaching-presets", "editor"],
    queryFn: () => listCatalogueEntries("teaching-presets"),
  });
  const assessmentTypes = useQuery({
    queryKey: ["syllabus-catalogues", "assessment-types", "editor"],
    queryFn: () => listCatalogueEntries("assessment-types"),
  });
  const boundCourseCode = stringify(sectionFrom(content.identification).catalogueCourseCode);
  const catalogueCourses = useQuery({
    queryKey: ["course-catalogue", "by-code"],
    queryFn: () => listCoursesByCode(),
  });
  const academicYears = useQuery({
    queryKey: ["course-catalogue", "academic-years"],
    queryFn: () => listAcademicYears(),
  });
  const courseTeachers =
    (catalogueCourses.data ?? []).find((course) => course.courseCode === boundCourseCode)?.teachers ?? [];
  const aiPolicies = useQuery({
    queryKey: ["syllabus-catalogues", "ai-policies", "editor"],
    queryFn: () => listCatalogueEntries("ai-policies"),
  });

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
    size: FieldSize = "full",
  ) => (
    <Field
      label={label}
      value={stringify(value)}
      onChange={onChange}
      multiline={multiline}
      size={size}
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
      size?: FieldSize;
    } = {},
  ) => (
    <Field
      label={label}
      value={stringify(value)}
      onChange={onChange}
      size={options.size ?? "full"}
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
    if (active === "courseDetails")
      return (
        <Section title="Course details">
          {text(
            "Foundation Year in",
            section.foundationYear,
            (foundationYear) => save({ ...section, foundationYear }),
          )}
          {text("Semester", section.semester, (semester) =>
            save({ ...section, semester }),
          )}
          {text(
            "Weight of the course in the semester’s grade",
            section.courseWeight,
            (courseWeight) => save({ ...section, courseWeight }),
          )}
          {numeric(
            "Course contact hours",
            section.totalContactHours,
            (totalContactHours) => save({ ...section, totalContactHours }),
          )}
          {text(
            "Prerequisites and co-requisites",
            section.prerequisites,
            (prerequisites) => save({ ...section, prerequisites }),
            true,
          )}
        </Section>
      );
    if (active === "facultyDetails")
      return (
        <Section title="Faculty details">
          <FysFacultyDirectoryPicker
            value={section}
            people={people.data ?? []}
            onChange={save}
          />
          {!stringify(section.personId) ? (
            <>
              {text(
                "Name and status",
                section.staffText,
                (staffText) => save({ ...section, staffText }),
                true,
              )}
              {text("Institution", section.institution, (institution) =>
                save({ ...section, institution }),
              )}
              {text(
                "Office hours",
                section.officeHours,
                (officeHours) => save({ ...section, officeHours }),
                true,
              )}
              {text("Office phone", section.officePhone, (officePhone) =>
                save({ ...section, officePhone }),
              )}
              {text(
                "Email",
                section.email,
                (email) => save({ ...section, email }),
                true,
              )}
            </>
          ) : null}
        </Section>
      );
    if (active === "description")
      return (
        <Section title="Course description">
          {text(
            "Course description",
            section.overview,
            (overview) => save({ overview }),
            true,
          )}
        </Section>
      );
    if (active === "learningOutcomes")
      return (
        <Section title="Course learning outcomes">
          <p className="text-sm text-[#667085]">Enter one CLO per line.</p>
          {text(
            "Course learning outcomes",
            section.closText,
            (closText) => save({ ...section, closText }),
            true,
          )}
        </Section>
      );
    if (active === "requiredMaterials")
      return (
        <Section title="Required materials">
          <BibliographyEditor
            value={section}
            onChange={save}
            syllabusId={draft.id}
            revision={draft.revision}
            onOpenHistory={onOpenHistory}
          />
          {text(
            "Course textbooks and recommended reading",
            section.textbooks,
            (textbooks) => save({ ...section, textbooks }),
            true,
          )}
          {text(
            "Supplemental resources",
            section.supplementalResources,
            (supplementalResources) =>
              save({ ...section, supplementalResources }),
            true,
          )}
          {text(
            "Equipment students may require",
            section.equipment,
            (equipment) => save({ ...section, equipment }),
            true,
          )}
        </Section>
      );
    if (active === "teachingMethodologies")
      return (
        <Section title="Teaching methodologies">
          {text(
            "Teaching methods and hours",
            section.notes,
            (notes) => save({ ...section, notes }),
            true,
          )}
        </Section>
      );
    if (active === "assessment")
      return (
        <Section title="Course assessment">
          {text(
            "Continuous assessment",
            section.continuousText,
            (continuousText) => save({ ...section, continuousText }),
            true,
          )}
          {text(
            "Final assessment",
            section.finalText,
            (finalText) => save({ ...section, finalText }),
            true,
          )}
          {text(
            "Laboratory assessment",
            section.laboratoryText,
            (laboratoryText) => save({ ...section, laboratoryText }),
            true,
          )}
        </Section>
      );
    if (active === "schedule")
      return (
        <Section title="Teaching schedule">
          {text(
            "Week, session, topic, and assessment details",
            section.scheduleText,
            (scheduleText) => editContent(active, { scheduleText }),
            true,
          )}
        </Section>
      );
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
        programmes={(programmes.data ?? []).map((programme) => ({
          value: programme.id,
          label: programme.label,
        }))}
        courses={catalogueCourses.data ?? []}
        academicYears={academicYears.data ?? []}
        semesters={curriculumSemesters(curriculumMap.data ?? [])}
        semesterByCourse={semesterByCourse(curriculumMap.data ?? [])}
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
          courseTeachers={courseTeachers}
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
      <SyllabusSubsection title="Course delivery">
        <FieldRow>
          <SelectField
            label="Delivery mode"
            value={stringify(section.mode)}
            onChange={(value) =>
              editContent(active, { ...section, mode: value })
            }
            history={history("Delivery mode")}
            options={["Face-to-Face Delivery", "Blended Learning Delivery"]}
            placeholder="Select delivery mode"
            size="name"
            hint="Face-to-face means every hour is taught in the room. Blended means some of it is online, and the split below says how much."
          />
          {numeric(
            "Face-to-face (%)",
            faceToFace,
            (value) =>
              editContent(active, { ...section, faceToFacePercent: value }),
            { min: 0, max: 100, step: 1, invalid: Boolean(percentageError), size: "counter" },
          )}
          {numeric(
            "Online (%)",
            online,
            (value) =>
              editContent(active, { ...section, onlinePercent: value }),
            { min: 0, max: 100, step: 1, invalid: Boolean(percentageError), size: "counter" },
          )}
        </FieldRow>
        {percentageError ? (
          <p role="alert" className="text-sm font-medium text-[#a6292f]">
            {percentageError}
          </p>
        ) : null}
      </SyllabusSubsection>
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
        requiredPlos={requiredPloIds(curriculumMap.data ?? [], draft.courseCode)}
        scenCompetencies={scenCompetencies.data ?? []}
        graduateCompetencies={graduateCompetencies.data ?? []}
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
      <TeachingApproachSection
        value={section}
        presets={teachingPresets.data ?? []}
        onChange={(next) => editContent(active, next)}
      />
    );
  if (active === "assessment")
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <SyllabusSubsection title="Course assessment">
          <AssessmentTabs
            value={section}
            outcomes={
              (sectionFrom(content.learningOutcomes).clos as Row[]) ?? []
            }
            onChange={(assessment) => editContent(active, assessment)}
            syllabusId={draft.id}
            revision={draft.revision}
            onOpenHistory={onOpenHistory}
            assessmentTypes={assessmentTypes.data ?? []}
            aiPolicies={aiPolicies.data ?? []}
          />
        </SyllabusSubsection>
        <LockedSection
          title="University table of grade equivalence"
          text={GRADE_EQUIVALENCE_TEXT}
        />
      </div>
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <SyllabusSubsection title="Document details">
        <FieldRow>
          {text(
            "Document creation date",
            section.creationDate,
            (value) => editContent(active, { ...section, creationDate: value }),
            false,
            "code",
          )}
          {text(
            "Department name",
            section.departmentName,
            (value) => editContent(active, { ...section, departmentName: value }),
            false,
            "name",
          )}
          {text(
            "Version number",
            section.versionNumber,
            (value) => editContent(active, { ...section, versionNumber: value }),
            false,
            "counter",
          )}
        </FieldRow>
      </SyllabusSubsection>
      <SyllabusSubsection title="Approval">
        <FieldRow>
          {text(
            "Syllabus approval date",
            section.approvalDate,
            (value) => editContent(active, { ...section, approvalDate: value }),
            false,
            "code",
          )}
          {text(
            "Name and status of approver",
            section.approver,
            (value) => editContent(active, { ...section, approver: value }),
            false,
            "name",
          )}
        </FieldRow>
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
  return <SyllabusSubsection title={title}>{children}</SyllabusSubsection>;
}

function TeachingApproachSection({
  value,
  presets,
  onChange,
}: {
  value: Record<string, unknown>;
  presets: CatalogueEntry[];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const selected = Array.isArray(value.teachingPresetIds)
    ? value.teachingPresetIds.filter((item): item is string => typeof item === "string")
    : [];
  const chosen = presets.filter((preset) => selected.includes(preset.id));
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    // Keep the catalogue's own order, so the syllabus reads lectures before tutorials.
    onChange({ ...value, teachingPresetIds: presets.filter((preset) => next.includes(preset.id)).map((preset) => preset.id) });
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-lg border border-[#d9dee7] bg-white p-5">
        <h3 className="text-lg font-semibold text-[#171717]">Teaching and learning approach</h3>
        <p className="mt-1 text-sm text-[#667085]">
          Choose the kinds of session this course uses. Each one brings its own methods,
          engagement and feedback, written by the department.
        </p>
        {/* Four short choices: across the card, not stacked down a tenth of it. */}
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
          {presets.length ? (
            presets.map((preset) => (
              <label key={preset.id} className="flex items-start gap-2 text-sm text-[#344054]">
                <input type="checkbox" className="mt-0.5" checked={selected.includes(preset.id)} onChange={() => toggle(preset.id)} />
                <span>{preset.label}</span>
              </label>
            ))
          ) : (
            <p className="text-sm text-[#667085]">No approved teaching approaches yet.</p>
          )}
        </div>
      </section>
      {chosen.length ? (
        chosen.map((preset) => (
          <section key={preset.id} className="rounded-lg border border-[#d9dee7] bg-white p-5">
            <h4 className="text-base font-semibold text-[#171717]">{preset.label}</h4>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
              {TEACHING_SUBSECTIONS.map(([key, heading]) => (
                <div key={key} className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] p-3">
                  <p className="text-sm font-semibold text-[#344054]">{heading}</p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#475467]">
                    {stringify(preset.payload[key]) || "The department has not written this section yet."}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <section className="rounded-lg border border-[#d9dee7] bg-white p-5">
          <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-3 text-sm text-[#667085]">
            Select the kinds of session above to see what the syllabus will say.
          </p>
        </section>
      )}
    </div>
  );
}

/** Section 8's three subsections, in the order the approved template numbers them. */
const TEACHING_SUBSECTIONS = [
  ["methods", "8.1 Teaching methods and learning activities"],
  ["engagement", "8.2 Student engagement"],
  ["feedback", "8.3 Feedback and academic progress"],
] as const;

function FysFacultyDirectoryPicker({
  value,
  people,
  onChange,
}: {
  value: Record<string, unknown>;
  people: CatalogueEntry[];
  onChange: (value: Record<string, unknown>) => void;
}) {
  const personId = stringify(value.personId);
  const selected = people.find((person) => person.id === personId);
  const options = people
    .filter(
      (person) =>
        Array.isArray(person.payload.roles) &&
        person.payload.roles.includes("instructor"),
    )
    .map((person) => ({ value: person.id, label: person.label }));
  if (!options.length) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <label className="grid grid-cols-[minmax(0,1fr)] gap-1 text-sm font-medium text-[#344054]">
        <span>
          Faculty member from People directory{" "}
          <span className="font-normal text-[#667085]">(optional)</span>
        </span>
        <SelectMenu
          label="Faculty member from People directory"
          value={personId}
          onChange={(nextId) =>
            onChange({ ...value, personId: nextId || undefined })
          }
          placeholder="Enter faculty details manually"
          searchable
          options={[
            { value: "", label: "Enter faculty details manually" },
            ...options,
          ]}
        />
      </label>
      {selected ? (
        <div className="rounded-md border border-[#d9dee7] bg-[#f8fafc] p-4 text-sm text-[#475467]">
          <p className="font-semibold text-[#344054]">{selected.label}</p>
          <p className="mt-1">
            {[
              stringify(selected.payload.academicRank),
              stringify(selected.payload.affiliations),
              stringify(selected.payload.officeHours),
              stringify(selected.payload.email),
            ]
              .filter(Boolean)
              .join(" · ") || "Directory details will appear in exports."}
          </p>
          <p className="mt-2 text-xs text-[#667085]">
            Live directory details are read-only in the syllabus.
          </p>
        </div>
      ) : null}
    </div>
  );
}
function LearningOutcomesEditor({
  section,
  onChange,
  syllabusId,
  revision,
  onOpenHistory,
  cataloguePlos,
  catalogueProgrammeId,
  requiredPlos,
  scenCompetencies,
  graduateCompetencies,
}: {
  section: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
  cataloguePlos: CatalogueEntry[];
  catalogueProgrammeId: string;
  requiredPlos: string[];
  scenCompetencies: CatalogueEntry[];
  graduateCompetencies: CatalogueEntry[];
}) {
  const cataloguePloOptions = cataloguePlos.map((plo) => {
    const code = stringify(plo.payload.code) || plo.label;
    const outcome = stringify(plo.payload.outcome);
    const label = outcome ? `${code}: ${outcome}` : code;
    return { value: label, label, catalogueId: plo.id };
  });
  const competencyOptions = scenCompetencies.map((entry) => {
    const code = stringify(entry.payload.code) || entry.label;
    const outcome = stringify(entry.payload.outcome);
    const label = outcome ? `${code}: ${outcome}` : entry.label;
    return { value: label, label, catalogueId: entry.id };
  });
  const graduateById = new Map(graduateCompetencies.map((entry) => [entry.id, entry]));
  const rows = (section.clos as Row[]) ?? [];
  // Guidance, never a gate: a professor is told what is still uncovered and decides.
  const alignedPloIds = new Set(
    rows.flatMap((row) => String(row.ploIds ?? "").split("\n").filter(Boolean)),
  );
  const uncovered = requiredPlos
    .filter((id) => !alignedPloIds.has(id))
    .map((id) => {
      const plo = cataloguePlos.find((entry) => entry.id === id);
      return plo ? stringify(plo.payload.code) || plo.label : "";
    })
    .filter(Boolean);
  return (
    <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5">
      <h3 className="text-lg font-semibold text-[#171717]">Learning outcomes</h3>
      <p className="mt-1 text-sm text-[#667085]">
        Programme learning outcomes and graduate competencies are maintained in the
        catalogue. Align each course outcome to them here.
      </p>
      {catalogueProgrammeId ? null : (
        <p
          role="note"
          className="mt-4 rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]"
        >
          Choose this course&apos;s programme in section 1 to align its outcomes: the
          approved programme learning outcomes come from the programme.
        </p>
      )}
      {uncovered.length ? (
        <p
          role="status"
          className="mt-4 rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]"
        >
          The curriculum map expects this course to address {uncovered.join(", ")}. No course
          outcome aligns to {uncovered.length === 1 ? "it" : "them"} yet.
        </p>
      ) : null}
      <div className="mt-5 min-w-0">
        <RowsEditor
          title="Course learning outcomes and alignment"
          columns={[
            ["clo", "Course learning outcome"],
            ["plo", "Aligned PLOs"],
            ["skills", "SCEN graduate competencies"],
          ]}
          rows={rows}
          onChange={(clos) => onChange({ ...section, clos })}
          rowLabel="CLO"
          selectOptions={{ plo: cataloguePloOptions, skills: competencyOptions }}
          derivedColumns={{
            skills: {
              label: "SUAD graduate competencies",
              derive: (value) => suadCompetencyText(value, scenCompetencies, graduateById),
            },
          }}
          onPloChange={(row, labels, key) => {
            const options = key === "plo" ? cataloguePloOptions : competencyOptions;
            const ids = labels
              .split("\n")
              .map((label) => options.find((option) => option.value === label)?.catalogueId)
              .filter(Boolean)
              .join("\n");
            return { ...row, [key]: labels, [key === "plo" ? "ploIds" : "skillIds"]: ids };
          }}
          addLabel="Add outcome"
          historyPath="learningOutcomes.clos"
          syllabusId={syllabusId}
          revision={revision}
          onOpenHistory={onOpenHistory}
        />
      </div>
    </section>
  );
}

/** The SUAD competencies a course develops follow from the SCEN ones it selects. */
function suadCompetencyText(
  value: string,
  scenCompetencies: CatalogueEntry[],
  graduateById: Map<string, CatalogueEntry>,
) {
  const selected = new Set(value.split("\n").filter(Boolean));
  const labels = new Set<string>();
  for (const competency of scenCompetencies) {
    const code = stringify(competency.payload.code) || competency.label;
    const outcome = stringify(competency.payload.outcome);
    const label = outcome ? `${code}: ${outcome}` : competency.label;
    if (!selected.has(label)) continue;
    const ids = competency.payload.graduateCompetencyIds;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      const graduate = graduateById.get(String(id));
      if (graduate) labels.add(graduate.label);
    }
  }
  return Array.from(labels).join("\n");
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
  size = "full",
  hint,
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
  size?: FieldSize;
  hint?: string;
  history: {
    syllabusId: string;
    revision: number;
    field: HistoryField;
    onOpenSidebar: (field: HistoryField) => void;
  };
}) {
  if (isDate)
    return (
      <div className={`grid content-start gap-1 ${fieldSizeClass[size]}`}>
        <DateField
          label={label}
          value={dateInputValue(value)}
          onChange={onChange}
          trailing={<FieldHistoryControl {...history} placement="center" />}
        />
      </div>
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
      size={size}
      hint={hint}
      // A one-line value wraps rather than scrolling its end out of sight.
      grow={!multiline && inputType === "text"}
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
  size = "full",
  hint,
  history,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  size?: FieldSize;
  hint?: string;
  history: {
    syllabusId: string;
    revision: number;
    field: HistoryField;
    onOpenSidebar: (field: HistoryField) => void;
  };
}) {
  return (
    <SyllabusField label={label} fieldKey={history.field.path} hint={hint} size={size}>
      <SelectMenu
        label={label}
        value={value}
        onChange={onChange}
        wrap
        placeholder={placeholder}
        options={options.map((option) => ({ value: option, label: option }))}
        trailing={<FieldHistoryControl {...history} />}
      />
    </SyllabusField>
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
  rowLabel,
  derivedColumns,
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
  onPloChange?: (row: Row, labels: string, key: string) => Row;
  /** Numbers each entry, so a CLO reads "CLO 1" wherever it is referenced. */
  rowLabel?: string;
  /** Read-only columns whose value follows from another the professor chose. */
  derivedColumns?: Record<string, { label: string; derive: (value: string) => string }>;
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
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
                itemIndex === index
                  ? (key === "plo" || key === "skills") && onPloChange
                    ? onPloChange(item, value, key)
                    : { ...item, [key]: value }
                  : item,
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
                    if ((key === "plo" || key === "skills") && options) {
                      const derived = derivedColumns?.[key];
                      return (
                        <div key={key} className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:col-span-2">
                        <PloAlignmentField
                          label={label}
                          pickerLabel={`Add ${label.toLowerCase()} to ${rowLabel ?? "entry"} ${index + 1}`}
                          emptyText={key === "plo" ? "No PLOs aligned yet." : "No graduate competencies selected yet."}
                          addText={key === "plo" ? "Add aligned PLO" : "Add graduate competency"}
                          value={value}
                          onChange={(next) => updateRow(key, next)}
                          options={options}
                          history={
                            <FieldHistoryControl
                              syllabusId={syllabusId}
                              revision={revision}
                              field={field}
                              onOpenSidebar={onOpenHistory}
                              placement="label"
                            />
                          }
                        />
                        {derived ? (
                          <div>
                            <p className="text-sm font-medium text-[#344054]">{derived.label}</p>
                            <p className="mt-1 whitespace-pre-line rounded-md border border-dashed border-[#d0d5dd] bg-[#f8fafc] px-3 py-2 text-sm text-[#475467]">
                              {derived.derive(value) || "Follows from the competencies selected above."}
                            </p>
                          </div>
                        ) : null}
                        </div>
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

/** The PLOs the curriculum map expects of a course, by its code. */
function requiredPloIds(mapping: CatalogueEntry[], courseCode: string): string[] {
  const wanted = courseCode.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!wanted) return [];
  const entry = mapping.find((item) => item.label.replace(/[^a-z0-9]/gi, "").toUpperCase() === wanted);
  const ids = entry?.payload.ploIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** The levels and semesters this programme's curriculum map actually uses. */
function curriculumSemesters(mapping: CatalogueEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of mapping) {
    const semester = stringify(entry.payload.semester).trim();
    if (semester) seen.add(semester);
  }
  return Array.from(seen).sort();
}

/** The curriculum map says which level and semester a course belongs to. */
function semesterByCourse(mapping: CatalogueEntry[]): Record<string, string> {
  const byCode: Record<string, string> = {};
  for (const entry of mapping) {
    const code = entry.label.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const semester = stringify(entry.payload.semester).trim();
    if (code && semester) byCode[code] = semester;
  }
  return byCode;
}
