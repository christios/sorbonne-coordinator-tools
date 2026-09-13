import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { Modal } from "@/components/Modal";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { SessionChangeList } from "@/components/SessionChangeList";
import { adjustmentsFor, fetchSessionChanges } from "@/services/sessionChanges";
import { buildCards } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers, fetchTermLinks, type ActiveCrn, type ActiveTeacher } from "@/services/portalLists";
import { sameTeacher, sectionsTaughtBy } from "@/services/teacherLoad";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * Enough of a teacher to open their record.
 *
 * A row from the department's list is one of these already; a row from the portal's own
 * list has no id of ours and calls its address `psuadEmail`, so both spellings are taken.
 */
export type TeacherRef = Pick<ActiveTeacher, "id" | "fullName"> & Partial<ActiveTeacher> & { psuadEmail?: string };

/** One fact, with room for the answer to be missing. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">{label}</p>
      <p className={`mt-0.5 text-sm ${value ? "text-[#344054]" : "text-[#c8d0da]"}`}>{value || "not said"}</p>
    </div>
  );
}

/**
 * One teacher, in full: who the portal and the department say they are, and what they
 * are actually teaching.
 *
 * The list pages answer "who is on the department's list" and stop there, so "what does
 * Samar teach, and how much of it" meant reading Groups & CRNs course by course. Both
 * halves are here, and the second is read the way the workbook reads it — through each
 * course's request — so a section that names nobody but whose course names this teacher
 * is counted as theirs, exactly as it will be in the file the timetabler receives.
 */
