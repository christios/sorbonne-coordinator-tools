import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { Modal } from "@/components/Modal";
import { SectionTimetable } from "@/components/SectionTimetable";
import { buildCards, rowsPerPart, teaches, type Card as CourseCard } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import {
  fetchActiveCourses,
  fetchActiveCrns,
  fetchRegisterCheck,
  fetchTermCrns,
  type ActiveCrn,
} from "@/services/portalLists";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * One course, in full — what the student record is for a person.
 *
 * A course was the only thing on these pages with no place of its own. Its CRNs were a
 * filtered view of the register, where it is taught was a card on another page, and what
 * was wrong with it was a line in a banner that named it in passing. Answering "what is
 * the state of MATH-351" meant three pages and holding the answer in your head.
 *
 * Three questions, in the order they get asked:
 *
 *   what the registrar has — the CRNs, who they say teaches each, how many registered
 *   where we teach it     — every cohort, set and group, and the section each holds
 *   what is wrong with it — the differences that name this course, and nothing else's
 *
 * Everything here is already fetched by some page or other, under the same query keys, so
 * opening this costs nothing that was not already in hand.
 */
export function CourseRecord({
  open,
  courseCode,
  onClose,
}: {
  open: boolean;
  courseCode: string;
  onClose: () => void;
}) {
  const code = courseCode.trim().toUpperCase();
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses, enabled: open });
  const crns = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: open });
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  const check = useQuery({ queryKey: ["register-check"], queryFn: () => fetchRegisterCheck(), enabled: open });

  const course = (courses.data ?? []).find((row) => row.courseCode.toUpperCase() === code) ?? null;
  const held = (crns.data ?? []).filter((row) => row.courseCode.toUpperCase() === code);
  const term = held[0]?.termCode ?? "";
  // The portal's own word about these CRNs — who it says teaches them, and how many it has
  // registered. Asked for the term the register holds them in, which is the only one it has.
  const portal = useQuery({
    queryKey: ["term-crns", term],
    queryFn: () => fetchTermCrns(term),
    enabled: open && Boolean(term),
  });

  const termName = (termId: string) => (terms.data ?? []).find((row) => row.id === termId)?.name ?? termId;
  const cards = buildCards(catalogues.data ?? [], termName, courses.data ?? []).filter(
    (card) => card.code.toUpperCase() === code,
  );

  /*
   * The group each CRN teaches, so the calendar's boxes say "TD 3" rather than a number
   * — walked off the cards, since nothing indexes the matrix by CRN.
   */
  const groupOf = new Map<string, string>();
  for (const card of cards) {
    for (const set of card.sets) {
      for (const entry of set.rows.filter((row) => teaches(row.group, row.course)).flatMap((row) => rowsPerPart(row))) {
        if (entry.section?.crn) groupOf.set(entry.section.crn, `${set.scope.code} ${entry.group.label}`);
      }
    }
  }
  const timetable = held.map((row) => ({
    termCode: row.termCode,
    crn: row.crn,
    code: row.courseCode,
    title: `CRN ${row.crn}`,
    label: groupOf.get(row.crn) ?? row.portalTitle ?? row.crn,
    staff: portal.data?.crns[row.crn]?.teacherName || row.teacherName,
    // One colour per section, not per course: every box here is the same course.
    colorKey: row.crn,
  }));

  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);

  const report = check.data;
  const differences = report
    ? [
        ...report.gone.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — we hold it, the portal has stopped listing it`),
        ...report.arrived.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — the portal lists it and we have not taken it in`),
        ...report.unregistered.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — on a card, and registered nowhere`),
        ...report.teacherDiffers.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} ${row.groupLabel} — we say ${row.ours}, the registrar says ${row.theirs}`),
        ...report.teacherUnnamed.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} ${row.groupLabel} — the registrar staffs it ${row.theirs} and we have not`),
        ...report.collides.filter((row) => row.ourCourse.toUpperCase() === code).map((row) => `${row.ourCrn} — ${row.weekday} ${row.startsAt}–${row.endsAt} against ${row.theirs.map((other) => other.courseCode || other.crn).join(", ")}`),
      ]
    : [];

  return (
    <Modal
      open={open}
      size="wide"
      title={code}
      description={course?.title || undefined}
      onClose={onClose}
      header={
        <dl className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
          <Field label="UE">{course?.ue || <Nothing />}</Field>
          <Field label="Mutualized">{course?.mutualized || <Nothing />}</Field>
          <Field label="CRNs registered">{held.length || <Nothing />}</Field>
          <Field label="Taught in">{cards.length ? `${cards.length} cohort-semester${cards.length === 1 ? "" : "s"}` : <Nothing />}</Field>
        </dl>
      }
    >
      {/*
       * Two columns, read down then across: the registrar's side — what it holds and what
       * is wrong with it — and ours — where we teach it and when it meets.
       */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <Card title="In the register" note="The CRNs the department answers for, and what the portal says about each.">
            {held.length === 0 ? (
              <Empty>Not in the register. Take the course in on Active courses and its CRNs come with it.</Empty>
            ) : (
              <ul className="divide-y divide-[#f2f4f7] text-sm">
                {held.map((row) => (
                  <RegisterLine key={row.id} row={row} portal={portal.data?.crns[row.crn] ?? null} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="What is wrong with it" note="The differences that name this course, and nothing else's.">
            {check.isLoading ? (
              <Empty>Reading the register…</Empty>
            ) : differences.length === 0 ? (
              <Empty>Nothing. Every CRN it holds is registered, staffed as we have it, and clear of other departments.</Empty>
            ) : (
              <ul className="space-y-1 text-sm text-[#8a6116]">
                {differences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Where we teach it" note="Every group of every set that holds a section of this course.">
            {cards.length === 0 ? (
              <Empty>On no course card yet. Add it to a set on Group schema.</Empty>
            ) : (
              <ul className="space-y-3 text-sm">
                {cards.map((card) => (
                  <TaughtIn key={card.key} card={card} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="When it meets" note="Every section of it on the registrar's timetable, one colour per CRN.">
            <SectionTimetable
              entries={timetable}
              compact
              title={`${code} — timetable`}
              openable={(crn) => held.some((row) => row.crn === crn)}
              onOpenCrn={(crn) => setShowingCrn(held.find((row) => row.crn === crn) ?? null)}
              emptyMessage="Not in the register, so the registrar has not been asked when it meets."
            />
          </Card>
        </div>
      </div>
        {showingCrn ? (
          <CrnRecord
            open
            row={showingCrn}
            siblings={held.filter((row) => row.termCode === showingCrn.termCode)}
            onClose={() => setShowingCrn(null)}
            onSaved={() => void crns.refetch()}
          />
        ) : null}
    </Modal>
  );
}

/** One CRN of the register, with the portal's own word beside ours. */
function RegisterLine({ row, portal }: { row: ActiveCrn; portal: { teacherName: string; registered?: number; status: string } | null }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
      <span className="font-medium tabular-nums text-[#344054]">{row.crn}</span>
      {row.parentCrn ? <span className="text-xs text-[#98a2b3]">under {row.parentCrn}</span> : null}
      <span className="text-[#667085]">{portal?.teacherName || <Nothing />}</span>
      {portal && portal.status !== "in_portal" ? (
        <span className="text-xs text-[#a6292f]">the portal has stopped listing it</span>
      ) : null}
      {portal?.registered ? (
        <span className="ml-auto text-xs tabular-nums text-[#98a2b3]">{portal.registered} registered</span>
      ) : null}
    </li>
  );
}

/** One cohort-semester's sections of this course, group by group. */
function TaughtIn({ card }: { card: CourseCard }) {
  return (
    <li>
      <p className="font-medium text-[#344054]">
        {card.cohortName} <span className="text-xs font-normal text-[#98a2b3]">{card.termName}</span>
      </p>
      {card.sets.map((set) => (
        <div key={set.scope.id} className="mt-1 pl-3">
          <p className="text-xs uppercase tracking-wide text-[#8a94a4]">{set.scope.code}</p>
          <ul className="text-sm">
            {set.rows
              .filter((row) => teaches(row.group, row.course))
              .flatMap((row) => rowsPerPart(row))
              .map((row) => {
                const section = row.section ? filled(row.section, set.course.request) : null;
                return (
                  <li key={`${row.group.id}|${row.section?.part ?? 1}`} className="flex flex-wrap items-baseline gap-x-3 py-0.5">
                    <span className="text-[#667085]">{row.group.label}</span>
                    <span className="tabular-nums text-[#344054]">{section?.crn || <Nothing />}</span>
                    <span className="text-[#667085]">{section?.teacher || <Nothing />}</span>
                    {section?.hours ? <span className="text-xs tabular-nums text-[#98a2b3]">{section.hours} h</span> : null}
                    {row.parts && row.parts > 1 ? (
                      <span className="text-xs text-[#1f4e79]">part {row.section?.part} of {row.parts}</span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </li>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#e4e8ef] bg-white px-4 py-3">
      <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
      {note ? <p className="mb-2 text-xs text-[#98a2b3]">{note}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">{label}</dt>
      <dd className="text-sm text-[#344054]">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#667085]">{children}</p>;
}

/** What a field says when it has nothing to say, rather than an empty space. */
function Nothing() {
  return <span className="text-[#c8d0da]">—</span>;
}
