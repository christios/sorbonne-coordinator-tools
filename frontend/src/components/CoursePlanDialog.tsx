import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid, type ScheduleDraft } from "@/components/CourseScheduleGrid";
import { CourseWeeks } from "@/components/RequestSummary";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import {
  COMPONENTS,
  COMPONENT_WORDS,
  answeredWords,
  changeCoursePlan,
  componentsOf,
  layOutCourse,
  unevenComponents,
  type Component,
  type CoursePlan,
  type TeachingWeek,
} from "@/services/coursePlans";
import { fetchActiveTeachers } from "@/services/portalLists";

/** "18 Nov 2026". */
const dated = (value: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

const field = "block w-full rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm tabular-nums";

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

type HoursDraft = Record<Component, { hours: string; length: string }>;

const draftOf = (plan: CoursePlan): HoursDraft =>
  Object.fromEntries(
    COMPONENTS.map((component) => [
      component,
      {
        hours: plan.components[component].hours ? String(plan.components[component].hours) : "",
        length: plan.components[component].length ? String(plan.components[component].length) : "",
      },
    ]),
  ) as HoursDraft;

/**
 * One course's plan for a semester, for coordinators: its CM, TD and TP hours and how long a
 * session of each lasts, who leads it, and the weeks the lead laid out.
 *
 * The hours are the targets the lead spreads, and theirs only to contest in a note. The lead
 * is picked by hand from the semester's teachers: nothing is suggested, not even the teacher
 * of the lecture (user, 18 Nov 2026).
 */
export function CoursePlanDialog({
  term,
  semesterName,
  plan,
  weeks,
  onClose,
}: {
  term: string;
  semesterName: string;
  plan: CoursePlan;
  weeks: TeachingWeek[];
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [held, setHeld] = useState(plan);
  const [hours, setHours] = useState<HoursDraft>(() => draftOf(plan));
  const teachers = useQuery({ queryKey: ["active-teachers", term], queryFn: () => fetchActiveTeachers(term) });
  const keep = (saved: CoursePlan) => {
    setHeld(saved);
    void client.invalidateQueries({ queryKey: ["course-plans", term] });
    void client.invalidateQueries({ queryKey: ["wishes", term] });
  };
  const saveHours = useMutation({
    mutationFn: () =>
      changeCoursePlan(term, plan.courseCode, {
        hours: Object.fromEntries(COMPONENTS.map((component) => [component, { hours: hours[component].hours.trim() || null, length: hours[component].length.trim() || null }])),
      }),
    onSuccess: (saved) => {
      keep(saved);
      setHours(draftOf(saved));
    },
  });
  const pickLead = useMutation({
    mutationFn: (leadId: string) => changeCoursePlan(term, plan.courseCode, { leadId }),
    onSuccess: keep,
  });
  const changed = JSON.stringify(hours) !== JSON.stringify(draftOf(held));
  const set = (component: Component, patch: Partial<{ hours: string; length: string }>) =>
    setHours((current) => ({ ...current, [component]: { ...current[component], ...patch } }));

  const options = [
    { value: "", label: "Nobody yet" },
    ...(teachers.data ?? [])
      .map((teacher) => ({ value: teacher.id, label: teacher.fullName || teacher.email || teacher.id, searchText: teacher.email }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  // A lead no longer active this semester is still said by name.
  if (held.leadId && !options.some((option) => option.value === held.leadId)) {
    options.push({ value: held.leadId, label: held.leadName || "A teacher not active this semester", searchText: "" });
  }

  return (
    <Modal
      open
      size="wide"
      title={`${held.courseCode}${held.title ? ` · ${held.title}` : ""}`}
      description={`Course plan · ${semesterName}`}
      onClose={onClose}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="Hours" className="rounded-lg border border-[#e4e8ef] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-[#171717]">Hours</h3>
            <InfoTip label="About the hours">
              The course&rsquo;s hours this semester, TD and TP for each group, and how long one session lasts. The lead lays
              them out week by week and can&rsquo;t change them; they can say in a note that one looks wrong. Groups &amp; CRNs
              rows show these hours and say when a row differs.
            </InfoTip>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-end gap-x-3 gap-y-2 text-sm">
            <span />
            <span className="text-xs font-semibold text-[#344054]">Hours</span>
            <span className="text-xs font-semibold text-[#344054]">One session</span>
            {COMPONENTS.map((component) => (
              <div key={component} className="contents">
                <span className="text-sm text-[#344054]">
                  {COMPONENT_WORDS[component]}
                  {component === "CM" ? null : <span className="block text-[11px] text-[#667085]">each group</span>}
                </span>
                <input
                  aria-label={`${component} hours`}
                  inputMode="decimal"
                  value={hours[component].hours}
                  onChange={(event) => set(component, { hours: event.target.value })}
                  placeholder="—"
                  className={field}
                />
                <input
                  aria-label={`${component} session length in hours`}
                  inputMode="decimal"
                  value={hours[component].length}
                  onChange={(event) => set(component, { length: event.target.value })}
                  placeholder="1.5"
                  className={field}
                />
              </div>
            ))}
          </div>
          {saveHours.error ? <p role="alert" className="mt-2 text-sm text-[#a6292f]">{(saveHours.error as Error).message}</p> : null}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-[#667085]">
              {held.hoursUpdatedAt ? `Set by ${held.hoursUpdatedBy || "a coordinator"} on ${dated(held.hoursUpdatedAt)}` : "Not set yet"}
            </span>
            <button
              type="button"
              disabled={!changed || saveHours.isPending}
              onClick={() => saveHours.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {saveHours.isPending ? "Saving…" : "Save the hours"}
            </button>
          </div>
        </section>

        <section aria-label="Course lead" className="rounded-lg border border-[#e4e8ef] px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-[#171717]">Course lead</h3>
            <InfoTip label="About the course lead">
              The teacher who lays the course&rsquo;s weeks out, one a semester. They are asked in their Timetable preferences
              request, in a step only course leads see.
            </InfoTip>
          </div>
          <SelectMenu
            label={`Lead of ${held.courseCode}`}
            value={held.leadId}
            onChange={(value) => pickLead.mutate(value)}
            searchable
            disabled={pickLead.isPending}
            placeholder="Nobody yet"
            options={options}
          />
          {pickLead.error ? <p role="alert" className="mt-2 text-sm text-[#a6292f]">{(pickLead.error as Error).message}</p> : null}
          <p className="mt-2 text-xs text-[#667085]">
            {held.leadSetAt && held.leadId ? `Picked by ${held.leadSetBy || "a coordinator"} on ${dated(held.leadSetAt)}. ` : ""}
            Chosen from the teachers active in {semesterName}.
          </p>
        </section>
      </div>

      <section aria-label="Week by week" className="mt-4 rounded-lg border border-[#e4e8ef] px-4 py-3">
        <h3 className="mb-2 text-sm font-semibold text-[#171717]">Week by week</h3>
        <CourseScheduleEditor key={`${held.answeredAt}|${held.hoursUpdatedAt}`} term={term} plan={held} weeks={weeks} onSaved={keep} />
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
