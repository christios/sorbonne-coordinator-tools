import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid, type ScheduleDraft } from "@/components/CourseScheduleGrid";
import { CourseWeeks } from "@/components/RequestSummary";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import {
  COMPONENTS,
  COMPONENT_WORDS,
  answeredWords,
  componentsOf,
  figure,
  layOutCourse,
  unevenComponents,
  type CoursePlan,
  type TeachingWeek,
} from "@/services/coursePlans";

/** "18 Nov 2026". */
const dated = (value: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * A course's weeks, as its lead laid them out, for a coordinator — and filled in for the lead
 * from here, after a call or an email, the way a coordinator answers preferences for a teacher.
 */
export function CourseScheduleEditor({
  term,
  plan,
  weeks,
  onSaved,
}: {
  term: string;
  plan: CoursePlan;
  weeks: TeachingWeek[];
  onSaved: (plan: CoursePlan) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>({ weeks: plan.weeks, lengths: plan.lengths ?? {} });
  const [note, setNote] = useState(plan.note);
  const save = useMutation({
    mutationFn: () => layOutCourse(term, plan.courseCode, { ...draft, note }),
    onSuccess: (saved) => {
      setEditing(false);
      onSaved(saved);
    },
  });
  const components = componentsOf(plan);
  const start = () => {
    setDraft({ weeks: plan.weeks, lengths: plan.lengths ?? {} });
    setNote(plan.note);
    save.reset();
    setEditing(true);
  };

  if (!components.length) {
    return <p className="text-sm text-[#667085]">Set the course&rsquo;s hours first: the lead lays them out week by week.</p>;
  }
  if (!weeks.length) {
    return (
      <p className="text-sm text-[#8a6116]">
        The semester&rsquo;s teaching weeks aren&rsquo;t set yet. Set Week 1 and the number of weeks in the Semester plan&rsquo;s
        settings.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[#475467]">{answeredWords(plan)}</p>
        {!editing ? (
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            <Pencil size={12} aria-hidden="true" /> {plan.answeredAt ? "Change" : "Fill in for the lead"}
          </button>
        ) : null}
      </div>
      {editing ? (
        <p className="rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">
          You&rsquo;re laying out {plan.courseCode} for {plan.leadName || "its lead"}. It&rsquo;s kept as entered by you.
        </p>
      ) : null}
      <CourseScheduleGrid
        plan={plan}
        weeks={weeks}
        value={editing ? draft : { weeks: plan.weeks, lengths: plan.lengths ?? {} }}
        onChange={editing ? setDraft : undefined}
        label={`${plan.courseCode} sessions week by week`}
      />
      {editing ? (
        <>
          <label className="block text-sm font-semibold text-[#344054]">
            The lead&rsquo;s note
            <textarea
              aria-label={`Note about ${plan.courseCode}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 block w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal"
            />
          </label>
          {save.error ? <p role="alert" className="text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : "Save the weeks"}
            </button>
          </div>
        </>
      ) : plan.note ? (
        <p className="text-sm text-[#344054]">
          <span className="font-semibold">The lead&rsquo;s note:</span> <span className="italic">&ldquo;{plan.note}&rdquo;</span>
        </p>
      ) : null}
      {!editing && plan.paceReason && unevenComponents(plan, weeks.map((week) => week.week)).length ? (
        <p className="text-sm text-[#344054]">
          <span className="font-semibold text-[#8a6116]">Why it&rsquo;s uneven:</span>{" "}
          <span className="italic">&ldquo;{plan.paceReason}&rdquo;</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * One course's plan for a semester, for coordinators to read: its CM, TD and TP hours and how
 * long a session of each lasts, who leads it, and the weeks the lead laid out.
 *
 * Read only (23 Nov 2026): everything is set on the course's cards in Groups & CRNs — the
 * hours and session lengths on its course rows and sections, the lead and the weeks under each
 * card — and this window says so, and what stands in the way where Groups & CRNs can't say.
 */
export function CoursePlanDialog({
  semesterName,
  plan,
  weeks,
  onClose,
}: {
  term?: string;
  semesterName: string;
  plan: CoursePlan;
  weeks: TeachingWeek[];
  onClose: () => void;
}) {
  const components = componentsOf(plan);
  const numbers = weeks.map((week) => week.week);
  return (
    <Modal
      open
      size="wide"
      title={`${plan.courseCode}${plan.title ? ` · ${plan.title}` : ""}`}
      description={`Course plan · ${semesterName}`}
      onClose={onClose}
    >
      <p className="mb-3 rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">
        Set on <b>Groups &amp; CRNs</b>: the hours and session lengths on the course&rsquo;s rows and sections, and the lead and
        the weeks under each of its cards.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Hours" className="rounded-lg border border-[#e4e8ef] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-[#171717]">Hours</h3>
            <InfoTip label="About the hours">
              The course&rsquo;s hours this semester, TD and TP for each group, and how long one session lasts, as its rows and
              sections in Groups &amp; CRNs say them. The lead lays them out week by week and can&rsquo;t change them; they can say in
              a note that one looks wrong.
            </InfoTip>
          </div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 text-sm">
            {COMPONENTS.map((component) => {
              const held = plan.components[component];
              return (
                <div key={component} className="contents">
                  <dt className="text-[#344054]">
                    {COMPONENT_WORDS[component]}
                    {component === "CM" ? null : <span className="block text-[11px] text-[#667085]">each group</span>}
                  </dt>
                  <dd className="text-right tabular-nums">
                    {held.hours ? (
                      <b className="font-semibold text-[#171717]">{figure(held.hours)} h</b>
                    ) : (
                      <span className="text-[#98a2b3]">—</span>
                    )}
                    {held.length ? <span className="text-[#667085]"> · sessions of {figure(held.length)} h</span> : null}
                    {held.issue ? <span className="block text-xs font-semibold text-[#8a6116]">{held.issue}</span> : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>

        <section aria-label="Course lead" className="rounded-lg border border-[#e4e8ef] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-[#171717]">Course lead</h3>
            <InfoTip label="About the course lead">
              The teacher who lays the course&rsquo;s weeks out, one a semester, picked under the course&rsquo;s cards in Groups &amp;
              CRNs. They are asked in their Timetable preferences request, in a step only course leads see.
            </InfoTip>
          </div>
          <p className="text-sm font-semibold text-[#171717]">{plan.leadName || <span className="font-normal text-[#98a2b3]">Nobody yet</span>}</p>
          <p className="mt-1 text-xs text-[#667085]">
            {plan.leadSetAt && plan.leadId ? `Picked by ${plan.leadSetBy || "a coordinator"} on ${dated(plan.leadSetAt)}.` : ""}
          </p>
        </section>
      </div>

      <section aria-label="Week by week" className="mt-4 rounded-lg border border-[#e4e8ef] px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Week by week</h3>
        {!components.length ? (
          <p className="text-sm text-[#667085]">No hours in Groups &amp; CRNs yet: the lead lays them out once there are.</p>
        ) : !weeks.length ? (
          <p className="text-sm text-[#8a6116]">
            The semester&rsquo;s teaching weeks aren&rsquo;t set yet. Set Week 1 and the number of weeks in the Semester plan&rsquo;s
            settings.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-[#475467]">{answeredWords(plan)}</p>
            <CourseScheduleGrid
              plan={plan}
              weeks={weeks}
              value={{ weeks: plan.weeks, lengths: plan.lengths ?? {} }}
              label={`${plan.courseCode} sessions week by week`}
            />
            {plan.note ? (
              <p className="text-sm text-[#344054]">
                <span className="font-semibold">The lead&rsquo;s note:</span> <span className="italic">&ldquo;{plan.note}&rdquo;</span>
              </p>
            ) : null}
            {plan.paceReason && unevenComponents(plan, numbers).length ? (
              <p className="text-sm text-[#344054]">
                <span className="font-semibold text-[#8a6116]">Why it&rsquo;s uneven:</span>{" "}
                <span className="italic">&ldquo;{plan.paceReason}&rdquo;</span>
              </p>
            ) : null}
          </div>
        )}
      </section>
    </Modal>
  );
}

/** A course's plan at a glance, for its record: its weeks and hours, its lead and where the weeks stand. */
export function CoursePlanLines({ plan, weeks }: { plan: CoursePlan; weeks: TeachingWeek[] }) {
  return (
    <div className="space-y-2 text-sm">
      {weeks.length ? <CourseWeeks course={plan} weeks={weeks} /> : null}
      <p className="text-xs text-[#667085]">
        Lead: {plan.leadName || "nobody yet"} · {answeredWords(plan)}
      </p>
    </div>
  );
}
