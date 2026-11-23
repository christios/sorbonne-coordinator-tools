import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

import { InfoTip, TipButton, TipDo, TipPill, TipPoint, TipUsage } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { COMPONENT_WORDS, componentOf, figure, type CoursePlan } from "@/services/coursePlans";
import type { CardSet } from "@/services/courseCards";
import { isSilent, preferences, spread } from "@/services/courseRequest";
import type { ActiveTeacher } from "@/services/portalLists";
import { EMPTY_REQUEST, updateCourseRequest, type Request } from "@/services/studentDatabase";

const field = "mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal";
const fieldLabel = "block text-xs font-semibold text-[#344054]";

/**
 * What a course asks of the timetable, for every section of it in one set.
 *
 * Six tutorial groups of Pre-calculus want the same thirty-six hours over the same weeks
 * in the same sort of room, and that was typed into six sections. It is said here once.
 *
 * Nothing is pushed into the sections. A section that has been told nothing has been told
 * nothing — it goes on showing a dash, and the two lines stay legible as separate claims
 * about the world. It is the workbook the timetabler receives that puts them together:
 * where a section is silent, its course answers for it.
 */
export function CourseRequestDialog({
  courseId,
  title,
  description,
  held,
  teachers,
  onClose,
  onSaved,
}: {
  courseId: string;
  title: string;
  description: string;
  held: Request;
  teachers: ActiveTeacher[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Request>({ ...EMPTY_REQUEST, ...held });
  const set = (patch: Partial<Request>) => setDraft((current) => ({ ...current, ...patch }));
  const save = useMutation({
    mutationFn: () => updateCourseRequest(courseId, draft),
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      size="wide"
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            // Everything but the hours and the session length, which are set on the plan.
            onClick={() => setDraft({ ...EMPTY_REQUEST, hours: draft.hours, duration: draft.duration })}
            className="mr-auto text-sm font-semibold text-[#667085] hover:text-[#344054]"
          >
            Clear it
          </button>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      {/* The hours and a session's length are set in the open, at the top of the course's plan
          (23 Nov 2026), not in here: what is left is how they are spread, and the rest. */}
      <p className="mb-3 text-xs text-[#667085]">
        Hours and session length: set them at the top of the course&rsquo;s plan, above.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={`${fieldLabel} sm:col-span-2`}>
          Weeks and sessions per week
          <input aria-label={`Sessions per week for ${title}`} value={draft.sessionsPerWeek} onChange={(event) => set({ sessionsPerWeek: event.target.value })} placeholder="2 sessions — weeks 2 to 14" className={field} />
        </label>
        <label className={fieldLabel}>
          Weeks
          <input aria-label={`Weeks for ${title}`} value={draft.weeks} onChange={(event) => set({ weeks: event.target.value })} placeholder="2–14" className={field} />
        </label>
      </div>

      {/* No "anticipated students": a class is as big as its seats, set on its card. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className={fieldLabel}>
          Room preference
          <input aria-label={`Room preference for ${title}`} value={draft.roomPref} onChange={(event) => set({ roomPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Day preference
          <input aria-label={`Day preference for ${title}`} value={draft.dayPref} onChange={(event) => set({ dayPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Time preference
          <input aria-label={`Time preference for ${title}`} value={draft.timePref} onChange={(event) => set({ timePref: event.target.value })} className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          Constraints
          <textarea aria-label={`Constraints for ${title}`} value={draft.constraints} rows={2} onChange={(event) => set({ constraints: event.target.value })} placeholder="Should not be in parallel with G.2" className={field} />
        </label>
        <label className={fieldLabel}>
          Comments
          <textarea aria-label={`Comments for ${title}`} value={draft.comments} rows={2} onChange={(event) => set({ comments: event.target.value })} placeholder="Mutualised with Maths" className={field} />
        </label>
      </div>

      <div className="mt-4 max-w-sm">
        <span className={fieldLabel}>Teacher</span>
        <div className="mt-1">
          <SelectMenu
            label={`Teacher for ${title}`}
            value={draft.teacherId}
            placeholder="Not chosen"
            searchable={teachers.length > 8}
            onChange={(teacherId) => set({ teacherId })}
            options={[{ value: "", label: "Not chosen" }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName, searchText: teacher.email }))]}
          />
        </div>
        <span className="mt-1 block text-[11px] text-[#98a2b3]">
          Only worth naming where one person teaches every section of this course. A section that names
          nobody is written out with this name; one that names somebody keeps theirs.
        </span>
      </div>

      <p className="mt-4 border-t border-[#eef1f5] pt-3 text-xs text-[#98a2b3]">
        Nothing here is copied into the sections. They keep whatever they say, blank included — and where
        one is blank, the workbook the timetabler receives is written with what the course asked for.
      </p>
    </Modal>
  );
}

/** The course's own line, at the head of its sections. */
export function CourseRequestLine({
  request,
  scopeCode,
  onEdit,
}: {
  request: Request;
  scopeCode: string;
  onEdit: () => void;
}) {
  const silent = isSilent(request);
  const spreadOver = spread(request);
  const asked = preferences(request);

  return (
    <div className="mb-2.5 rounded-md border border-[#e4e8ef] bg-[#fbfcfe] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a94a4]">The course asks</span>
          <InfoTip label="What the course asks means" title="What the course asks">
            <TipDo>
              Say once what every {scopeCode} section of this course needs: its hours, its weeks, its room.
            </TipDo>
            <TipPoint>Nothing is copied into the sections: one with its own answer keeps it.</TipPoint>
            <TipPoint>Where a section says nothing, the timetabler&apos;s workbook uses the course&apos;s answer.</TipPoint>
            <TipUsage
              when={<>Six TD groups of <TipPill>MATH-001</TipPill> Pre Calculus all want 36 hours, over the same weeks, in the same sort of room.</>}
              todo={<>Press <TipButton look="link">Say what TD asks for</TipButton> and enter it once.</>}
              then={<>Every TD section without its own hours goes to the timetabler with 36.</>}
              other={<>Only <TipPill>TD 3</TipPill> needs a bigger room: say it on TD 3&apos;s own card. TD 3 keeps its answer; the other TDs still follow the course.</>}
            />
          </InfoTip>
        </span>
        {silent ? (
          <span className="text-xs text-[#98a2b3]">nothing yet — every section speaks for itself</span>
        ) : (
          <>
            {request.hours ? <Pill>{request.hours} h in all</Pill> : null}
            {spreadOver ? <span className="text-[11px] tabular-nums text-[#667085]">{spreadOver}</span> : null}
          </>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="ml-auto text-xs font-semibold text-[#1f4e79] underline-offset-2 hover:underline"
        >
          {silent ? `Say what ${scopeCode} asks for` : "Edit"}
        </button>
      </div>
      {asked ? <p className="mt-1 text-xs leading-5 text-[#667085]">{asked}</p> : null}
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[#cfe0ee] bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#1f4e79]">
      {children}
    </span>
  );
}

/**
 * The course's hours and session length, set at its level for each set it is in (user, 23 Nov
 * 2026: "take the hours out of the hidden 'the course asks'"): typed in the open, at the top
 * of the course's plan. A section's card may still say its own, which the plan lists as an
 * exception. Under each, how the plan reads them: from here, from the sections when nothing is
 * said here, what stands in the way, and the sections that say otherwise.
 */
export function CourseHours({
  sets,
  plan,
  onSaved,
  labelOf = (each) => each.scope.code,
}: {
  sets: CardSet[];
  plan: CoursePlan | null | undefined;
  onSaved: () => void;
  /** How a set is named in the table: its code, with its cohort when the course is in several. */
  labelOf?: (set: CardSet) => string;
}) {
  const [draft, setDraft] = useState<Record<string, { hours: string; duration: string }>>(() =>
    Object.fromEntries(sets.map((each) => [each.course.id, { hours: each.course.request.hours, duration: each.course.request.duration }])),
  );
  const changed = sets.filter(
    (each) => draft[each.course.id] && (draft[each.course.id].hours.trim() !== each.course.request.hours || draft[each.course.id].duration.trim() !== each.course.request.duration),
  );
  const save = useMutation({
    mutationFn: () =>
      Promise.all(
        changed.map((each) =>
          updateCourseRequest(each.course.id, {
            ...each.course.request,
            hours: draft[each.course.id].hours.trim(),
            duration: draft[each.course.id].duration.trim(),
          }),
        ),
      ),
    onSuccess: onSaved,
  });
  const small = "block w-full rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm tabular-nums";
  // Columns: the set, its hours, its session length, and how the plan reads them.
  const grid = "grid grid-cols-[minmax(0,9rem)_5.5rem_5.5rem_minmax(0,1fr)] items-center gap-x-3";
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">Hours and session length</p>
      <div className={`${grid} px-3 pb-1 text-[11px] font-semibold text-[#98a2b3]`}>
        <span>Set</span>
        <span>Hours</span>
        <span>Session (h)</span>
        <span />
      </div>
      <div className="divide-y divide-[#eef1f5] rounded-md border border-[#e4e8ef]">
        {sets.map((each) => {
          const component = componentOf({ component: each.course.component || each.scope.code });
          const held = plan && component ? plan.components[component] : null;
          const name = `${labelOf(each)}${component && component !== each.scope.code ? ` · ${component}` : ""}`;
          const value = draft[each.course.id] ?? { hours: "", duration: "" };
          return (
            <div key={each.course.id} className={`${grid} px-3 py-1.5`}>
              <span className="min-w-0 truncate text-sm text-[#344054]">
                <b className="font-semibold text-[#1f4e79]">{name}</b>
                {component ? <span className="ml-1.5 text-xs text-[#667085]">{COMPONENT_WORDS[component].replace(` (${component})`, "")}</span> : null}
              </span>
              <input
                aria-label={`Hours for ${name}`}
                inputMode="decimal"
                value={value.hours}
                onChange={(event) => setDraft((current) => ({ ...current, [each.course.id]: { ...value, hours: event.target.value } }))}
                placeholder={held?.source === "sections" && held.hours ? figure(held.hours) : "—"}
                className={small}
              />
              <input
                aria-label={`Session length for ${name}`}
                inputMode="decimal"
                value={value.duration}
                onChange={(event) => setDraft((current) => ({ ...current, [each.course.id]: { ...value, duration: event.target.value } }))}
                placeholder={held?.source === "sections" && held.length ? figure(held.length) : "1.5"}
                className={small}
              />
              {/* How the plan reads them, beside the figures rather than under them. */}
              <span className="min-w-0 text-xs leading-snug">
                {held?.source === "sections" && !value.hours ? (
                  <span className="block text-[#667085]">From its sections, which agree: type it to set it here.</span>
                ) : null}
                {held?.issue ? (
                  <span className="flex items-start gap-1 font-semibold text-[#8a6116]">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" /> {held.issue}
                  </span>
                ) : null}
                {held?.exceptions?.length ? (
                  <span className="block font-semibold text-[#8a6116]">Own figure: {held.exceptions.join(" · ")}</span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {save.error ? <p role="alert" className="mt-1 text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={!changed.length || save.isPending}
          onClick={() => save.mutate()}
          className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
        >
          {save.isPending ? "Saving…" : "Save the hours"}
        </button>
      </div>
    </div>
  );
}
