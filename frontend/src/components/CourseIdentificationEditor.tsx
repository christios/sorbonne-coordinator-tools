import { AddEntryButton } from "@/components/AddEntryButton";
import { X } from "lucide-react";

import { HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";
import { SelectMenu, SelectOption } from "@/components/SelectMenu";
import { FormGrid } from "@/components/FormGrid";
import { SyllabusField } from "@/components/SyllabusField";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";
import { courseLabel, type CatalogueCourse } from "@/services/courses";
import { UNTITLED_SYLLABUS } from "@/services/syllabi";
import { SyllabusSubsection } from "@/components/SyllabusSubsection";
import { CONTACT_HOUR_ROWS } from "@/services/syllabusContent";

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
  /** The hours the document prints, added up from the course schedule's sessions. */
  contactHours?: Partial<Record<(typeof CONTACT_HOUR_ROWS)[number], string>>;
  onOpenSchedule?: () => void;
};

/*
 * Where each field sits on the card's twelve columns. Two to a row on a narrow card; on a
 * wide one the course takes half the row beside its code and title, and the year, level
 * and programme line up under them on the same edges, then the credits and the hours.
 */
const SPAN = {
  course: "col-span-12 @4xl:col-span-6",
  code: "col-span-12 @md:col-span-6 @4xl:col-span-2",
  title: "col-span-12 @md:col-span-6 @4xl:col-span-4",
  year: "col-span-12 @md:col-span-6 @4xl:col-span-3",
  level: "col-span-12 @md:col-span-6 @4xl:col-span-3",
  programme: "col-span-12 @4xl:col-span-6",
  ects: "col-span-12 @md:col-span-6 @4xl:col-span-3",
  hours: "col-span-12 @md:col-span-6 @4xl:col-span-9",
  half: "col-span-12 @2xl:col-span-6",
};


const boundCourseHint =
  "Title, code, credits and level come from the course record in Students and Timetables. " +
  "Change them there and this syllabus follows; there is nothing to retype here.";

