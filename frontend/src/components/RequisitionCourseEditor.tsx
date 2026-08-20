import { AddEntryButton } from "@/components/AddEntryButton";
import { ArrowDownUp, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CollapsibleEntryCard } from "@/components/CollapsibleEntryCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { SelectMenu } from "@/components/SelectMenu";
import { CourseRow } from "@/services/requisitions";
import { CourseCatalogueEntry } from "@/services/teachers";

type Props = {
  courses: CourseRow[];
  onChange: (courses: CourseRow[]) => void;
  catalogueCourses?: CourseCatalogueEntry[];
};

const LEVELS = ["Foundation Year", "L1", "L2", "L3", "M1", "M2", "Option Class"];

export function RequisitionCourseEditor({ courses, onChange, catalogueCourses = [] }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(() => courses.find((course) => !isComplete(course))?.id ?? null);
  const [movingCourseId, setMovingCourseId] = useState<string | null>(null);
  const [coursePendingRemoval, setCoursePendingRemoval] = useState<string | null>(null);
  const [moveQuery, setMoveQuery] = useState("");

  useEffect(() => {
    setExpandedId((current) => current && courses.some((course) => course.id === current) ? current : courses.find((course) => !isComplete(course))?.id ?? null);
  }, [courses]);

  useEffect(() => {
    if (!movingCourseId) return;
    const close = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-course-move-menu]")) {
        setMovingCourseId(null);
        setMoveQuery("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMovingCourseId(null);
        setMoveQuery("");
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("focusin", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [movingCourseId]);

  const toggle = (id: string) => setExpandedId((current) => current === id ? null : id);
  const update = (id: string, patch: Partial<CourseRow>) => onChange(courses.map((course) => course.id === id ? { ...course, ...patch } : course));
  const add = () => {
    const course = emptyCourse();
    onChange([...courses, course]);
    setExpandedId(course.id);
    window.requestAnimationFrame(() => document.getElementById(`course-${course.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  const chooseFromCatalogue = (courseId: string, catalogueId: string) => {
    const entry = catalogueCourses.find((course) => course.id === catalogueId);
    if (!entry) return;
    onChange(courses.map((course) => course.id === courseId ? catalogueCourse(entry, course.id) : course));
  };
  const moveBefore = (sourceId: string, destinationId?: string) => {
    const source = courses.find((course) => course.id === sourceId);
    if (!source) return;
    const withoutSource = courses.filter((course) => course.id !== sourceId);
    const destinationIndex = destinationId ? withoutSource.findIndex((course) => course.id === destinationId) : withoutSource.length;
    onChange([...withoutSource.slice(0, destinationIndex), source, ...withoutSource.slice(destinationIndex)]);
    setMovingCourseId(null);
    setMoveQuery("");
  };
  const pendingCourse = courses.find((course) => course.id === coursePendingRemoval);

  return (
    <section>
      <h3 className="text-lg font-semibold text-[#171717]">Teaching load</h3>
      {courses.length ? <div className="mt-4 grid gap-3">{courses.map((course) => {
        const expanded = expandedId === course.id;
        const title = course.title.trim() || "Untitled course";
        const destinations = courses.filter((item) => item.id !== course.id && courseSummary(item).toLowerCase().includes(moveQuery.toLowerCase()));
        return <CollapsibleEntryCard key={course.id} id={`course-${course.id}`} expanded={expanded} onToggle={() => toggle(course.id)} toggleLabel={`${expanded ? "Collapse" : "Expand"} course: ${title}`} title={title} summary={courseSummary(course)} actions={<div data-course-move-menu className="contents"><button type="button" onClick={() => { setMovingCourseId(course.id); setMoveQuery(""); }} className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]" aria-label={`Move course: ${title}`} title="Move course"><ArrowDownUp size={17} /></button><button type="button" onClick={() => setCoursePendingRemoval(course.id)} className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]" aria-label={`Remove course: ${title}`} title="Remove course"><Trash2 size={17} /></button></div>} overlay={movingCourseId === course.id ? <div data-course-move-menu className="absolute right-0 top-full z-[90] isolate mt-2 w-80 max-w-full rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"><p className="text-sm font-semibold text-[#344054]">Place this course before</p><input type="search" value={moveQuery} onChange={(event) => setMoveQuery(event.target.value)} placeholder="Search destination courses" className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" autoFocus /><div className="mt-2 max-h-56 overflow-y-auto">{destinations.map((destination) => <button type="button" key={destination.id} onClick={() => moveBefore(course.id, destination.id)} className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]">{courseSummary(destination)}</button>)}</div><button type="button" onClick={() => moveBefore(course.id)} className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Move to end</button></div> : null}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2"><SelectMenu label="Choose from course list" value={course.catalogCourseId ?? ""} onChange={(catalogueId) => chooseFromCatalogue(course.id, catalogueId)} disabled={!catalogueCourses.length} searchable searchPlaceholder="Search by title, code, or CRN" placeholder={catalogueCourses.length ? "Choose from course list" : "No imported courses available"} options={catalogueCourses.map((item) => ({ value: item.id, label: `${item.courseTitle} — ${item.courseCode}`, searchText: item.crn }))} /></div>
            {course.crn ? <p className="rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm text-[#475467] lg:col-span-2"><span className="font-semibold text-[#344054]">Course catalogue reference</span><span className="ml-2">CRN {course.crn}{course.courseCode ? ` · ${course.courseCode}` : ""}</span></p> : null}
            <TextField focusTarget={`course:${course.id}:title`} label="Course title as per Sorbonne Space" value={course.title} onChange={(title) => update(course.id, { title })} required />
            <TextField focusTarget={`course:${course.id}:subject-code`} label="Subject code" value={course.subjectCode} onChange={(subjectCode) => update(course.id, { subjectCode })} required />
            <TextField focusTarget={`course:${course.id}:course-number`} label="Course number" value={course.courseNumber} onChange={(courseNumber) => update(course.id, { courseNumber })} required />
            <div data-requisition-field={`course:${course.id}:level`} className="grid gap-1 text-sm font-medium text-[#344054]"><FormFieldLabel required>Level</FormFieldLabel><SelectMenu label="Level" value={course.level} onChange={(level) => update(course.id, { level })} placeholder="Select level" required options={LEVELS.map((level) => ({ value: level, label: level }))} /></div>
            <TextField focusTarget={`course:${course.id}:hours`} label="Hours" value={course.hours} onChange={(hours) => update(course.id, { hours })} hint="Use a number, or a number with a class-type suffix." required />
          </div>
        </CollapsibleEntryCard>;
      })}</div> : <p className="mt-4 rounded-md border border-dashed border-[#d0d5dd] px-3 py-4 text-sm text-[#667085]">No courses added yet.</p>}
      <div data-requisition-field="add-course"><AddEntryButton onClick={add} label="Add course" /></div>
      <ConfirmDialog open={Boolean(pendingCourse)} title="Remove course?" description={`Remove ${pendingCourse?.title || "this course"} from this requisition?`} confirmLabel="Remove course" onClose={() => setCoursePendingRemoval(null)} onConfirm={() => { if (pendingCourse) onChange(courses.filter((course) => course.id !== pendingCourse.id)); setCoursePendingRemoval(null); }} />
    </section>
  );
}

function TextField({ focusTarget, label, value, onChange, hint, required = false }: { focusTarget?: string; label: string; value: string; onChange: (value: string) => void; hint?: string; required?: boolean }) {
  return <label data-requisition-field={focusTarget} className="grid gap-1 text-sm font-medium text-[#344054]"><FormFieldLabel required={required}>{label}</FormFieldLabel><input aria-label={label} required={required} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-[#b7bec8] px-3 py-2 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />{hint ? <span className="text-xs font-normal text-[#667085]">{hint}</span> : null}</label>;
}

function emptyCourse(): CourseRow {
  return { id: crypto.randomUUID(), subjectCode: "", courseNumber: "", level: "", title: "", hours: "" };
}

function catalogueCourse(entry: CourseCatalogueEntry, id: string = crypto.randomUUID()): CourseRow {
  const [subjectCode = entry.courseCode, courseNumber = ""] = entry.courseCode.split(/-(.+)/);
  return {
    id,
    catalogCourseId: entry.id,
    crn: entry.crn,
    courseCode: entry.courseCode,
    subjectCode,
    courseNumber,
    level: entry.level,
    title: entry.courseTitle,
    hours: entry.contactHours,
  };
}

function isComplete(course: CourseRow) {
  return Boolean(course.subjectCode && course.courseNumber && course.level && course.title && course.hours);
}

function courseSummary(course: CourseRow) {
  return [course.subjectCode && course.courseNumber ? `${course.subjectCode} ${course.courseNumber}` : "Code not set", course.level || "Level not set", course.hours ? `${course.hours} hours` : "Hours not set"].filter(Boolean).join(" · ");
}
