import { AlertTriangle, Clock3, Hash, Loader2, MessageSquareText, Target } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid } from "@/components/CourseScheduleGrid";
import { HowTo } from "@/components/HowTo";
import {
  componentsOf,
  hoursWords,
  laidOut,
  spreadEvenly,
  unevenComponents,
  type CoursePlan,
  type CoursePlanSemester,
  type Layout,
  type Lengths,
} from "@/services/coursePlans";

/**
 * What the step sends: each course the teacher leads, its weeks, the weeks of another length,
 * its note, and why its weeks run unevenly — "" when they don't.
 */
export type CourseLayouts = { courseCode: string; weeks: Layout; lengths: Lengths; note: string; paceReason: string }[];

type Draft = { weeks: Layout; lengths: Lengths; note: string; paceReason: string };
const EMPTY: Draft = { weeks: {}, lengths: {}, note: "", paceReason: "" };

/**
 * A course as the step opens it: as the lead left it, or — never laid out — already spread
 * evenly over the semester (23 Nov 2026), so the even layout is the one to change rather than
 * one to build. Nothing is saved until the lead saves the step.
 */
function opening(course: CoursePlan, weeks: number[]): Draft & { spread: boolean } {
  const kept = { weeks: course.weeks, lengths: course.lengths ?? {}, note: course.note, paceReason: course.paceReason ?? "" };
  if (laidOut(course.weeks) || !weeks.length) return { ...kept, spread: false };
  const spread: Layout = {};
  for (const component of componentsOf(course)) {
    const held = course.components[component];
    const even = spreadEvenly(held.hours ?? 0, held.length ?? 0, weeks);
    if (Object.keys(even).length) spread[component] = even;
  }
  return Object.keys(spread).length ? { ...kept, weeks: spread, lengths: {}, spread: true } : { ...kept, spread: false };
}

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
  const numbers = step.weeks.map((week) => week.week);
  const [opened] = useState(() => Object.fromEntries(step.courses.map((course) => [course.courseCode, opening(course, numbers)])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      Object.entries(opened).map(([code, { weeks, lengths, note, paceReason }]) => [code, { weeks, lengths, note, paceReason }]),
    ),
  );
  /** Asked to say why, and hasn't: the courses whose reason box is ringed. */
  const [unsaid, setUnsaid] = useState<string[]>([]);
  const change = (code: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [code]: { ...current[code], ...patch } }));
  const many = step.courses.length > 1;
  /** A course's components whose weeks run unevenly, as its draft stands. */
  const unevenIn = (course: CoursePlan) => {
    const draft = drafts[course.courseCode] ?? EMPTY;
    return unevenComponents({ components: course.components, weeks: draft.weeks, lengths: draft.lengths }, numbers);
  };
  // Once said, or even again, a course is no longer asked about.
  const stillUnsaid = unsaid.filter((code) => {
    const course = step.courses.find((each) => each.courseCode === code);
    return course && unevenIn(course).length && !(drafts[code]?.paceReason ?? "").trim();
  });
  const save = () => {
    // An uneven course says why before the step is saved; an even one keeps no reason.
    const missing = step.courses
      .filter((course) => unevenIn(course).length && !(drafts[course.courseCode]?.paceReason ?? "").trim())
      .map((course) => course.courseCode);
    setUnsaid(missing);
    if (missing.length) {
      document.getElementById(`pace-reason-${missing[0]}`)?.focus();
      return;
    }
    onSave(
      step.courses.map((course) => {
        const draft = drafts[course.courseCode] ?? EMPTY;
        return { courseCode: course.courseCode, ...draft, paceReason: unevenIn(course).length ? draft.paceReason.trim() : "" };
      }),
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[#171717]">
          {many ? "Your courses" : "Your course"}, week by week{semesterName ? ` in ${semesterName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-[#475467]">You lead {many ? `${step.courses.length} courses` : "this course"} this semester.</p>
        {/* How the grid is filled, in the preferences week's own three steps (18 Nov 2026). */}
        <HowTo
          steps={[
            { icon: Hash, title: "Sessions in each week", hint: "Not hours: the hours show under each box" },
            { icon: Clock3, title: "A longer or shorter session?", hint: "Press the hours under its box to change it" },
            { icon: Target, title: "Reach each total", hint: "It turns green once the hours add up" },
          ]}
        >
          <div className="flex flex-col justify-center gap-0.5 rounded-lg border border-dashed border-[#e5c27a] bg-[#fdf9ee] px-3 py-2">
            <span className="text-[11px] text-[#8a6116]">A total looks wrong?</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8a6116]">
              <MessageSquareText size={12} aria-hidden="true" /> Say so in the note
            </span>
          </div>
        </HowTo>
      </div>

      {!step.weeks.length ? (
        <p role="status" className="rounded-md bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]">
          The semester&rsquo;s teaching weeks aren&rsquo;t set yet, so there is nothing to lay out for now. You can skip this
          step and come back to it.
        </p>
      ) : null}

      {step.courses.map((course) => {
        const draft = drafts[course.courseCode] ?? EMPTY;
        const components = componentsOf(course);
        const uneven = step.weeks.length ? unevenIn(course) : [];
        const asked = unsaid.includes(course.courseCode) && !draft.paceReason.trim();
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
              <>
                {opened[course.courseCode]?.spread ? (
                  <p className="text-xs text-[#475467]">
                    Filled in evenly to start with. Change the weeks that differ, like an exam week.
                  </p>
                ) : null}
                <CourseScheduleGrid
                  plan={course}
                  weeks={step.weeks}
                  value={draft}
                  label={`${course.courseCode} sessions week by week`}
                  hint={false}
                  onChange={(next) => change(course.courseCode, next)}
                />
              </>
            ) : null}
            {uneven.length ? (
              // Uneven stays possible: it costs a sentence, which the coordinators read.
              <label
                className={`block rounded-lg border px-3 py-2.5 text-sm font-semibold text-[#7a5410] ${
                  asked ? "border-[#b54708] bg-[#fef0c7]" : "border-[#e5b454] bg-[#fdf9ee]"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={14} aria-hidden="true" />
                  Why are the {uneven.join(" and ")} sessions bunched up?
                  <span className="font-normal text-[#8a6116]">(needed)</span>
                </span>
                <span className="mt-0.5 block text-xs font-normal text-[#8a6116]">
                  An even spread is easier for students and rooms. Say why, or even it out.
                </span>
                <textarea
                  id={`pace-reason-${course.courseCode}`}
                  aria-label={`Why ${course.courseCode} is spread unevenly`}
                  aria-invalid={asked || undefined}
                  value={draft.paceReason}
                  onChange={(event) => change(course.courseCode, { paceReason: event.target.value })}
                  rows={2}
                  maxLength={2000}
                  placeholder="For example: the lectures end in week 12, before the project weeks."
                  className="mt-1.5 block w-full rounded-md border border-[#d9b36a] bg-white px-3 py-2 text-sm font-normal text-[#171717]"
                />
              </label>
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

      {stillUnsaid.length ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          Say why {stillUnsaid.join(" and ")} {stillUnsaid.length === 1 ? "is" : "are"} bunched up, or even {stillUnsaid.length === 1 ? "it" : "them"} out.
        </p>
      ) : null}
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
          onClick={save}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
          Save and go on to your preferences
        </button>
      </div>
    </div>
  );
}