export function CourseIdentificationEditor({ value, courseTitle, courseCode, academicYear, onChange, onMetadataChange, programmes = [], courses = [], academicYears = [], semesters = [], semesterByCourse = {}, contactHours = {}, onOpenSchedule, ...history }: Props) {
  const update = (change: Record<string, unknown>) => onChange({ ...value, ...change });
  const programmeId = stringValue(value.catalogueProgrammeId);
  const chooseProgramme = (nextId: string) => {
    const programme = programmes.find((item) => item.value === nextId);
    update({ catalogueProgrammeId: nextId || undefined, programmeTitle: programme?.label ?? stringValue(value.programmeTitle), cataloguePloProgrammeId: nextId || undefined });
  };
  const boundCode = stringValue(value.catalogueCourseCode);
  // A syllabus just started is named by choosing its course, so the list opens ready to
  // search (Christian, 10 Nov 2026). Typing a title stays possible for a course not listed.
  const unnamed = courseTitle.trim() === UNTITLED_SYLLABUS && !boundCode;
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
  const chosenProgramme = programmes.find((item) => item.value === programmeId);
  const sections = bound?.crns.length ?? 0;
  const courseSource = bound && sections
    ? `from Students and Timetables · ${sections} section${sections === 1 ? "" : "s"}`
    : "from Students and Timetables";

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
    <SyllabusSubsection title="Course details">
      <FormGrid>
        {courses.length ? <SyllabusField className={SPAN.course} label="Course" source={courseSource} fieldKey="identification.catalogueCourseCode" hint={boundCourseHint}><SelectMenu label="Course" wrap defaultOpen={unnamed} value={boundCode} onChange={chooseCourse} placeholder="Enter the course details manually" searchable searchPlaceholder="Search by code or title" options={[{ value: "", label: "Enter the course details manually" }, ...courseOptions]} /></SyllabusField> : null}
        {bound
          ? <><ReadOnlyField className={SPAN.code} label="Course code" value={bound.courseCode} /><ReadOnlyField className={SPAN.title} label="Course title" value={bound.courseTitle} /></>
          : <><IdentificationField className={SPAN.code} label="Course code" required value={courseCode} onChange={(next) => onMetadataChange("courseCode", next)} grow field={{ path: "metadata.courseCode", label: "Course code" }} {...history} /><IdentificationField className={SPAN.title} label="Course title" required value={courseTitle} onChange={(next) => onMetadataChange("courseTitle", next)} grow field={{ path: "metadata.courseTitle", label: "Course title" }} {...history} /></>}
        {academicYears.length
          ? <SyllabusField className={SPAN.year} label="Academic year" required fieldKey="metadata.academicYear" hint="Which academic year this syllabus is for. The years offered are the ones Students and Timetables has imported terms for."><SelectMenu label="Academic year" wrap value={academicYear} onChange={(next) => onMetadataChange("academicYear", next)} placeholder="Select the academic year" options={withCurrent(academicYears, academicYear)} /></SyllabusField>
          : <IdentificationField className={SPAN.year} label="Academic year" required value={academicYear} onChange={(next) => onMetadataChange("academicYear", next)} grow field={{ path: "metadata.academicYear", label: "Academic year" }} {...history} />}
        {semesters.length
          ? <SyllabusField className={SPAN.level} label="Degree level and semester" required fieldKey="identification.degreeLevelAndSemester" hint="The year and semester this course is taught in, as the curriculum map records it. Add or correct a course's place in Manage catalogues → Curriculum mapping."><SelectMenu label="Degree level and semester" wrap value={stringValue(value.degreeLevelAndSemester)} onChange={(degreeLevelAndSemester) => update({ degreeLevelAndSemester })} placeholder="Select the level and semester" options={withCurrent(semesters, stringValue(value.degreeLevelAndSemester))} /></SyllabusField>
          : <IdentificationField className={SPAN.level} label="Degree level and semester" required value={stringValue(value.degreeLevelAndSemester)} onChange={(degreeLevelAndSemester) => update({ degreeLevelAndSemester })} grow field={{ path: "identification.degreeLevelAndSemester", label: "Degree level and semester" }} {...history} />}
        {/* Required since the November 2026 review: the programme is where the course's
            PLOs and its curriculum mapping come from, so there is no "local outcomes" choice. */}
        {programmes.length ? <SyllabusField className={SPAN.programme} label="Programme" required fieldKey="identification.catalogueProgrammeId" hint="The programme this course belongs to. Its programme learning outcomes, and the ones the curriculum mapping expects of this course, come from it in section 4."><SelectMenu label="Programme" wrap value={programmeId} onChange={chooseProgramme} placeholder="Select the programme" searchable options={programmes} /></SyllabusField> : null}
        {/* Chosen from the catalogue, the programme's title is the choice above, character for
            character; a second box repeating it filled a row and told nobody anything. Typed
            instead of chosen, it is the only place the title exists, so it is a field — kept
            for older syllabi that typed one, and for when no programme catalogue exists. */}
        {chosenProgramme || (programmes.length && !stringValue(value.programmeTitle)) ? null : <IdentificationField className={SPAN.programme} label="Programme title" required value={stringValue(value.programmeTitle)} onChange={(programmeTitle) => update({ programmeTitle, catalogueProgrammeId: undefined, cataloguePloProgrammeId: undefined })} grow field={{ path: "identification.programmeTitle", label: "Programme title" }} {...history} />}
        {/* The credits sit with the rest of the course's identity rather than in a card of
            their own, beside the contact hours the document prints next to them. */}
        <IdentificationField className={SPAN.ects} label="Number of ECTS" required value={stringValue(value.ects)} onChange={(ects) => update({ ects })} type="number" min={0} step={0.5} field={{ path: "identification.ects", label: "Number of ECTS" }} {...history} />
        <ContactHours className={SPAN.hours} hours={contactHours} onOpenSchedule={onOpenSchedule} />
      </FormGrid>
    </SyllabusSubsection>

    <SyllabusSubsection title="Requirements and equipment">
      <FormGrid align="start">
        <CourseList className={SPAN.half} title="Prerequisites" fieldKey="identification.prerequisiteItems" hint="Courses a student must have passed in a previous year before taking this one." items={prerequisiteItems} options={courseOptions} onChange={(items) => update({ prerequisiteItems: items, prerequisites: items.map((item) => item.text).filter(Boolean).join("\n") })} />
        <CourseList className={SPAN.half} title="Co-requisites" fieldKey="identification.corequisiteItems" hint="Courses taken alongside this one, in the same year." items={corequisiteItems} options={courseOptions} onChange={(items) => update({ corequisiteItems: items, corequisites: items.map((item) => item.text).filter(Boolean).join("\n") })} />
      </FormGrid>
      <TextList title="Equipment" singular="equipment item" legacyValue={value.equipment} itemsValue={value.equipmentItems} path="identification.equipmentItems" onChange={(items) => update({ equipmentItems: items, equipment: items.map((item) => item.text).filter(Boolean).join("\n") })} {...history} />
    </SyllabusSubsection>
  </div>;

}


