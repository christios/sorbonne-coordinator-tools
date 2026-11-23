import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid, type ScheduleDraft } from "@/components/CourseScheduleGrid";
import { CourseWeeks } from "@/components/RequestSummary";
import { SelectMenu } from "@/components/SelectMenu";
import {
  COMPONENTS,
  COMPONENT_WORDS,
  answeredWords,
  changeCoursePlan,
  componentsOf,
  figure,
  layOutCourse,
  unevenComponents,
  type CoursePlan,
  type TeachingWeek,
} from "@/services/coursePlans";
import { fetchActiveTeachers } from "@/services/portalLists";

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
 * A course's CM, TD and TP hours and session lengths, as its rows and sections in Groups &
 * CRNs say them, and what stands in the way where they can't: "No session length in Groups &
 * CRNs yet".
 */
export function PlanHours({ plan }: { plan: CoursePlan }) {
  return (
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
              {held.hours ? <b className="font-semibold text-[#171717]">{figure(held.hours)} h</b> : <span className="text-[#98a2b3]">—</span>}
              {held.length ? <span className="text-[#667085]"> · sessions of {figure(held.length)} h</span> : null}
              {held.hours && held.source ? (
                <span className="block text-[11px] text-[#98a2b3]">
                  {held.source === "asks" ? "from what the course asks" : "from its sections, which agree"}
                </span>
              ) : null}
              {held.issue ? <span className="block text-xs font-semibold text-[#8a6116]">{held.issue}</span> : null}
              {held.exceptions?.length ? (
                // Sections with their own figure: kept, and said, never blocking.
                <span className="block text-xs font-semibold text-[#8a6116]">{held.exceptions.join(" · ")}</span>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The course's lead, picked from the semester's teachers; they lay its weeks out in their request. */
export function CourseLeadPicker({ term, plan, semesterName }: { term: string; plan: CoursePlan; semesterName: string }) {
  const client = useQueryClient();
  const teachers = useQuery({ queryKey: ["active-teachers", term], queryFn: () => fetchActiveTeachers(term), enabled: Boolean(term) });
  const pickLead = useMutation({
    mutationFn: (leadId: string) => changeCoursePlan(term, plan.courseCode, { leadId }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["course-plans"] }),
  });
  const options = [
    { value: "", label: "Nobody yet" },
    ...(teachers.data ?? [])
      .map((teacher) => ({ value: teacher.id, label: teacher.fullName || teacher.email || teacher.id, searchText: teacher.email }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  if (plan.leadId && !options.some((option) => option.value === plan.leadId)) {
    options.push({ value: plan.leadId, label: plan.leadName || "A teacher not active this semester", searchText: "" });
  }
  return (
    <div>
      <SelectMenu
        label={`Lead of ${plan.courseCode}`}
        value={plan.leadId}
        onChange={(value) => pickLead.mutate(value)}
        searchable
        disabled={pickLead.isPending}
        placeholder="Nobody yet"
        options={options}
      />
      {pickLead.error ? <p role="alert" className="mt-1 text-xs text-[#a6292f]">{(pickLead.error as Error).message}</p> : null}
      <p className="mt-1.5 text-xs text-[#667085]">
        They lay the weeks out in their Timetable preferences request. Chosen from the teachers active in {semesterName || "the semester"}.
      </p>
    </div>
  );
}

/**
 * A course's plan, set from its record when the record is opened from Groups & CRNs (user,
 * 23 Nov 2026: "fold this part into some preview at the course level"): the hours its sets
 * ask for, read; the lead, picked; and the weeks, filled in for the lead. The record may set
 * the hours and the lead above it, in which case it shows the weeks alone.
 */
export function CoursePlanEditor({
  term,
  plan,
  weeks,
  semesterName,
  hoursAbove = false,
  leadAbove = false,
}: {
  term: string;
  plan: CoursePlan;
  weeks: TeachingWeek[];
  semesterName: string;
  /** The hours are set just above, so they aren't said again here. */
  hoursAbove?: boolean;
  /** So is the lead. */
  leadAbove?: boolean;
}) {
  const client = useQueryClient();
  const saved = () => void client.invalidateQueries({ queryKey: ["course-plans"] });
  return (
    <div className="space-y-3">
      {hoursAbove && leadAbove ? null : (
        <div className={`grid gap-4 ${hoursAbove || leadAbove ? "" : "sm:grid-cols-2"}`}>
          {hoursAbove ? null : (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#344054]">Hours, from Groups &amp; CRNs</p>
              <PlanHours plan={plan} />
            </div>
          )}
          {leadAbove ? null : (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-[#344054]">Course lead</p>
              <CourseLeadPicker term={term} plan={plan} semesterName={semesterName} />
            </div>
          )}
        </div>
      )}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">Week by week</p>
        <CourseScheduleEditor key={`${plan.answeredAt}|${plan.hoursUpdatedAt}`} term={term} plan={plan} weeks={weeks} onSaved={saved} />
      </div>
    </div>
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
