import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Pencil, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import type { Card, CardSet, SectionRow } from "@/services/courseCards";
import type { ActiveTeacher, TermCrns } from "@/services/portalLists";
import type { CrnVerdict, GroupClash } from "@/services/publication";
import { verdictFor } from "@/services/publicationView";
import { EMPTY_SECTION, setGroupCrn, updateCourse, updateSection, type Cohort, type Section } from "@/services/studentDatabase";

const KIND_WORD = { shared: "shared numbering", independent: "own numbering", nested: "nested" } as const;

/**
 * One course, and under it every section anybody teaches of it.
 *
 * Collapsed, it is one line: the code, the title, where and when, who teaches it. Open,
 * it is the timetabler's rows for this course, set by set: the group, its CRN, the
 * teacher, the hours and sessions, what to expect and what to ask of the timetable.
 * Each row saves itself on blur, the way a cell in the matrix used to.
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
  const [editingHead, setEditingHead] = useState(false);
  const [filling, setFilling] = useState<CardSet | null>(null);
  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? "";
  const rows = card.sets.flatMap((set) => set.rows);
  const named = [...new Set(rows.map((row) => (row.section?.teacherId ? teacherName(row.section.teacherId) : row.section?.teacher ?? "")).filter(Boolean))];
  const missing = rows.filter((row) => !row.section?.crn && !row.section?.retired).length;
  const retired = rows.filter((row) => row.section?.retired).length;

  return (
    <article className="rounded-lg border border-[#d9dee7] bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${card.code}`}
          onClick={onToggle}
          className="inline-flex items-center gap-2 text-left"
        >
          {open ? <ChevronDown size={16} className="text-[#98a2b3]" aria-hidden="true" /> : <ChevronRight size={16} className="text-[#98a2b3]" aria-hidden="true" />}
          <span className="font-semibold text-[#171717]">{card.code}</span>
          <span className="text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</span>
        </button>
        {card.ue ? <span className="rounded-full bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#344054]">{card.ue}</span> : null}
        <span className="text-xs text-[#98a2b3]">
          {card.cohortName} · {card.termName || "no semester"}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-[#667085]">
          <span>
            {rows.length} section{rows.length === 1 ? "" : "s"} in {card.sets.map((set) => set.scope.code).join(", ")}
          </span>
          {named.length ? <span className="text-[#344054]">{named.join(", ")}</span> : <span className="text-[#98a2b3]">no teacher yet</span>}
          {missing ? <span className="rounded-full bg-[#fdf3f3] px-2 py-0.5 font-semibold text-[#a6292f]">{missing} without CRN</span> : null}
          {retired ? <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 font-semibold text-[#98a2b3]">{retired} retired</span> : null}
          <button
            type="button"
            aria-label={`Edit ${card.code}`}
            onClick={() => setEditingHead((current) => !current)}
            className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
        </span>
      </header>

      {editingHead ? <CourseHead card={card} onSaved={() => { setEditingHead(false); onChanged(); }} onCancel={() => setEditingHead(false)} /> : null}

      {open ? (
        <div className="divide-y divide-[#eef1f5] border-t border-[#eef1f5]">
          {card.sets.map((set) => {
            const left = unassigned[set.scope.code]?.length ?? 0;
            return (
              <section key={set.scope.id} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
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
                  <table className="w-full min-w-[58rem] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[#98a2b3]">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Group</th>
                        <th className="py-1 pr-3 font-semibold">CRN</th>
                        <th className="py-1 pr-3 font-semibold">Teacher</th>
                        <th className="py-1 pr-3 font-semibold">Hours</th>
                        <th className="py-1 pr-3 font-semibold">Sessions / week</th>
                        <th className="py-1 pr-3 font-semibold">Duration</th>
                        <th className="py-1 pr-3 font-semibold">Weeks</th>
                        <th className="py-1 pr-3 font-semibold">Students</th>
                        <th className="py-1 pr-3 font-semibold">Retired</th>
                        <th className="py-1 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {set.rows.map((row) => (
                        <SectionEditor
                          key={row.group.id}
                          row={row}
                          teachers={teachers}
                          portal={portal}
                          verdict={verdictFor(validation, row.group.id, row.course.code)}
                          onChanged={onChanged}
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
    </article>
  );
}

/** The course's own facts: title, UE, parent CRN — the same on every set that carries it. */
function CourseHead({ card, onSaved, onCancel }: { card: Card; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState(card.name);
  const [ue, setUe] = useState(card.ue);
  const [parentCrn, setParentCrn] = useState(card.parentCrn);
  const save = useMutation({
    mutationFn: async () => {
      for (const set of card.sets) {
        await updateCourse(set.course.id, { code: set.course.code, name, component: set.course.component, ue, parentCrn });
      }
    },
    onSuccess: onSaved,
  });
  const field = "rounded-md border border-[#cbd5e1] px-2 py-1.5 text-sm";

  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-[#eef1f5] bg-[#fafbfc] px-4 py-3 text-sm">
      <label className="text-xs font-semibold text-[#344054]">
        Title
        <input aria-label={`Title of ${card.code}`} value={name} onChange={(event) => setName(event.target.value)} className={`mt-1 block w-64 ${field}`} />
      </label>
      <label className="text-xs font-semibold text-[#344054]">
        UE
        <input aria-label={`UE of ${card.code}`} value={ue} onChange={(event) => setUe(event.target.value)} placeholder="UL1MA001" className={`mt-1 block w-32 ${field}`} />
      </label>
      <label className="text-xs font-semibold text-[#344054]">
        Parent CRN
        <input aria-label={`Parent CRN of ${card.code}`} value={parentCrn} onChange={(event) => setParentCrn(event.target.value)} inputMode="numeric" className={`mt-1 block w-28 ${field}`} />
      </label>
      <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
        Save
      </button>
      <button type="button" onClick={onCancel} className="text-sm font-semibold text-[#667085]">
        Cancel
      </button>
      {save.error ? <p role="alert" className="basis-full text-[#a6292f]">{(save.error as Error).message}</p> : null}
    </div>
  );
}

/**
 * One section's row, saving itself field by field.
 *
 * The CRN goes through the same call a matrix cell used, so clearing it still removes
 * the section; everything else is the workbook's, and lands the moment a field is left.
 */
function SectionEditor({
  row,
  teachers,
  portal,
  verdict,
  onChanged,
}: {
  row: SectionRow;
  teachers: ActiveTeacher[];
  portal: TermCrns | null;
  verdict?: CrnVerdict;
  onChanged: () => void;
}) {
  const held = row.section ?? EMPTY_SECTION;
  const [draft, setDraft] = useState<Section>(held);
  const [more, setMore] = useState(false);
  const stamp = JSON.stringify(held);
  useEffect(() => setDraft(JSON.parse(stamp) as Section), [stamp]);

  const saveCrn = useMutation({
    mutationFn: (crn: string) => setGroupCrn(row.group.id, row.course.id, { crn, teacher: held.teacher }),
    onSuccess: onChanged,
  });
  const saveDetails = useMutation({
    mutationFn: (next: Section) => {
      const details: Partial<Section> = { ...next };
      delete details.crn;
      delete details.teacher;
      return updateSection(row.group.id, row.course.id, details as Omit<Section, "crn" | "teacher">);
    },
    onSuccess: onChanged,
  });

  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  const commit = (next: Partial<Section>) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    saveDetails.mutate(merged);
  };
  const onBlur = (key: keyof Section) => () => {
    if (draft[key] !== held[key]) commit({});
  };
  const portalRow = portal && draft.crn ? (portal.crns[draft.crn] ?? null) : undefined;
  const portalTeacher = portalRow?.teacherName ?? "";
  const chosenName = teachers.find((teacher) => teacher.id === draft.teacherId)?.fullName ?? "";
  const cell = "rounded-md border border-[#cbd5e1] px-2 py-1 text-sm";
  const dim = draft.retired ? "opacity-50" : "";

  return (
    <>
      <tr className={`border-t border-[#eef1f5] align-top ${dim}`}>
        <td className="py-1.5 pr-3">
          <span className="font-semibold text-[#171717]">{row.group.label}</span>
          <span className="block text-[11px] text-[#98a2b3]">
            {row.group.capacity ? `${row.group.assigned}/${row.group.capacity}` : `${row.group.assigned} placed`}
            {row.group.program ? ` · ${row.group.program}` : ""}
          </span>
        </td>
        <td className="py-1.5 pr-3">
          <input
            aria-label={`CRN for ${label}`}
            value={draft.crn}
            inputMode="numeric"
            placeholder="—"
            onChange={(event) => setDraft({ ...draft, crn: event.target.value })}
            onBlur={() => {
              const next = draft.crn.trim();
              if (next !== held.crn) saveCrn.mutate(next);
            }}
            className={`w-24 tabular-nums ${cell} ${verdict && verdict.status !== "matched" && draft.crn ? "border-[#e5b7b9] bg-[#fdf3f3]" : ""}`}
          />
          {draft.crn && verdict ? (
            verdict.status === "matched" ? (
              <Check size={13} className="ml-1 inline align-middle text-[#2f6b3d]" aria-label="In the timetable" />
            ) : (
              <AlertTriangle size={13} className="ml-1 inline align-middle text-[#a6292f]" aria-label={verdict.detail} />
            )
          ) : null}
          {draft.crn && portalRow === null ? <span className="block text-[11px] text-[#a6292f]">Not in the portal&apos;s list</span> : null}
        </td>
        <td className="py-1.5 pr-3">
          <select
            aria-label={`Teacher for ${label}`}
            value={draft.teacherId}
            onChange={(event) => commit({ teacherId: event.target.value })}
            className={`max-w-[14rem] ${cell}`}
          >
            <option value="">— not chosen —</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.fullName}
              </option>
            ))}
          </select>
          {portalTeacher && portalTeacher !== chosenName ? (
            <span className="block text-[11px] text-[#667085]" title="The teacher the portal lists for this CRN">
              Portal: {portalTeacher}
            </span>
          ) : null}
          {!draft.teacherId && held.teacher ? <span className="block text-[11px] text-[#98a2b3]">Was: {held.teacher}</span> : null}
        </td>
        <td className="py-1.5 pr-3">
          <input aria-label={`Hours for ${label}`} value={draft.hours} onChange={(event) => setDraft({ ...draft, hours: event.target.value })} onBlur={onBlur("hours")} className={`w-16 ${cell}`} />
        </td>
        <td className="py-1.5 pr-3">
          <input aria-label={`Sessions per week for ${label}`} value={draft.sessionsPerWeek} onChange={(event) => setDraft({ ...draft, sessionsPerWeek: event.target.value })} onBlur={onBlur("sessionsPerWeek")} className={`w-40 ${cell}`} />
        </td>
        <td className="py-1.5 pr-3">
          <input aria-label={`Duration for ${label}`} value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: event.target.value })} onBlur={onBlur("duration")} className={`w-16 ${cell}`} />
        </td>
        <td className="py-1.5 pr-3">
          <input aria-label={`Weeks for ${label}`} value={draft.weeks} onChange={(event) => setDraft({ ...draft, weeks: event.target.value })} onBlur={onBlur("weeks")} className={`w-28 ${cell}`} />
        </td>
        <td className="py-1.5 pr-3">
          <input
            aria-label={`Anticipated students for ${label}`}
            value={draft.anticipated || ""}
            inputMode="numeric"
            onChange={(event) => setDraft({ ...draft, anticipated: Number(event.target.value) || 0 })}
            onBlur={onBlur("anticipated")}
            className={`w-16 tabular-nums ${cell}`}
          />
        </td>
        <td className="py-1.5 pr-3">
          <input type="checkbox" aria-label={`Retire ${label}`} checked={draft.retired} onChange={(event) => commit({ retired: event.target.checked })} />
        </td>
        <td className="py-1.5 text-right">
          <button
            type="button"
            aria-label={`${more ? "Hide" : "Show"} preferences for ${label}`}
            aria-expanded={more}
            onClick={() => setMore((current) => !current)}
            className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
          >
            {more ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          </button>
        </td>
      </tr>
      {more ? (
        <tr className={`bg-[#fafbfc] ${dim}`}>
          <td colSpan={10} className="px-2 py-2">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {(
                [
                  ["roomPref", "Room preference"],
                  ["dayPref", "Day preference"],
                  ["timePref", "Time preference"],
                  ["constraints", "Constraints"],
                  ["comments", "Comments"],
                ] as [keyof Section, string][]
              ).map(([key, title]) => (
                <label key={key} className="text-[11px] font-semibold text-[#344054]">
                  {title}
                  <input
                    aria-label={`${title} for ${label}`}
                    value={String(draft[key] ?? "")}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    onBlur={onBlur(key)}
                    className={`mt-0.5 block w-full ${cell}`}
                  />
                </label>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
      {saveCrn.error || saveDetails.error ? (
        <tr>
          <td colSpan={10} className="px-2 py-1 text-xs text-[#a6292f]" role="alert">
            {((saveCrn.error ?? saveDetails.error) as Error).message}
          </td>
        </tr>
      ) : null}
    </>
  );
}
