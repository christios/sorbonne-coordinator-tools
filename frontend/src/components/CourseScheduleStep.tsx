import { Loader2 } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid } from "@/components/CourseScheduleGrid";
import {
  componentsOf,
  figure,
  hoursLaidOut,
  hoursWords,
  layoutWords,
  type CoursePlan,
  type CoursePlanSemester,
  type Layout,
} from "@/services/coursePlans";

/** What the step sends: each course the teacher leads, its weeks and its note. */
export type CourseLayouts = { courseCode: string; weeks: Layout; note: string }[];

/** "Elements of Calculus" after the code, when the course has a title. */
const named = (course: Pick<CoursePlan, "courseCode" | "title">) => (course.title ? `${course.courseCode} · ${course.title}` : course.courseCode);

/**
 * A course lead's step of the preferences request: the sessions of each course they lead,
 * week by week, within the hours the coordinators set.
 *
 * Only a teacher who leads a course that semester sees it, as only a full-timer sees their
 * hour reductions. The totals are the coordinators': the lead spreads them, and says in the
 * note when one looks wrong.
 */
export function CourseScheduleStep({
  step,
  semesterName,
  busy,
  error,
  onSave,
  onSkip,
}: {
  step: CoursePlanSemester;
  semesterName: string;
  busy: boolean;
  error: string;
  onSave: (courses: CourseLayouts) => void;
  /** On to the preferences without saving: the coordinators see the course as not laid out yet. */
  onSkip?: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { weeks: Layout; note: string }>>(() =>
    Object.fromEntries(step.courses.map((course) => [course.courseCode, { weeks: course.weeks, note: course.note }])),
  );
  const change = (code: string, patch: Partial<{ weeks: Layout; note: string }>) =>
    setDrafts((current) => ({ ...current, [code]: { ...current[code], ...patch } }));
  const many = step.courses.length > 1;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[#171717]">
          {many ? "Your courses" : "Your course"}, week by week{semesterName ? ` in ${semesterName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-[#475467]">
          You lead {many ? `${step.courses.length} courses` : "this course"} this semester. In each week, put the number of
          sessions, not hours: the hours they make show under each box. The coordinators set the total hours: if one
          looks wrong, say so in the note.
        </p>
      </div>

      {!step.weeks.length ? (
        <p role="status" className="rounded-md bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]">
          The semester&rsquo;s teaching weeks aren&rsquo;t set yet, so there is nothing to lay out for now. You can skip this
          step and come back to it.
        </p>
      ) : null}

      {step.courses.map((course) => {
        const draft = drafts[course.courseCode] ?? { weeks: {}, note: "" };
        const components = componentsOf(course);
        return (
          <section key={course.courseCode} aria-label={course.courseCode} className="space-y-3 rounded-lg border border-[#d0d5dd] px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#171717]">{named(course)}</h3>
              <span className="text-xs text-[#475467]">
                {components.length
                  ? components.map((component) => `${component} ${hoursWords(component, course.components[component])}`).join(" · ")
                  : null}
              </span>
            </div>
            {!components.length ? (
              <p className="text-sm text-[#667085]">
                The coordinators haven&rsquo;t set this course&rsquo;s hours yet, so there is nothing to lay out. You can still
                leave them a note.
              </p>
            ) : step.weeks.length ? (
              <CourseScheduleGrid
                plan={course}
                weeks={step.weeks}
                layout={draft.weeks}
                label={`${course.courseCode} sessions week by week`}
                onChange={(weeks) => change(course.courseCode, { weeks })}
              />
            ) : null}
            <label className="block text-sm font-semibold text-[#344054]">
              Note for the coordinators <span className="font-normal text-[#667085]">(optional)</span>
              <textarea
                aria-label={`Note about ${course.courseCode}`}
                value={draft.note}
                onChange={(event) => change(course.courseCode, { note: event.target.value })}
                rows={2}
                maxLength={2000}
                placeholder="For example: the TD needs 24 h, not 21, to cover the syllabus."
                className="mt-1.5 block w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal"
              />
            </label>
          </section>
        );
      })}

      {error ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {onSkip ? (
          <button type="button" onClick={onSkip} className="text-sm font-semibold text-[#1f4e79] underline">
            Skip for now
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSave(step.courses.map((course) => ({ courseCode: course.courseCode, ...(drafts[course.courseCode] ?? { weeks: {}, note: "" }) })))
          }
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          Save and go on to your preferences
        </button>
      </div>
    </div>
  );
}

/** One course's weeks in a line per component: "TD · Weeks 2–14 · 21 of 21 h". */
export function CourseLayoutLines({ course }: { course: CoursePlan }) {
  const components = componentsOf(course);
  if (!components.length) return <p className="text-sm text-[#667085]">No hours set yet.</p>;
  return (
    <ul className="space-y-0.5 text-sm text-[#344054]">
      {components.map((component) => {
        const done = hoursLaidOut(course, course.weeks, component);
        const target = course.components[component].hours ?? 0;
        const met = Math.abs(done - target) < 0.01;
        return (
          <li key={component}>
            <b>{component}</b> · {layoutWords(course.weeks[component])} ·{" "}
            <span className={met ? "text-[#2e7d55]" : "font-semibold text-[#8a6116]"}>
              {figure(done)} of {figure(target)} h
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The courses as laid out, to read: what was sent, with a way back to the step. */
export function CourseScheduleSummary({ step, onChange }: { step: CoursePlanSemester; onChange?: () => void }) {
  return (
    <section className="rounded-lg border border-[#d0d5dd] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#171717]">{step.courses.length > 1 ? "Your courses, week by week" : "Your course, week by week"}</h3>
        {onChange ? (
          <button type="button" onClick={onChange} className="text-xs font-semibold text-[#1f4e79] underline">
            Change
          </button>
        ) : null}
      </div>
      <div className="mt-1.5 space-y-2">
        {step.courses.map((course) => (
          <div key={course.courseCode}>
            <p className="text-sm font-semibold text-[#344054]">{named(course)}</p>
            {course.answeredAt ? <CourseLayoutLines course={course} /> : <p className="text-sm text-[#667085]">Not laid out yet.</p>}
            {course.note ? <p className="mt-0.5 text-sm italic text-[#475467]">&ldquo;{course.note}&rdquo;</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