function TextList({ title, singular, legacyValue, itemsValue, path, onChange, ...history }: HistoryContext & { title: string; singular: string; legacyValue: unknown; itemsValue: unknown; path: string; onChange: (value: ListItem[]) => void }) {
  const items = listItems(itemsValue, legacyValue, title);
  return <section><h4 className="text-sm font-semibold text-[#344054]">{title}</h4>{items.length ? <div className="@container"><div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 @2xl:grid-cols-2">{items.map((item, index) => <div key={item.id} className="flex items-start gap-2"><div className="min-w-0 flex-1"><IdentificationField label={`${title} ${index + 1}`} value={item.text} onChange={(text) => onChange(items.map((entry) => entry.id === item.id ? { ...entry, text } : entry))} grow field={{ path: `${path}[${item.id}].text`, label: `${title} ${index + 1}` }} {...history} /></div><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="mt-7 rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove ${singular} ${index + 1}`}><X size={17} /></button></div>)}</div></div> : null}<AddEntryButton onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "" }])} label={`Add ${singular}`} /></section>;
}

function IdentificationField({ label, value, onChange, field, onOpenHistory, multiline = false, minRows = 2, type = "text", min, step, inputMode, size = "full", grow = false, className, required = false }: HistoryContext & { label: string; value: string; onChange: (value: string) => void; field: HistoryField; multiline?: boolean; minRows?: number; type?: string; min?: number; step?: number; inputMode?: "decimal"; size?: FieldSize; grow?: boolean; className?: string; required?: boolean }) {
  return <HistoryTextField label={label} required={required} value={value} onChange={onChange} multiline={multiline} minRows={minRows} type={type} min={min} step={step} inputMode={inputMode} size={size} grow={grow} className={className} history={{ field, onOpenHistory }} />;
}

function listItems(value: unknown, legacy: unknown, name: string): ListItem[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string" ? [{ id: typeof (item as Record<string, unknown>).id === "string" ? (item as Record<string, string>).id : `${name}-${index}`, text: (item as Record<string, string>).text }] : []);
  const text = stringValue(legacy);
  return text.trim() ? [{ id: `legacy-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, text }] : [];
}

function stringValue(value: unknown): string { return typeof value === "string" ? value : value === 0 ? "0" : ""; }

/** A value the course record owns: shown, never edited here. */
function ReadOnlyField({ label, value, size = "full", className = "" }: { label: string; value: string; size?: FieldSize; className?: string }) {
  return <div className={`grid content-start gap-1 text-sm font-medium text-[#344054] ${fieldSizeClass[size]} ${className}`}><span className="sm:whitespace-nowrap">{label}</span><p className="min-h-10 w-full rounded-md border border-[#d5dbe4] bg-[#f1f4f8] px-3 py-2 font-normal leading-[22px] text-[#475467]">{value || "—"}</p></div>;
}

