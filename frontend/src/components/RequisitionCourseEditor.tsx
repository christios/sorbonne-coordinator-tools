import { AddEntryButton } from "@/components/AddEntryButton";
import { ArrowDownUp, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

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
  /**
   * Teaching, or admin work paid on the same requisition. The editor is the same one; an
   * admin entry needs only what the work is and its hours — invigilation or coordinating
   * a course has no class type, and often no course behind it at all.
   */
  kind?: "teaching" | "admin";
  /** Beside the heading, on its right: the step's total. */
  headingAside?: ReactNode;
};

/** What changes between teaching and admin: the words, and which fields must be filled. */
const KINDS = {
  teaching: {
    heading: "Teaching load",
    prefix: "course",
    noun: "course",
    untitled: "Untitled course",
    empty: "No courses added yet.",
    add: "Add course",
    titleLabel: "Course title as per Sorbonne Space",
    hoursProblem: "Use a number; choose the class type separately.",
  },
  admin: {
    heading: "Admin hours",
    prefix: "admin",
    noun: "admin entry",
    untitled: "Untitled admin entry",
    empty: "No admin hours added yet.",
    add: "Add admin hours",
    titleLabel: "What the work is",
    hoursProblem: "Use a number.",
  },
} as const;

const LEVELS = [
  "Foundation Year",
  "L1",
  "L2",
  "L3",
  "M1",
  "M2",
  "Option Class",
];
const CLASS_TYPES = ["CM", "TD", "TP", "Coach", "Not Applicable"];

