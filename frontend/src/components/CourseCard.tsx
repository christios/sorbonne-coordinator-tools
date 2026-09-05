import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Pencil, Wand2 } from "lucide-react";
import { useState } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import type { Card, CardSet, SectionRow } from "@/services/courseCards";
import type { ActiveTeacher, TermCrns } from "@/services/portalLists";
import type { CrnVerdict, GroupClash } from "@/services/publication";
import { verdictFor } from "@/services/publicationView";
import { EMPTY_SECTION, setGroupCrn, updateSection, type Cohort, type Section } from "@/services/studentDatabase";

const KIND_WORD = { shared: "own groups", nested: "nested" } as const;

/**
 * One course, and under it every section anybody teaches of it.
 *
 * Collapsed, it is one line: the code, the title, where and when, who teaches it, and
 * what is missing. Open, it is the timetabler's rows for this course, set by set — the
 * group, its CRN, the teacher, the hours and sessions, what to expect — read cleanly,
 * with a dialog to change a row. The course's own facts (title, UE, parent CRN) are the
 * active course's and are not edited here.
 */
export function CourseCard({
  card,
  open,
  onToggle,
  cohort,
  teachers,
  portal,
  validation,
  unassigned,
  clashes,
  onChanged,
  onFilled,
}: {
  card: Card;
  open: boolean;
  onToggle: () => void;
  cohort: Cohort | null;
  teachers: ActiveTeacher[];
  /** The portal's CRNs for the card's semester, or null when it is not linked. */
  portal: TermCrns | null;
  validation: Record<string, CrnVerdict>;
  /** Scope code -> students in no group for it, from the publication report. */
  unassigned: Record<string, string[]>;
  clashes: GroupClash[] | null;
  onChanged: () => void;
  onFilled: (report: FillReport) => void;
}) {
  const [filling, setFilling] = useState<CardSet | null>(null);
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? "";
  const rows = card.sets.flatMap((set) => set.rows);
  const named = [...new Set(rows.map((row) => (row.section?.teacherId ? teacherName(row.section.teacherId) : row.section?.teacher ?? "")).filter(Boolean))];
  const missing = rows.filter((row) => !row.section?.crn && !row.section?.retired).length;
  const retired = rows.filter((row) => row.section?.retired).length;
  // A course taught only in sets the whole department shares belongs to no one cohort.
  const shared = card.sets.length > 0 && card.sets.every((set) => set.scope.openToAll);
  const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";

  return (
    <article className={`rounded-lg border bg-white ${open ? "border-[#b7c6d8] shadow-sm" : "border-[#d9dee7]"}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${card.code}`}
          onClick={onToggle}
          className="inline-flex min-w-0 items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={16} className="shrink-0 text-[#98a2b3]" aria-hidden="true" /> : <ChevronRight size={16} className="shrink-0 text-[#98a2b3]" aria-hidden="true" />}
          <span className="font-semibold tabular-nums text-[#171717]">{card.code}</span>
          <span className="truncate text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</span>
        </button>
        {/*
          * Whose card this is. A course taught only in sets open to every cohort is the
          * department's — the languages — and naming the cohort whose row happens to hold
          * the set said something untrue.
          */}
        <span className={`${chip} ${shared ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#eef1f5] text-[#344054]"}`}>
          {shared ? "Across cohorts" : card.cohortName} · {card.termName || "no semester"}
        </span>
        {!card.active ? (
          <span className={`${chip} bg-[#fdf9ee] text-[#8a6116]`} title="Choose it on the Courses page so it carries a UE and a parent CRN">
            Not on the active list
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-[#667085]">
          <span>
            {rows.length} section{rows.length === 1 ? "" : "s"} in {card.sets.map((set) => set.scope.code).join(", ")}
          </span>
          {named.length ? <span className="text-[#344054]">{named.join(", ")}</span> : <span className="text-[#98a2b3]">no teacher yet</span>}
          {missing ? <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>{missing} without CRN</span> : null}
          {retired ? <span className={`${chip} bg-[#f2f4f7] text-[#98a2b3]`}>{retired} retired</span> : null}
        </span>
      </header>

      {open ? (
        <div className="divide-y divide-[#eef1f5] border-t border-[#eef1f5]">
          {card.sets.map((set) => {
            const left = unassigned[set.scope.code]?.length ?? 0;
            return (
              <section key={set.scope.id} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
                  {/* Said once: on a card that is wholly shared the header says it already. */}
                  {set.scope.openToAll && !shared ? (
                    <span className="rounded-full bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#344054]" title="Any student of any cohort may be in this set">
                      open to every cohort
                    </span>
                  ) : null}
                  <span className="text-[#667085]">
                    {set.scope.name || "group set"} · {KIND_WORD[set.scope.kind] ?? set.scope.kind} · {set.scope.groups.length} group
                    {set.scope.groups.length === 1 ? "" : "s"}
                    {set.course.component ? ` · ${set.course.component}` : ""}
                  </span>
                  {left ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf9ee] px-2 py-0.5 text-xs font-semibold text-[#8a6116]">
                      <AlertTriangle size={11} aria-hidden="true" /> {left} in no group
                    </span>
                  ) : null}
                  {cohort ? (
                    <button
                      type="button"
                      onClick={() => setFilling(set)}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                    >
                      <Wand2 size={13} aria-hidden="true" /> Fill {set.scope.code}
                    </button>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[#98a2b3]">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Group</th>
                        <th className="py-1 pr-3 font-semibold">CRN</th>
                        <th className="py-1 pr-3 font-semibold">Teacher</th>
                        <th className="py-1 pr-3 text-right font-semibold">Hours</th>
                        <th className="py-1 pr-3 font-semibold">Sessions / week</th>
                        <th className="py-1 pr-3 text-right font-semibold">Duration</th>
                        <th className="py-1 pr-3 font-semibold">Weeks</th>
                        <th className="py-1 pr-3 text-right font-semibold">Students</th>
                        <th className="py-1 pr-3 font-semibold">Asks of the timetable</th>
                        <th className="py-1 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row) => (
                        <SectionLine
                          key={row.group.id}
                          row={row}
                          teacherName={teacherName}
                          portal={portal}
                          verdict={verdictFor(validation, row.group.id, row.course.code)}
                          onEdit={() => setEditing(row)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {filling && cohort ? (
        <FillBlock
          open
          cohort={cohort}
          scope={filling.scope}
          clashes={clashes}
          onClose={() => setFilling(null)}
          onFilled={(report) => {
            setFilling(null);
            onFilled(report);
          }}
        />
      ) : null}

      {editing ? (
        <SectionDialog
          card={card}
          row={editing}
          teachers={teachers}
          portal={portal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </article>
  );
}

/** What a section asks of the timetable, in one short line. */
function asks(section: Section): string {
  return [
    section.roomPref ? `room ${section.roomPref}` : "",
    section.dayPref ? `day ${section.dayPref}` : "",
    section.timePref ? `time ${section.timePref}` : "",
    section.constraints,
    section.comments,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One section, read: every fact on its row, and a pencil to change it. */
function SectionLine({
  row,
  teacherName,
  portal,
  verdict,
  onEdit,
}: {
  row: SectionRow;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  verdict?: CrnVerdict;
  onEdit: () => void;
}) {
  const held = row.section ?? EMPTY_SECTION;
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  const portalRow = portal && held.crn ? (portal.crns[held.crn] ?? null) : undefined;
  const chosen = held.teacherId ? teacherName(held.teacherId) : "";
  const dim = held.retired ? "text-[#98a2b3]" : "";
  const asked = asks(held);
  const empty = <span className="text-[#c8d0da]">—</span>;

  return (
    <tr
      className={`cursor-pointer border-t border-[#eef1f5] align-top hover:bg-[#fafbfc] ${dim}`}
      onClick={onEdit}
      title={`Edit ${label}`}
    >
      <td className="py-2 pr-3">
        <span className={`font-semibold ${held.retired ? "" : "text-[#171717]"}`}>{row.group.label}</span>
        {held.retired ? <span className="ml-1.5 rounded-full bg-[#f2f4f7] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#98a2b3]">Retired</span> : null}
        <span className="block text-[11px] text-[#98a2b3]">
          {row.group.capacity ? `${row.group.assigned}/${row.group.capacity}` : `${row.group.assigned} placed`}
          {row.group.program ? ` · ${row.group.program}` : ""}
        </span>
      </td>
      <td className="py-2 pr-3 tabular-nums">
        {held.crn ? (
          <span className="inline-flex items-center gap-1">
            <span className={verdict && verdict.status !== "matched" ? "text-[#a6292f]" : ""}>{held.crn}</span>
            {verdict ? (
              verdict.status === "matched" ? (
                <Check size={13} className="text-[#2f6b3d]" aria-label="In the timetable" />
              ) : (
                <AlertTriangle size={13} className="text-[#a6292f]" aria-label={verdict.detail} />
              )
            ) : null}
          </span>
        ) : held.retired ? (
          empty
        ) : (
          <span className="rounded-full bg-[#fdf3f3] px-2 py-0.5 text-xs font-semibold text-[#a6292f]">no CRN</span>
        )}
        {held.crn && portalRow === null ? <span className="block text-[11px] text-[#a6292f]">Not in the portal&apos;s list</span> : null}
      </td>
      <td className="py-2 pr-3">
        {chosen ? (
          <span className="text-[#171717]">{chosen}</span>
        ) : held.teacher ? (
          <span className="text-[#667085]" title="Named on the row, but not chosen from Active teachers yet">
            {held.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
          </span>
        ) : (
          empty
        )}
        {portalRow?.teacherName && portalRow.teacherName !== chosen ? (
          <span className="block text-[11px] text-[#98a2b3]" title="The teacher the portal lists for this CRN">
            Portal: {portalRow.teacherName}
          </span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{held.hours || empty}</td>
      <td className="py-2 pr-3">{held.sessionsPerWeek || empty}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{held.duration || empty}</td>
      <td className="py-2 pr-3">{held.weeks || empty}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{held.anticipated || empty}</td>
      <td className="max-w-[18rem] truncate py-2 pr-3 text-xs text-[#667085]" title={asked}>
        {asked || empty}
      </td>
      <td className="py-1.5 text-right">
        <button
          type="button"
          aria-label={`Edit ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}

const field = "mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal";
const fieldLabel = "block text-xs font-semibold text-[#344054]";

/**
 * Everything the timetabler's workbook says about one section, on one form.
 *
 * The CRN is chosen from the portal's list for this course when the semester is linked
 * — a CRN typed by hand is how a digit goes wrong — and the teacher from Active teachers.
 * The rest is what the workbook's columns always were.
 */
export function SectionDialog({
  card,
  row,
  teachers,
  portal,
  onClose,
  onSaved,
}: {
  card: Card;
  row: SectionRow;
  teachers: ActiveTeacher[];
  portal: TermCrns | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const held = row.section ?? EMPTY_SECTION;
  const [draft, setDraft] = useState<Section>({ ...held });
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  const set = (patch: Partial<Section>) => setDraft((current) => ({ ...current, ...patch }));

  // The portal's CRNs of this course in this semester, the one already held first.
  const crnOptions = portal
    ? Object.entries(portal.crns)
        .filter(([, known]) => known.courseCode.toUpperCase() === card.code.toUpperCase())
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([crn, known]) => ({
          value: crn,
          label: crn,
          searchText: known.teacherName,
          badge: known.status === "in_portal" ? known.teacherName || undefined : "no longer listed",
          badgeTone: "muted" as const,
        }))
    : [];
  if (draft.crn && !crnOptions.some((option) => option.value === draft.crn)) {
    crnOptions.unshift({ value: draft.crn, label: draft.crn, searchText: "", badge: portal ? "not in the portal's list" : undefined, badgeTone: "muted" as const });
  }
  const portalTeacher = portal && draft.crn ? (portal.crns[draft.crn]?.teacherName ?? "") : "";

  const save = useMutation({
    mutationFn: async () => {
      const crn = draft.crn.trim();
      if (crn !== held.crn) await setGroupCrn(row.group.id, row.course.id, { crn, teacher: held.teacher });
      const details: Partial<Section> = { ...draft };
      delete details.crn;
      delete details.teacher;
      await updateSection(row.group.id, row.course.id, details as Omit<Section, "crn" | "teacher">);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal
      open
      size="wide"
      title={`${card.code} · ${row.scope.code} ${row.group.label}`}
      description={`${card.name || "This course"}${row.course.component ? `, ${row.course.component}` : ""} — the row the timetabler gets for this group.`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
            <input type="checkbox" aria-label={`Retire ${label}`} checked={draft.retired} onChange={(event) => set({ retired: event.target.checked })} />
            Retired — kept on the workbook, marked, and the fill skips it
          </label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className={fieldLabel}>CRN</span>
          {portal ? (
            <div className="mt-1">
              <SelectMenu
                label={`CRN for ${label}`}
                value={draft.crn}
                placeholder={crnOptions.length ? "Which CRN…" : "The portal lists no CRN of this course"}
                searchable={crnOptions.length > 8}
                onChange={(crn) => set({ crn })}
                options={[{ value: "", label: "None yet" }, ...crnOptions]}
              />
            </div>
          ) : (
            <input aria-label={`CRN for ${label}`} value={draft.crn} inputMode="numeric" onChange={(event) => set({ crn: event.target.value })} placeholder="23223" className={field} />
          )}
          <span className="mt-1 block text-[11px] text-[#98a2b3]">
            {portal ? "From the portal's list for this semester. Clearing it removes the section." : "This semester is not linked to a portal term, so the CRN is typed. Link it on the Semesters page."}
          </span>
        </div>
        <div>
          <span className={fieldLabel}>Teacher</span>
          <div className="mt-1">
            <SelectMenu
              label={`Teacher for ${label}`}
              value={draft.teacherId}
              placeholder="Not chosen"
              searchable={teachers.length > 8}
              onChange={(teacherId) => set({ teacherId })}
              options={[{ value: "", label: "Not chosen" }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName, searchText: teacher.email }))]}
            />
          </div>
          <span className="mt-1 block text-[11px] text-[#98a2b3]">
            From Active teachers.{portalTeacher ? ` The portal lists ${portalTeacher} for this CRN.` : ""}
            {!draft.teacherId && held.teacher ? ` The row named ${held.teacher} before anyone was chosen.` : ""}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <label className={fieldLabel}>
          Total hours
          <input aria-label={`Hours for ${label}`} value={draft.hours} onChange={(event) => set({ hours: event.target.value })} placeholder="50" className={field} />
        </label>
        <label className={`${fieldLabel} sm:col-span-2`}>
          Weeks and sessions per week
          <input aria-label={`Sessions per week for ${label}`} value={draft.sessionsPerWeek} onChange={(event) => set({ sessionsPerWeek: event.target.value })} placeholder="2 sessions — weeks 2 to 14" className={field} />
        </label>
        <label className={fieldLabel}>
          Duration (hr/session)
          <input aria-label={`Duration for ${label}`} value={draft.duration} onChange={(event) => set({ duration: event.target.value })} placeholder="1.5" className={field} />
        </label>
        <label className={fieldLabel}>
          Weeks
          <input aria-label={`Weeks for ${label}`} value={draft.weeks} onChange={(event) => set({ weeks: event.target.value })} placeholder="2–14" className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <label className={fieldLabel}>
          Anticipated students
          <input aria-label={`Anticipated students for ${label}`} value={draft.anticipated || ""} inputMode="numeric" onChange={(event) => set({ anticipated: Number(event.target.value) || 0 })} placeholder={String(row.group.capacity || "")} className={field} />
        </label>
        <label className={fieldLabel}>
          Room preference
          <input aria-label={`Room preference for ${label}`} value={draft.roomPref} onChange={(event) => set({ roomPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Day preference
          <input aria-label={`Day preference for ${label}`} value={draft.dayPref} onChange={(event) => set({ dayPref: event.target.value })} className={field} />
        </label>
        <label className={fieldLabel}>
          Time preference
          <input aria-label={`Time preference for ${label}`} value={draft.timePref} onChange={(event) => set({ timePref: event.target.value })} className={field} />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={fieldLabel}>
          Constraints
          <textarea aria-label={`Constraints for ${label}`} value={draft.constraints} rows={2} onChange={(event) => set({ constraints: event.target.value })} placeholder="Should not be in parallel with G.2" className={field} />
        </label>
        <label className={fieldLabel}>
          Comments
          <textarea aria-label={`Comments for ${label}`} value={draft.comments} rows={2} onChange={(event) => set({ comments: event.target.value })} placeholder="Mutualised with Maths" className={field} />
        </label>
      </div>
      {save.error ? <p role="alert" className="mt-3 text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
    </Modal>
  );
}
