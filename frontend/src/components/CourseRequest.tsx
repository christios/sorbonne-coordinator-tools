import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
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
            onClick={() => setDraft({ ...EMPTY_REQUEST })}
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
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <label className={fieldLabel}>
          Total hours
          <input aria-label={`Hours for ${title}`} value={draft.hours} onChange={(event) => set({ hours: event.target.value })} placeholder="50" className={field} />
        </label>
        <label className={`${fieldLabel} sm:col-span-2`}>
          Weeks and sessions per week
          <input aria-label={`Sessions per week for ${title}`} value={draft.sessionsPerWeek} onChange={(event) => set({ sessionsPerWeek: event.target.value })} placeholder="2 sessions — weeks 2 to 14" className={field} />
        </label>
        <label className={fieldLabel}>
          Duration (hr/session)
          <input aria-label={`Duration for ${title}`} value={draft.duration} onChange={(event) => set({ duration: event.target.value })} placeholder="1.5" className={field} />
        </label>
        <label className={fieldLabel}>
          Weeks
          <input aria-label={`Weeks for ${title}`} value={draft.weeks} onChange={(event) => set({ weeks: event.target.value })} placeholder="2–14" className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <label className={fieldLabel}>
          Anticipated students
          <input aria-label={`Anticipated students for ${title}`} value={draft.anticipated || ""} inputMode="numeric" onChange={(event) => set({ anticipated: Number(event.target.value) || 0 })} className={field} />
        </label>
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
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#8a94a4]">The course asks</span>
        {silent ? (
          <span className="text-xs text-[#98a2b3]">nothing yet — every section speaks for itself</span>
        ) : (
          <>
            {request.hours ? <Pill>{request.hours} h in all</Pill> : null}
            {request.anticipated ? <Pill>{request.anticipated} expected</Pill> : null}
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
