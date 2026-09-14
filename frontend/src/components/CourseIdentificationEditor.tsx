import { AddEntryButton } from "@/components/AddEntryButton";
import { X } from "lucide-react";

import { HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";
import { SelectMenu, SelectOption } from "@/components/SelectMenu";
import { SyllabusField } from "@/components/SyllabusField";
import { courseLabel, type CatalogueCourse } from "@/services/courses";
import { SyllabusSubsection } from "@/components/SyllabusSubsection";

type HistoryContext = { syllabusId: string; revision: number; onOpenHistory: (field: HistoryField) => void };
type ListItem = { id: string; text: string };
type Props = HistoryContext & {
  value: Record<string, unknown>;
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  onChange: (value: Record<string, unknown>) => void;
  onMetadataChange: (field: "courseTitle" | "courseCode" | "academicYear", value: string) => void;
  programmes?: SelectOption[];
  courses?: CatalogueCourse[];
  academicYears?: string[];
  semesters?: string[];
  semesterByCourse?: Record<string, string>;
};

const contactHourKinds = ["Lectures", "Tutorials", "Workshops", "Seminars", "Laboratory", "Other"];

const boundCourseHint =
  "Title, code, credits and level come from the course record in Students and Timetables. " +
  "Change them there and this syllabus follows; there is nothing to retype here.";

export function CourseIdentificationEditor({ value, courseTitle, courseCode, academicYear, onChange, onMetadataChange, programmes = [], courses = [], academicYears = [], semesters = [], semesterByCourse = {}, ...history }: Props) {
  const contactHours = record(value.contactHours);
  const update = (change: Record<string, unknown>) => onChange({ ...value, ...change });
  const programmeId = stringValue(value.catalogueProgrammeId);
  const chooseProgramme = (nextId: string) => {
    const programme = programmes.find((item) => item.value === nextId);
    update({ catalogueProgrammeId: nextId || undefined, programmeTitle: programme?.label ?? stringValue(value.programmeTitle), cataloguePloProgrammeId: nextId || undefined });
  };
  const boundCode = stringValue(value.catalogueCourseCode);
  const bound = courses.find((item) => item.courseCode === boundCode);
  const chooseCourse = (nextCode: string) => {
    const course = courses.find((item) => item.courseCode === nextCode);
    if (!course) {
      update({ catalogueCourseCode: undefined });
      return;
    }
    // The course record is the source of truth; identity fields follow it from here on.
    onMetadataChange("courseTitle", course.courseTitle);
    onMetadataChange("courseCode", course.courseCode);
    update({
      catalogueCourseCode: course.courseCode,
      catalogueCourseCrns: course.crns,
      ects: course.credit || stringValue(value.ects),
      // The imported course record carries no level; the curriculum map does.
      degreeLevelAndSemester:
        semesterByCourse[course.courseCode.replace(/[^a-z0-9]/gi, "").toUpperCase()] ||
        stringValue(value.degreeLevelAndSemester),
    });
  };
  const courseOptions = courses.map((course) => ({ value: course.courseCode, label: courseLabel(course) }));
  const prerequisiteItems = listItems(value.prerequisiteItems, value.prerequisites, "Prerequisite");
  const corequisiteItems = listItems(value.corequisiteItems, value.corequisites, "Co-requisite");
  const sections = bound?.crns.length ?? 0;
  const courseSource = bound && sections
    ? `from Students and Timetables · ${sections} section${sections === 1 ? "" : "s"}`
    : "from Students and Timetables";

  return <div className="grid gap-4">
    <SyllabusSubsection title="Course details">
      {courses.length ? <SyllabusField label="Course" source={courseSource} fieldKey="identification.catalogueCourseCode" hint={boundCourseHint}><SelectMenu label="Course" value={boundCode} onChange={chooseCourse} placeholder="Enter the course details manually" searchable searchPlaceholder="Search by code or title" options={[{ value: "", label: "Enter the course details manually" }, ...courseOptions]} /></SyllabusField> : null}
      {/* A code is eight characters and a title is a line: they have no business being the same width. */}
      <div className="grid items-end gap-4 sm:grid-cols-3">
        {bound
          ? <><ReadOnlyField label="Course code" value={bound.courseCode} /><ReadOnlyField label="Course title" value={bound.courseTitle} className="sm:col-span-2" /></>
          : <><IdentificationField label="Course code" value={courseCode} onChange={(next) => onMetadataChange("courseCode", next)} field={{ path: "metadata.courseCode", label: "Course code" }} {...history} /><IdentificationField label="Course title" value={courseTitle} onChange={(next) => onMetadataChange("courseTitle", next)} field={{ path: "metadata.courseTitle", label: "Course title" }} className="sm:col-span-2" {...history} /></>}
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-2">
        {academicYears.length
          ? <SyllabusField label="Academic year" source="from Students and Timetables" fieldKey="metadata.academicYear"><SelectMenu label="Academic year" value={academicYear} onChange={(next) => onMetadataChange("academicYear", next)} placeholder="Select the academic year" options={withCurrent(academicYears, academicYear)} /></SyllabusField>
          : <IdentificationField label="Academic year" value={academicYear} onChange={(next) => onMetadataChange("academicYear", next)} field={{ path: "metadata.academicYear", label: "Academic year" }} {...history} />}
        {semesters.length
          ? <SyllabusField label="Degree level and semester" source="from the curriculum map" fieldKey="identification.degreeLevelAndSemester" hint="The year and semester this course is taught in, as the curriculum map records it. Add or correct a course's place in Manage catalogues → Curriculum mapping."><SelectMenu label="Degree level and semester" value={stringValue(value.degreeLevelAndSemester)} onChange={(degreeLevelAndSemester) => update({ degreeLevelAndSemester })} placeholder="Select the level and semester" options={withCurrent(semesters, stringValue(value.degreeLevelAndSemester))} /></SyllabusField>
          : <IdentificationField label="Degree level and semester" value={stringValue(value.degreeLevelAndSemester)} onChange={(degreeLevelAndSemester) => update({ degreeLevelAndSemester })} field={{ path: "identification.degreeLevelAndSemester", label: "Degree level and semester" }} {...history} />}
      </div>
    </SyllabusSubsection>

    <SyllabusSubsection title="Programme and credits">
      {programmes.length ? <SyllabusField label="Programme" source="(optional)" fieldKey="identification.catalogueProgrammeId" hint="Choosing a programme here is what makes its expected learning outcomes available in section 5. Leave it unset to write programme outcomes into this syllabus alone."><SelectMenu label="Programme" value={programmeId} onChange={chooseProgramme} placeholder="Use local programme learning outcomes" searchable options={[{ value: "", label: "Use local programme learning outcomes" }, ...programmes]} /></SyllabusField> : null}
      {/* A programme title is a sentence long; the credit beside it is one digit. */}
      <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <IdentificationField label="Programme title" value={stringValue(value.programmeTitle)} onChange={(programmeTitle) => update({ programmeTitle, catalogueProgrammeId: undefined, cataloguePloProgrammeId: undefined })} field={{ path: "identification.programmeTitle", label: "Programme title" }} {...history} />
        <IdentificationField label="Number of ECTS" value={stringValue(value.ects)} onChange={(ects) => update({ ects })} type="number" min={0} step={0.5} field={{ path: "identification.ects", label: "Number of ECTS" }} {...history} />
      </div>
    </SyllabusSubsection>

    <SyllabusSubsection title="Course contact hours">
      <div className="grid items-end gap-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">{contactHourKinds.map((label) => <IdentificationField key={label} label={label} value={stringValue(contactHours[label])} onChange={(next) => update({ contactHours: { ...contactHours, [label]: next } })} type="number" min={0} step={1} field={{ path: `identification.contactHours.${label}`, label }} {...history} />)}</div>
      <ContactHoursTotal contactHours={contactHours} />
    </SyllabusSubsection>

    <SyllabusSubsection title="Requirements and equipment">
      {/* Two lists of the same shape, read against each other more often than read alone. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CourseList title="Prerequisites" fieldKey="identification.prerequisiteItems" hint="Courses a student must have passed in a previous year before taking this one." items={prerequisiteItems} options={courseOptions} onChange={(items) => update({ prerequisiteItems: items, prerequisites: items.map((item) => item.text).filter(Boolean).join("\n") })} />
        <CourseList title="Co-requisites" fieldKey="identification.corequisiteItems" hint="Courses taken alongside this one, in the same year." items={corequisiteItems} options={courseOptions} onChange={(items) => update({ corequisiteItems: items, corequisites: items.map((item) => item.text).filter(Boolean).join("\n") })} />
      </div>
      <TextList title="Equipment" singular="equipment item" legacyValue={value.equipment} itemsValue={value.equipmentItems} path="identification.equipmentItems" onChange={(items) => update({ equipmentItems: items, equipment: items.map((item) => item.text).filter(Boolean).join("\n") })} {...history} />
    </SyllabusSubsection>
  </div>;

}

/** Six numbers that are only ever wanted added up; the sum was left to the reader. */
function ContactHoursTotal({ contactHours }: { contactHours: Record<string, unknown> }) {
  const total = contactHourKinds.reduce((sum, kind) => sum + (Number(stringValue(contactHours[kind])) || 0), 0);
  if (!total) return null;
  return <p className="text-sm text-[#667085]">Total <span className="font-semibold text-[#344054]">{total}</span> contact hour{total === 1 ? "" : "s"}</p>;
}

function TextList({ title, singular, legacyValue, itemsValue, path, onChange, ...history }: HistoryContext & { title: string; singular: string; legacyValue: unknown; itemsValue: unknown; path: string; onChange: (value: ListItem[]) => void }) {
  const items = listItems(itemsValue, legacyValue, title);
  return <section><h4 className="text-sm font-semibold text-[#344054]">{title}</h4>{items.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">{items.map((item, index) => <div key={item.id} className="flex items-start gap-2"><div className="min-w-0 flex-1"><IdentificationField label={`${title} ${index + 1}`} value={item.text} onChange={(text) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, text } : entry))} multiline minRows={1} field={{ path: `${path}[${item.id}].text`, label: `${title} ${index + 1}` }} {...history} /></div><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="mt-7 rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${singular} ${index + 1}`}><X size={17} /></button></div>)}</div> : null}<AddEntryButton onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])} label={`Add ${singular}`} /></section>;
}

function IdentificationField({ label, value, onChange, field, onOpenHistory, multiline = false, minRows = 2, type = "text", min, step, inputMode, className }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; minRows?: number; type?: string; min?: number; step?: number; inputMode?: "decimal"; className?: string }) {
  return <HistoryTextField label={label} value={value} onChange={onChange} multiline={multiline} minRows={minRows} type={type} min={min} step={step} inputMode={inputMode} className={className} history={{ field, onOpenHistory }} />;
}

function listItems(value: unknown, legacy: unknown, name: string): ListItem[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? [{ id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, string>).id : `${name}-${index}`, text: (item as Record<string, string>).text }] : []);
  const text = stringValue(legacy);
  return text.trim() ? [{ id: `legacy-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, text }] : [];
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : value === 0 ? "0" : ""; }

/** A value the course record owns: shown, never edited here. */
function ReadOnlyField({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return <div className={`grid content-start gap-1 text-sm font-medium text-[#344054] ${className}`}>{label}<p className="flex h-10 items-center rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 font-normal text-[#475467]">{value || "—"}</p></div>;
}

/** Prerequisites and co-requisites are courses, so they are chosen, not typed. */
function CourseList({ title, hint, fieldKey, items, options, onChange }: { title: string; hint: string; fieldKey: string; items: ListItem[]; options: SelectOption[]; onChange: (items: ListItem[]) => void }) {
  const chosen = items.map((item) => item.text).filter(Boolean);
  const add = (label: string) => {
    if (!label || chosen.includes(label)) return;
    onChange([...items, { id: crypto.randomUUID(), text: label }]);
  };
  return <SyllabusField label={title} fieldKey={fieldKey} hint={hint}>
    {chosen.length ? <ul aria-label={`Selected ${title.toLowerCase()}`} className="grid gap-2">{items.filter((item) => item.text).map((item) => <li key={item.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm font-normal text-[#344054]"><span className="min-w-0 truncate">{item.text}</span><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="shrink-0 rounded p-1 text-[#667085] hover:bg-[#e8edf3] hover:text-[#a6292f]" aria-label={`Remove ${item.text} from ${title.toLowerCase()}`}><X size={16} aria-hidden="true" /></button></li>)}</ul> : null}
    <SelectMenu label={`Add ${title.toLowerCase()}`} value="" onChange={add} placeholder={chosen.length ? `Add another ${title.toLowerCase().replace(/s$/, "")}` : `None yet — add a ${title.toLowerCase().replace(/s$/, "")}`} searchable searchPlaceholder="Search by code or title" options={options.filter((option) => option.value && !chosen.includes(option.label))} />
  </SyllabusField>;
}

/** A syllabus keeps whatever it already says, even if the list no longer offers it. */
function withCurrent(values: string[], current: string): SelectOption[] {
  const all = current && !values.includes(current) ? [current, ...values] : values;
  return all.map((value) => ({ value, label: value }));
}
