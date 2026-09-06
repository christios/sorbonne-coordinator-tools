import { AlertTriangle, Check, Pencil, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { SectionDialog } from "@/components/CourseCard";
import type { Card, CardSet, SectionRow } from "@/services/courseCards";
import { MUTUALIZED_WORDS, type ActiveTeacher, type TermCrns } from "@/services/portalLists";
import type { CrnVerdict, GroupClash, Publication } from "@/services/publication";
import { verdictFor } from "@/services/publicationView";
import { EMPTY_SECTION, type Cohort, type Section } from "@/services/studentDatabase";

const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";

/** "room 12 · avoid Fridays" — what a section asks of the timetable, in one line. */
function asks(section: Section): string {
  return [section.roomPref, section.dayPref, section.timePref, section.constraints, section.comments]
    .filter(Boolean)
    .join(" · ");
}

/**
 * One section, as a block rather than a row of a wide table.
 *
 * The table this replaces had ten columns and scrolled sideways inside a card, which put
 * the constraint — the sentence the timetabler most needs to read — in a squeezed column
 * off the right edge. Here the numbers sit on one line and the sentence has the width of
 * the block, which is what it needs.
 */
function SectionBlock({
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
  const asked = asks(held);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      aria-label={`Edit ${label}`}
      className={`group cursor-pointer rounded-lg border px-3.5 py-3 text-left transition hover:border-[#b7c6d8] hover:shadow-sm ${
        held.retired ? "border-dashed border-[#e4e8ef] bg-[#fcfdfe]" : "border-[#e4e8ef] bg-white"
      }`}
    >
      <header className="flex items-baseline gap-2">
        <h4 className={`text-sm font-semibold ${held.retired ? "text-[#98a2b3]" : "text-[#171717]"}`}>
          {row.scope.code} {row.group.label}
        </h4>
        {held.retired ? <span className={`${chip} bg-[#f2f4f7] text-[#98a2b3]`}>retired</span> : null}
        <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
          {held.crn ? (
            <>
              <span className={`text-sm ${verdict && verdict.status !== "matched" ? "text-[#a6292f]" : "text-[#667085]"}`}>{held.crn}</span>
              {verdict ? (
                verdict.status === "matched" ? (
                  <Check size={13} className="text-[#2f6b3d]" aria-label="In the timetable" />
                ) : (
                  <AlertTriangle size={13} className="text-[#a6292f]" aria-label={verdict.detail} />
                )
              ) : null}
            </>
          ) : held.retired ? null : (
            <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>no CRN</span>
          )}
        </span>
        <Pencil size={13} className="shrink-0 text-transparent group-hover:text-[#98a2b3]" aria-hidden="true" />
      </header>

      <p className="mt-1 truncate text-sm">
        {chosen ? (
          <span className="text-[#344054]">{chosen}</span>
        ) : held.teacher ? (
          <span className="text-[#667085]" title="Named on the row, but not chosen from Active teachers yet">
            {held.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
          </span>
        ) : (
          <span className="text-[#c8d0da]">nobody yet</span>
        )}
      </p>

      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-[#98a2b3]">
        <span>{row.group.capacity ? `${row.group.assigned}/${row.group.capacity} students` : `${row.group.assigned} students`}</span>
        {held.hours ? <span>{held.hours} h</span> : null}
        {held.sessionsPerWeek ? <span>{held.sessionsPerWeek}/week</span> : null}
        {held.duration ? <span>{held.duration} h each</span> : null}
        {held.weeks ? <span>weeks {held.weeks}</span> : null}
        {held.anticipated ? <span>{held.anticipated} expected</span> : null}
      </p>

      {asked ? <p className="mt-1.5 text-xs leading-5 text-[#667085]">{asked}</p> : null}
      {held.crn && portalRow === null ? (
        <p className="mt-1 text-[11px] text-[#a6292f]">Not in the portal&apos;s list for this semester.</p>
      ) : null}
      {portalRow?.teacherName && portalRow.teacherName !== chosen ? (
        <p className="mt-1 text-[11px] text-[#98a2b3]">Portal: {portalRow.teacherName}</p>
      ) : null}
    </article>
  );
}

/**
 * One course, in full: its sets, and under each the sections anybody teaches of it.
 *
 * Everything this course has to say is said here, where there is room to say it — which
 * is the whole point of choosing one course at a time rather than opening fifteen boxes.
 * The course's own facts (title, UE, whether it is mutualized) are the active course's
 * and are changed on the Courses page, not here; what is changed here is a section.
 */
export function CourseDetail({
  card,
  cohort,
  teachers,
  portal,
  publication,
  unassigned,
  clashes,
  action,
  onChanged,
  onFilled,
}: {
  card: Card;
  cohort: Cohort | null;
  /** Something the whole semester's request needs, shown where the semester is named. */
  action?: ReactNode;
  teachers: ActiveTeacher[];
  portal: TermCrns | null;
  publication: Publication | null;
  unassigned: Record<string, string[]>;
  clashes: GroupClash[] | null;
  onChanged: () => void;
  onFilled: (report: FillReport) => void;
}) {
  const [editing, setEditing] = useState<SectionRow | null>(null);
  const [filling, setFilling] = useState<CardSet | null>(null);
  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? "";
  const validation = publication?.validation ?? {};

  return (
    <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-[#eef1f5] px-5 py-4">
        <h3 className="text-lg font-semibold tabular-nums text-[#171717]">{card.code}</h3>
        <p className="text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</p>
        {card.ue ? <span className="text-xs tabular-nums text-[#98a2b3]">{card.ue}</span> : null}
        {card.active?.mutualized ? (
          <span className={`${chip} ${card.active.mutualized === "yes" ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"}`}>
            {MUTUALIZED_WORDS[card.active.mutualized]}
          </span>
        ) : null}
        {!card.active ? (
          <span className={`${chip} bg-[#fdf9ee] text-[#8a6116]`} title="Choose it on the Courses page so it carries a UE and a parent CRN">
            Not on the active list
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          <span className="text-xs text-[#98a2b3]">
            {card.cohortName} · {card.termName || "no semester"}
          </span>
          {action}
        </span>
      </header>

      <div className="space-y-6 px-5 py-4">
        {card.sets.map((set) => {
          const left = unassigned[set.scope.code]?.length ?? 0;
          return (
            <div key={set.scope.id}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
                {set.scope.name && set.scope.name !== set.scope.code ? (
                  <span className="text-[#667085]">{set.scope.name}</span>
                ) : null}
                <span className="text-xs text-[#98a2b3]">
                  {set.rows.length} section{set.rows.length === 1 ? "" : "s"}
                  {/* A component named after its set — "CM · CM" — says it twice. */}
                  {set.course.component && set.course.component !== set.scope.code ? ` · ${set.course.component}` : ""}
                </span>
                {set.scope.openToAll ? (
                  <span className={`${chip} bg-[#e8edf3] text-[#1f4e79]`}>Across cohorts</span>
                ) : null}
                {left ? (
                  <span className={`${chip} inline-flex items-center gap-1 bg-[#fdf9ee] text-[#8a6116]`}>
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

              <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                {set.rows.map((row) => (
                  <SectionBlock
                    key={row.group.id}
                    row={row}
                    teacherName={teacherName}
                    portal={portal}
                    verdict={verdictFor(validation, row.group.id, row.course.code)}
                    onEdit={() => setEditing(row)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

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
    </section>
  );
}
