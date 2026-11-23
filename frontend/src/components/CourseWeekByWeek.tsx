import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Pencil } from "lucide-react";
import { useState } from "react";

import { CourseScheduleGrid, type ScheduleDraft } from "@/components/CourseScheduleGrid";
import { InfoTip, TipDo, TipPage, TipPoint } from "@/components/InfoTip";
import { SelectMenu } from "@/components/SelectMenu";
import {
  answeredWords,
  changeCoursePlan,
  componentOf,
  figure,
  hoursWords,
  layOutCourse,
  unevenOf,
  type Component,
  type CoursePlan,
  type Layout,
  type Lengths,
  type TeachingWeek,
} from "@/services/coursePlans";
import type { ActiveTeacher } from "@/services/portalLists";

/** A layout with one component's weeks put in place of what it held: the rest of the course kept. */
function withComponent<T>(whole: Partial<Record<Component, T>>, component: Component, own: T | undefined) {
  const next = { ...whole };
  if (own && Object.keys(own).length) next[component] = own;
  else delete next[component];
  return next;
}

/**
 * A Groups & CRNs card's share of its course's plan, set from here (user, 23 Nov 2026: "let
 * the Week by week view also appear under each card in Groups & CRNs, but everything should
 * be set from there").
 *
 * The course's hours and session length for the card's component are the card's own — its
 * course row and sections — and said here as the plan reads them, with what stands in the way
 * when it can't ("No session length in Groups & CRNs yet"). Below, who leads the course, and
 * the component's weeks: as the lead laid them out in their Timetable preferences request, or
 * filled in for them from here. One plan per course and semester, shared by every cohort that
 * takes it: the same weeks show under each of the course's cards.
 */
export function CourseWeekByWeek({
  term,
  plan,
  weeks,
  component: said,
  teachers,
  onSaved,
}: {
  term: string;
  plan: CoursePlan | null | undefined;
  weeks: TeachingWeek[];
  /** The card's component, CM, TD or TP. */
  component: string;
  teachers: ActiveTeacher[];
  onSaved: () => void;
}) {
  const component = componentOf({ component: said });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft>({ weeks: {}, lengths: {} });
  const save = useMutation({
    mutationFn: () => {
      if (!plan || !component) throw new Error("No course plan to save.");
      // The card's component alone changes: the course's other components keep their weeks.
      return layOutCourse(term, plan.courseCode, {
        weeks: withComponent<Record<string, number>>(plan.weeks, component, draft.weeks[component]) as Layout,
        lengths: withComponent<Record<string, number[]>>(plan.lengths ?? {}, component, draft.lengths[component]) as Lengths,
      });
    },
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });
  const pickLead = useMutation({
    mutationFn: (leadId: string) => changeCoursePlan(term, plan?.courseCode ?? "", { leadId }),
    onSuccess: onSaved,
  });
  if (!plan || !component) return null;
  const held = plan.components[component];
  const numbers = weeks.map((week) => week.week);
  const uneven = held.hours && held.length ? unevenOf(plan, component, numbers) : null;
  const options = [
    { value: "", label: "Nobody yet" },
    ...teachers
      .map((teacher) => ({ value: teacher.id, label: teacher.fullName || teacher.email || teacher.id, searchText: teacher.email }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  // A lead no longer among the semester's teachers is still said by name.
  if (plan.leadId && !options.some((option) => option.value === plan.leadId)) {
    options.push({ value: plan.leadId, label: plan.leadName || "A teacher not active this semester", searchText: "" });
  }
  const start = () => {
    setDraft({ weeks: plan.weeks, lengths: plan.lengths ?? {} });
    save.reset();
    setEditing(true);
  };

  return (
    <section
      aria-label={`${plan.courseCode} ${component} week by week`}
      data-course-plan={component}
      className="-mt-1 mb-3 rounded-lg border border-[#dfe5ee] bg-[#fbfcfe] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[#475467]">Week by week</span>
          <InfoTip label="What the week by week is" title="Week by week">
            <TipDo>Set everything for the course&rsquo;s plan here: hours and session length on the course row and its sections, the lead, and the weeks.</TipDo>
            <TipPoint>One plan per course and semester, shared by every cohort that takes it: the same weeks show under each of its cards.</TipPoint>
            <TipPoint>The lead lays the weeks out in their Timetable preferences request; fill them in from here after a call or an email.</TipPoint>
            <TipPoint>
              <TipPage name="Active courses" /> reads it all, and <TipPage name="Semester plan" /> proposes the weeks when a class is placed.
            </TipPoint>
          </InfoTip>
        </span>
        {held.hours ? (
          <span className="text-xs font-semibold tabular-nums text-[#1f4e79]">
            {component} {hoursWords(component, held)}
            {held.length ? ` · sessions of ${figure(held.length)} h` : ""}
          </span>
        ) : null}
        {held.issue ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8a6116]">
            <AlertTriangle size={12} aria-hidden="true" /> {held.issue}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2 text-xs text-[#475467]">
          Lead
          <span className="w-52">
            <SelectMenu
              label={`Lead of ${plan.courseCode}`}
              value={plan.leadId}
              onChange={(value) => pickLead.mutate(value)}
              searchable
              disabled={pickLead.isPending}
              placeholder="Nobody yet"
              options={options}
            />
          </span>
        </span>
      </div>
      {pickLead.error ? <p role="alert" className="mt-1 text-xs text-[#a6292f]">{(pickLead.error as Error).message}</p> : null}

      {!held.hours ? (
        <p className="mt-1.5 text-xs text-[#667085]">
          {held.issue ? "Make the course row and its sections agree" : `No ${component} hours on this card yet`}: the plan takes its hours
          from them.
        </p>
      ) : !weeks.length ? (
        <p className="mt-1.5 text-xs text-[#8a6116]">
          The semester&rsquo;s teaching weeks aren&rsquo;t set yet: set Week 1 and the number of weeks in the Semester plan&rsquo;s settings.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#475467]">
              {answeredWords(plan)}
              {uneven ? (
                <span className="ml-2 font-semibold text-[#8a6116]" title={uneven.reason ? `The lead's reason: ${uneven.reason}` : "No reason given"}>
                  · Uneven{uneven.reason ? `: “${uneven.reason}”` : ""}
                </span>
              ) : null}
            </p>
            {held.length && !editing ? (
              <button
                type="button"
                onClick={start}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
              >
                <Pencil size={12} aria-hidden="true" /> {plan.answeredAt ? "Change the weeks" : "Fill in for the lead"}
              </button>
            ) : null}
          </div>
          <CourseScheduleGrid
            plan={plan}
            weeks={weeks}
            only={component}
            value={editing ? draft : { weeks: plan.weeks, lengths: plan.lengths ?? {} }}
            onChange={editing ? setDraft : undefined}
            label={`${plan.courseCode} ${component} sessions week by week`}
          />
          {editing ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              {save.error ? <p role="alert" className="mr-auto text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
              <span className="mr-auto text-xs text-[#667085]">Kept as entered by you, for {plan.leadName || "the lead"}.</span>
              <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-[#667085]">
                Cancel
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => save.mutate()}
                className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
              >
                {save.isPending ? "Saving…" : "Save the weeks"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