export function RequisitionCourseEditor({
  courses,
  onChange,
  catalogueCourses = [],
  kind = "teaching",
  headingAside,
}: Props) {
  const words = KINDS[kind];
  const admin = kind === "admin";
  const isComplete = (course: CourseRow) => (admin ? Boolean(course.title && course.hours) : isCompleteCourse(course));
  const [expandedId, setExpandedId] = useState<string | null>(
    () => courses.find((course) => !isComplete(course))?.id ?? null,
  );
  /*
   * The entry just added, before anything is written in it.
   *
   * It lives here and not in the requisition until its first keystroke. Added straight to
   * the requisition, an empty entry was saved at once as "Untitled admin entry" and then
   * held the export up as a required field left blank — for something nobody had begun.
   * Discarding it now leaves nothing behind, and one that is never touched never existed.
   */
  const [pending, setPending] = useState<CourseRow | null>(null);
  const [movingCourseId, setMovingCourseId] = useState<string | null>(null);
  const [coursePendingRemoval, setCoursePendingRemoval] = useState<
    string | null
  >(null);
  const [moveQuery, setMoveQuery] = useState("");

  useEffect(() => {
    setExpandedId((current) =>
      current && courses.some((course) => course.id === current)
        ? current
        : (courses.find((course) => !isComplete(course))?.id ?? null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses]);

  useEffect(() => {
    if (!movingCourseId) return;
    const close = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("[data-course-move-menu]")
      ) {
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

  const toggle = (id: string) =>
    setExpandedId((current) => (current === id ? null : id));
  /** The first change to the new entry is what adds it to the requisition. */
  const commit = (entry: CourseRow) => {
    setPending(null);
    setExpandedId(entry.id);
    onChange([...courses, entry]);
  };
  const update = (id: string, patch: Partial<CourseRow>) => {
    if (pending?.id === id) {
      commit({ ...pending, ...patch });
      return;
    }
    onChange(
      courses.map((course) =>
        course.id === id ? { ...course, ...patch } : course,
      ),
    );
  };
  const focusTitle = (id: string) =>
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`${words.prefix}-${id}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card
        ?.querySelector<HTMLInputElement>(`[data-requisition-field="${words.prefix}:${id}:title"] input`)
        ?.focus({ preventScroll: true });
    });
  const add = () => {
    // One new entry at a time: pressing again goes back to the one still empty.
    if (pending) {
      focusTitle(pending.id);
      return;
    }
    const course = emptyCourse();
    setPending(course);
    setExpandedId(null);
    focusTitle(course.id);
  };
  const chooseFromCatalogue = (courseId: string, catalogueId: string) => {
    const entry = catalogueCourses.find((course) => course.id === catalogueId);
    if (!entry) return;
    if (pending?.id === courseId) {
      commit(catalogueCourse(entry, courseId));
      return;
    }
    onChange(
      courses.map((course) =>
        course.id === courseId ? catalogueCourse(entry, course.id) : course,
      ),
    );
  };
  const moveBefore = (sourceId: string, destinationId?: string) => {
    const source = courses.find((course) => course.id === sourceId);
    if (!source) return;
    const withoutSource = courses.filter((course) => course.id !== sourceId);
    const destinationIndex = destinationId
      ? withoutSource.findIndex((course) => course.id === destinationId)
      : withoutSource.length;
    onChange([
      ...withoutSource.slice(0, destinationIndex),
      source,
      ...withoutSource.slice(destinationIndex),
    ]);
    setMovingCourseId(null);
    setMoveQuery("");
  };
  const remove = (course: CourseRow) => {
    // Nothing in it to lose, so nothing to ask about.
    if (isBlank(course)) onChange(courses.filter((item) => item.id !== course.id));
    else setCoursePendingRemoval(course.id);
  };
  const pendingCourse = courses.find(
    (course) => course.id === coursePendingRemoval,
  );
  const shown = pending ? [...courses, pending] : courses;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-lg font-semibold text-[#171717]">{words.heading}</h3>
        {headingAside}
      </div>
      {shown.length ? (
        <div className="mt-4 grid gap-3">
          {shown.map((course) => {
            const isNew = course.id === pending?.id;
            const expanded = isNew || expandedId === course.id;
            const title = course.title.trim() || words.untitled;
            const destinations = courses.filter(
              (item) =>
                item.id !== course.id &&
                courseSummary(item)
                  .toLowerCase()
                  .includes(moveQuery.toLowerCase()),
            );
            return (
              <CollapsibleEntryCard
                key={course.id}
                id={`${words.prefix}-${course.id}`}
                expanded={expanded}
                onToggle={() => (isNew ? setPending(null) : toggle(course.id))}
                toggleLabel={
                  isNew
                    ? `Discard new ${words.noun}`
                    : `${expanded ? "Collapse" : "Expand"} ${words.noun}: ${title}`
                }
                title={title}
                summary={isNew ? "New · not saved until something is filled in" : courseSummary(course)}
                actions={
                  isNew ? (
                    <button
                      type="button"
                      onClick={() => setPending(null)}
                      className="rounded-md border border-[#d0d5dd] bg-white px-2.5 py-1 text-sm font-semibold text-[#475467] hover:bg-[#f7f8fa]"
                    >
                      Discard
                    </button>
                  ) : (
                    <div data-course-move-menu className="contents">
                      <button
                        type="button"
                        onClick={() => {
                          setMovingCourseId(course.id);
                          setMoveQuery("");
                        }}
                        className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]"
                        aria-label={`Move ${words.noun}: ${title}`}
                        title={`Move ${words.noun}`}
                      >
                        <ArrowDownUp size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(course)}
                        className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]"
                        aria-label={`Remove ${words.noun}: ${title}`}
                        title={`Remove ${words.noun}`}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  )
                }
                overlay={
                  movingCourseId === course.id ? (
                    <div
                      data-course-move-menu
                      className="absolute right-0 top-full z-[90] isolate mt-2 w-80 max-w-full rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"
                    >
                      <p className="text-sm font-semibold text-[#344054]">
                        Place this {words.noun} before
                      </p>
                      <input
                        type="search"
                        value={moveQuery}
                        onChange={(event) => setMoveQuery(event.target.value)}
                        placeholder="Search destination courses"
                        className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
                        autoFocus
                      />
                      <div className="mt-2 max-h-56 overflow-y-auto">
                        {destinations.map((destination) => (
                          <button
                            type="button"
                            key={destination.id}
                            onClick={() =>
                              moveBefore(course.id, destination.id)
                            }
                            className="block w-full rounded-md px-3 py-2 text-left text-sm text-[#344054] hover:bg-[#f7f8fa]"
                          >
                            {courseSummary(destination)}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => moveBefore(course.id)}
                        className="mt-2 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-left text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                      >
                        Move to end
                      </button>
                    </div>
                  ) : null
                }
              >
                {/*
                  * Two columns of equal cells, each field the full width of its cell and
                  * every label on the same line as its neighbour's. `min-w-0` on the cells
                  * lets a long value shrink inside its field rather than widen the column.
                  */}
                <div className="grid items-start gap-x-4 gap-y-4 sm:grid-cols-2">
                  <div className="min-w-0 sm:col-span-2">
                    <SelectMenu
                      label="Choose from course list"
                      value={course.catalogCourseId ?? ""}
                      onChange={(catalogueId) =>
                        chooseFromCatalogue(course.id, catalogueId)
                      }
                      disabled={!catalogueCourses.length}
                      searchable
                      searchPlaceholder="Search by title, code, or CRN"
                      placeholder={
                        catalogueCourses.length
                          ? "Choose from course list"
                          : "No courses on the course list"
                      }
                      options={catalogueCourses.map((item) => ({
                        value: item.id,
                        label: `${item.courseTitle} — ${item.courseCode}`,
                        searchText: item.crn,
                      }))}
                    />
                  </div>
                  {course.crn ? (
                    <p className="rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm text-[#475467] sm:col-span-2">
                      <span className="font-semibold text-[#344054]">
                        Course catalogue reference
                      </span>
                      <span className="ml-2">
                        CRN {course.crn}
                        {course.courseCode ? ` · ${course.courseCode}` : ""}
                      </span>
                    </p>
                  ) : null}
                  <TextField
                    focusTarget={`${words.prefix}:${course.id}:title`}
                    label={words.titleLabel}
                    value={course.title}
                    onChange={(title) => update(course.id, { title })}
                    autoFocus={isNew}
                    required
                  />
                  <TextField
                    focusTarget={`${words.prefix}:${course.id}:hours`}
                    label="Hours"
                    value={course.hours}
                    onChange={(hours) => update(course.id, { hours })}
                    inputMode="decimal"
                    problem={
                      course.hours.trim() && !PLAIN_NUMBER.test(course.hours.trim())
                        ? words.hoursProblem
                        : undefined
                    }
                    required
                  />
                  <TextField
                    focusTarget={`${words.prefix}:${course.id}:subject-code`}
                    label="Subject code"
                    value={course.subjectCode}
                    onChange={(subjectCode) =>
                      update(course.id, { subjectCode })
                    }
                    required={!admin}
                  />
                  <TextField
                    focusTarget={`${words.prefix}:${course.id}:course-number`}
                    label="Course number"
                    value={course.courseNumber}
                    onChange={(courseNumber) =>
                      update(course.id, { courseNumber })
                    }
                    required={!admin}
                  />
                  <CourseSelectField
                    focusTarget={`${words.prefix}:${course.id}:level`}
                    fieldKey={admin ? "admin.level" : "courses.level"}
                    label="Level"
                    value={course.level}
                    onChange={(level) => update(course.id, { level })}
                    options={LEVELS}
                    required={!admin}
                  />
                  {admin ? null : (
                    <CourseSelectField
                      focusTarget={`course:${course.id}:class-type`}
                      fieldKey="courses.classType"
                      label="Course class type"
                      value={course.classType ?? legacyClassType(course.hours)}
                      onChange={(classType) => update(course.id, { classType })}
                      options={CLASS_TYPES}
                    />
                  )}
                </div>
              </CollapsibleEntryCard>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-[#d0d5dd] px-3 py-4 text-sm text-[#667085]">
          {words.empty}
        </p>
      )}
      <div data-requisition-field={`add-${words.prefix}`}>
        <AddEntryButton onClick={add} label={words.add} />
      </div>
      <ConfirmDialog
        open={Boolean(pendingCourse)}
        title={`Remove ${words.noun}?`}
        description={`Remove ${pendingCourse?.title || `this ${words.noun}`} from this requisition?`}
        confirmLabel={`Remove ${words.noun}`}
        onClose={() => setCoursePendingRemoval(null)}
        onConfirm={() => {
          if (pendingCourse)
            onChange(
              courses.filter((course) => course.id !== pendingCourse.id),
            );
          setCoursePendingRemoval(null);
        }}
      />
    </section>
  );
}

/** "24", "1.5", "2,5": what the hours field takes. Anything else is said under it. */
const PLAIN_NUMBER = /^\d+(?:[.,]\d+)?$/;

function CourseSelectField({
  focusTarget,
  fieldKey,
  label,
  value,
  onChange,
  options,
  required = true,
}: {
  focusTarget: string;
  fieldKey: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <div
      data-requisition-field={focusTarget}
      className="grid min-w-0 gap-1 text-sm font-medium text-[#344054]"
    >
      <FormFieldLabel required={required} fieldKey={fieldKey}>
        {label}
      </FormFieldLabel>
      <SelectMenu
        label={label}
        value={value}
        onChange={onChange}
        placeholder={`Select ${label.toLowerCase()}`}
        required={required}
        options={options.map((option) => ({ value: option, label: option }))}
      />
    </div>
  );
}

function TextField({
  focusTarget,
  label,
  value,
  onChange,
  problem,
  required = false,
  autoFocus = false,
  inputMode,
}: {
  focusTarget?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What is wrong with the value, said only while it is wrong. */
  problem?: string;
  required?: boolean;
  autoFocus?: boolean;
  inputMode?: "decimal" | "text";
}) {
  return (
    <label
      data-requisition-field={focusTarget}
      className="grid min-w-0 gap-1 text-sm font-medium text-[#344054]"
    >
      {/*
        * Keyed on which field this is, never on which course row it sits in. With the
        * row's id in the key, guidance written on the first course was invisible on the
        * second one of the same requisition — and on a row with no focus target at all
        * the key came out as "courses.undefined.undefined".
        */}
      <FormFieldLabel
        required={required}
        fieldKey={
          focusTarget
            ? `${focusTarget.startsWith("admin:") ? "admin" : "courses"}.${focusTarget.split(":")[2]}`
            : undefined
        }
      >
        {label}
      </FormFieldLabel>
      <input
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        required={required}
        autoFocus={autoFocus}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-10 w-full min-w-0 rounded-md border px-3 py-2 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${
          problem ? "border-[#e0a526]" : "border-[#b7bec8]"
        }`}
      />
      {problem ? (
        <span className="text-xs font-normal text-[#8a6116]">{problem}</span>
      ) : null}
    </label>
  );
}

function emptyCourse(): CourseRow {
  return {
    id: crypto.randomUUID(),
    subjectCode: "",
    courseNumber: "",
    level: "",
    title: "",
    hours: "",
    classType: "",
  };
}

/** An entry with nothing written in it at all. */
function isBlank(course: CourseRow) {
  return ![
    course.title,
    course.subjectCode,
    course.courseNumber,
    course.level,
    course.hours,
    course.classType ?? "",
    course.crn ?? "",
    course.catalogCourseId ?? "",
  ].some((value) => value.trim());
}

function catalogueCourse(
  entry: CourseCatalogueEntry,
  id: string = crypto.randomUUID(),
): CourseRow {
  const [subjectCode = entry.courseCode, courseNumber = ""] =
    entry.courseCode.split(/-(.+)/);
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
    classType: "",
  };
}

function isCompleteCourse(course: CourseRow) {
  return Boolean(
    course.subjectCode &&
    course.courseNumber &&
    course.level &&
    course.title &&
    course.hours &&
    (course.classType || legacyClassType(course.hours)),
  );
}

function courseSummary(course: CourseRow) {
  const classType = course.classType || legacyClassType(course.hours);
  const hours = course.hours
    ? `${course.hours}${classType && !course.hours.toUpperCase().includes(classType) ? ` ${classType}` : ""} hours`
    : "Hours not set";
  return [
    course.subjectCode && course.courseNumber
      ? `${course.subjectCode} ${course.courseNumber}`
      : "Code not set",
    course.level || "Level not set",
    hours,
  ]
    .filter(Boolean)
    .join(" · ");
}

function legacyClassType(hours: string) {
  return /\b(CM|TD|TP|Coach|Not Applicable)\b/i.exec(hours)?.[1] ?? "";
}