/** Prerequisites and co-requisites are courses, so they are chosen, not typed. */
function CourseList({ title, hint, fieldKey, items, options, onChange, className = "" }: { title: string; hint: string; fieldKey: string; items: ListItem[]; options: SelectOption[]; onChange: (items: ListItem[]) => void; className?: string }) {
  const chosen = items.map((item) => item.text).filter(Boolean);
  const add = (label: string) => {
    if (!label || chosen.includes(label)) return;
    onChange([...items, { id: crypto.randomUUID(), text: label }]);
  };
  return <SyllabusField className={className} label={title} fieldKey={fieldKey} hint={hint}>
    {chosen.length ? <ul aria-label={`Selected ${title.toLowerCase()}`} className="grid grid-cols-[minmax(0,1fr)] gap-2">{items.filter((item) => item.text).map((item) => <li key={item.id} className="flex min-w-0 items-start justify-between gap-2 rounded-md border border-[#c3cbd6] bg-[#f1f4f8] px-3 py-2 text-sm font-normal text-[#344054]"><span className="min-w-0 break-words">{item.text}</span><button type="button" onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="shrink-0 rounded p-1 text-[#475467] hover:bg-[#e8edf3] hover:text-[#a6292f]" aria-label={`Remove ${item.text} from ${title.toLowerCase()}`}><X size={16} aria-hidden="true" /></button></li>)}</ul> : null}
    <SelectMenu label={`Add ${title.toLowerCase()}`} value="" onChange={add} placeholder={chosen.length ? `Add another ${title.toLowerCase().replace(/s$/, "")}` : `None yet — add a ${title.toLowerCase().replace(/s$/, "")}`} searchable searchPlaceholder="Search by code or title" options={options.filter((option) => option.value && !chosen.includes(option.label))} />
  </SyllabusField>;
}

/** A syllabus keeps whatever it already says, even if the list no longer offers it. */
function withCurrent(values: string[], current: string): SelectOption[] {
  const all = current && !values.includes(current) ? [current, ...values] : values;
  return all.map((value) => ({ value, label: value }));
}

/**
 * The contact hours, as the document will print them: added up from the course schedule's
 * sessions, so they are read here and changed there (no boxes since 10 Nov 2026).
 */
function ContactHours({ hours, onOpenSchedule, className = "" }: { hours: Partial<Record<(typeof CONTACT_HOUR_ROWS)[number], string>>; onOpenSchedule?: () => void; className?: string }) {
  const rows = CONTACT_HOUR_ROWS.flatMap((row) => (hours[row] ? [{ row, value: hours[row] as string }] : []));
  const total = rows.reduce((sum, { value }) => sum + (Number(value) || 0), 0);
  return <div className={`grid content-start gap-1 text-sm font-medium text-[#344054] ${className}`}>
    <span className="sm:whitespace-nowrap">Course contact hours<span className="ml-1 font-normal text-[#475467]">from the course schedule</span></span>
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[#d5dbe4] bg-[#f1f4f8] px-3 py-2 font-normal text-[#475467]">
      {rows.length
        ? <><span className="flex flex-wrap gap-x-3 gap-y-1">{rows.map(({ row, value }) => <span key={row}>{row} <span className="font-semibold tabular-nums text-[#344054]">{value} h</span></span>)}</span><span className="text-[#667085]" aria-hidden="true">·</span><span>In all <span className="font-semibold tabular-nums text-[#344054]">{Number(total.toFixed(2))} h</span></span></>
        : <span>None yet: give each session a length in the course schedule.</span>}
      {onOpenSchedule ? <button type="button" onClick={onOpenSchedule} className="ml-auto rounded px-1 font-semibold text-[#1f4e79] hover:underline">Edit in the course schedule</button> : null}
    </div>
  </div>;
}