export function TeacherRecord({
  open,
  teacher,
  onClose,
}: {
  open: boolean;
  teacher: TeacherRef;
  onClose: () => void;
}) {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses, enabled: open });
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: open });
  // A teacher opened from the portal's list may not be on the department's; if they are,
  // their sections are found by our id rather than by the spelling of their name.
  const active = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers, enabled: open });
  const held =
    (teacher.id ? (active.data ?? []).find((row) => row.id === teacher.id) : null) ??
    (teacher.portalTeacherId
      ? (active.data ?? []).find((row) => row.portalTeacherId === teacher.portalTeacherId)
      : null) ??
    null;

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
  const parentOf = useMemo(
    () => new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn])),
    [registered.data],
  );
  const cards = useMemo(
    () => buildCards(catalogues.data ?? [], termName, courses.data ?? [], parentOf),
    [catalogues.data, terms.data, courses.data, parentOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const sections = useMemo(
    () => sectionsTaughtBy(cards, held?.id ?? teacher.id ?? "", teacher.fullName),
    [cards, held, teacher.id, teacher.fullName],
  );

  const live = sections.filter((section) => !section.retired);
  /*
   * When they teach, from the registrar's sweep.
   *
   * Two ways a section is theirs: our planning names them on it, or the portal's own list
   * staffs it with them. The second catches what the first has not been told yet — a CRN
   * the registrar gave them that nobody has put on a card — and both are hours they are
   * in a room, which is what a calendar is for.
   */
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open, retry: false });
  const ours: TimetableEntry[] = live
    .filter((section) => section.crn)
    .map((section) => ({
      termCode: links.data?.[section.termId] ?? "",
      crn: section.crn,
      code: section.courseCode,
      title: section.courseName,
      label: section.courseCode,
    }));
  const named = new Set(ours.map((entry) => entry.crn));
  const theirs: TimetableEntry[] = (registered.data ?? [])
    .filter((row) => !named.has(row.crn) && row.portalStatus === "in_portal" && sameTeacher(row.teacherName, teacher.fullName))
    .map((row) => ({ termCode: row.termCode, crn: row.crn, code: row.courseCode, title: row.courseTitle || row.portalTitle }));
  const timetable = [...ours, ...theirs];
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);

  /*
   * What happened to their classes, and the classes they stood in for.
   *
   * Their CRNs are the calendar's; a note on one of those is theirs whichever way it
   * went. A note naming them as the cover is theirs too, on somebody else's class.
   */
  const termCodes = [...new Set(timetable.map((entry) => entry.termCode).filter(Boolean))];
  const { notes } = useQueries({
    queries: termCodes.map((termCode) => ({
      queryKey: ["session-changes", termCode],
      queryFn: () => fetchSessionChanges(termCode),
      enabled: open,
      retry: false,
    })),
    combine: (reads) => ({ notes: reads.flatMap((read) => read.data ?? []) }),
  });
  const ownCrns = new Set(timetable.map((entry) => entry.crn));
  const me = { id: held?.id ?? teacher.id ?? "", name: teacher.fullName };
  const concerning = notes.filter(
    (note) =>
      ownCrns.has(note.crn) ||
      (note.kind === "covered" && ((me.id && note.coverTeacherId === me.id) || sameTeacher(note.coverTeacherName, me.name))),
  );
  const adjusted = adjustmentsFor(notes, me, ownCrns, sameTeacher);
  const courseOf = new Map(timetable.map((entry) => [entry.crn, `${entry.code} · CRN ${entry.crn}`]));
  const tally = [
    adjusted.cancelled ? `${adjusted.cancelled} h cancelled` : "",
    adjusted.coveredByOthers ? `${adjusted.coveredByOthers} h covered by others` : "",
    adjusted.coveredForOthers ? `${adjusted.coveredForOthers} h covered for others` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const inRegister = (crn: string) => (registered.data ?? []).find((row) => row.crn === crn) ?? null;
  const hours = live.reduce((sum, section) => sum + (Number(section.hours) || 0), 0);
  const students = live.reduce((sum, section) => sum + section.students, 0);
  const facts = held ?? teacher;

  return (
    <Modal
      open={open}
      size="wide"
      title={teacher.fullName || "This teacher"}
      description={
        [facts.type, facts.department, facts.institution].filter(Boolean).join(" · ") ||
        "What the portal and the part-time database say, and what they are teaching."
      }
      onClose={onClose}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Sections</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]">{live.length}</p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">
            {sections.length > live.length ? `${sections.length - live.length} more retired` : "this year"}
          </p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Hours</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]">{hours || "—"}</p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">as the timetable request has them</p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Students</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]">{students || "—"}</p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">placed in their groups</p>
        </div>
      </div>


      {/*
       * Who they are beside when they teach. The facts are nine short lines and the week
       * is a small grid; each on a row of its own left half the width empty.
       */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="grid gap-4 self-start rounded-lg border border-[#e4e8ef] bg-[#fbfcfe] px-4 py-3 sm:grid-cols-2">
          <Fact label="E-mail" value={facts.email || teacher.psuadEmail || ""} />
          <Fact label="Rank" value={facts.rank ?? ""} />
          <Fact label="Category" value={facts.category ?? ""} />
          <Fact label="Department" value={facts.department ?? ""} />
          <Fact label="Institution" value={facts.institution ?? ""} />
          <Fact label="Last term in the portal" value={facts.lastTerm ?? ""} />
          <Fact label="Portal ID" value={facts.portalTeacherId ?? ""} />
          <Fact
            label="On the department's list"
            value={held ? `yes, since ${held.addedAt.slice(0, 10)}` : "no — chosen on the Teachers page"}
          />
          <Fact label="Courses the portal lists" value={facts.courses ?? ""} />
        </div>
        <section>
          <h4 className="text-sm font-semibold text-[#171717]">When they teach</h4>
          <p className="mb-2 text-xs text-[#98a2b3]">
            From the registrar&apos;s timetable: the sections above, and any the portal staffs with them.
          </p>
          <SectionTimetable
            entries={timetable}
            compact
            title={`${teacher.fullName || "This teacher"} — timetable`}
            openable={(crn) => Boolean(inRegister(crn))}
            onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
            emptyMessage="No section of theirs carries a CRN yet, so there is no week to show."
          />
        </section>
      </div>

      <h4 className="mt-6 text-sm font-semibold text-[#171717]">Changes to their classes</h4>
      <p className="mb-2 text-xs text-[#98a2b3]">
        Cancelled, covered by somebody else, or covered by them — as said on the CRNs&apos; calendars.
        {tally ? ` ${tally}.` : ""}
      </p>
      <SessionChangeList
        changes={concerning}
        nameOf={(crn) => courseOf.get(crn) ?? `CRN ${crn}`}
        empty="Nothing noted on their classes this semester."
      />

      <h4 className="mt-6 text-sm font-semibold text-[#171717]">What they teach</h4>
      {catalogues.isLoading ? (
        <p className="mt-2 text-sm text-[#667085]">Reading the sections…</p>
      ) : sections.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-6 text-center text-sm text-[#667085]">
          No section names them. A section is given its teacher on Groups &amp; CRNs.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
          <table className="w-full min-w-[38rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#e4e8ef] text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">
                <th scope="col" className="px-3 py-2 text-left">Course</th>
                <th scope="col" className="px-3 py-2 text-left">Section</th>
                <th scope="col" className="px-3 py-2 text-left">Cohort</th>
                <th scope="col" className="px-3 py-2 text-right">CRN</th>
                <th scope="col" className="px-3 py-2 text-right">Hours</th>
                <th scope="col" className="px-3 py-2 text-right">Students</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.key} className={`border-b border-[#f2f4f7] last:border-0 ${section.retired ? "text-[#c8d0da]" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium tabular-nums">{section.courseCode}</span>
                    <span className={`ml-2 ${section.retired ? "" : "text-[#667085]"}`}>{section.courseName}</span>
                    {section.retired ? <span className="ml-2 text-[11px]">retired</span> : null}
                  </td>
                  <td className="px-3 py-2">{section.scopeCode} {section.groupLabel}</td>
                  <td className={`px-3 py-2 ${section.retired ? "" : "text-[#667085]"}`}>
                    {section.cohortName} · {section.termName || "no semester"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {section.crn || <span className="text-[#c8d0da]">none</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {section.hours || <span className="text-[#c8d0da]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{section.students}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(registered.data ?? []).filter((row) => row.courseCode === showingCrn.courseCode && row.termCode === showingCrn.termCode)}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void registered.refetch()}
        />
      ) : null}
    </Modal>
  );
}
