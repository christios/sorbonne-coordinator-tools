/**
 * A part-time teacher's week, on their profile.
 *
 * Only for a profile somebody has joined to an Active teacher on the Active teachers page:
 * that join is what says which sections are theirs, the same way the teacher's record and
 * the time sheets read it. Without it there is no week to draw, and the profile offers no
 * tab rather than an empty one.
 *
 * The week itself is built exactly as the teacher's record builds it — see
 * services/personTimetable — from the same queries under the same keys, so the two agree
 * and opening one after the other asks the server for nothing twice.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { SectionTimetable } from "@/components/SectionTimetable";
import { buildCards } from "@/services/courseCards";
import { teacherTimetable } from "@/services/personTimetable";
import {
  type ActiveCrn,
  type ActiveTeacher,
  fetchActiveCourses,
  fetchActiveCrns,
  fetchTermLinks,
} from "@/services/portalLists";
import { fetchSessionChanges } from "@/services/sessionChanges";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

export function TeacherProfileTimetable({ teacher }: { teacher: Pick<ActiveTeacher, "id" | "fullName"> }) {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
  const parentOf = useMemo(
    () => new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn])),
    [registered.data],
  );
  const cards = useMemo(
    () => buildCards(catalogues.data ?? [], termName, courses.data ?? [], parentOf),
    [catalogues.data, terms.data, courses.data, parentOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Every linked semester's notes, so a class they covered is drawn wherever it fell.
  const noteTermCodes = [...new Set(Object.values(links.data ?? {}).filter(Boolean))];
  const { notes } = useQueries({
    queries: noteTermCodes.map((termCode) => ({
      queryKey: ["session-changes", termCode],
      queryFn: () => fetchSessionChanges(termCode),
      retry: false,
    })),
    combine: (reads) => ({ notes: reads.flatMap((read) => read.data ?? []) }),
  });
  const entries = useMemo(
    () =>
      teacherTimetable({
        cards,
        links: links.data ?? {},
        registered: registered.data ?? [],
        notes,
        teacher: { id: teacher.id, fullName: teacher.fullName },
      }),
    [cards, links.data, registered.data, notes, teacher.id, teacher.fullName],
  );
  const inRegister = (crn: string) => (registered.data ?? []).find((row) => row.crn === crn) ?? null;

  if (catalogues.isLoading || registered.isLoading) {
    return <p className="py-6 text-sm text-[#667085]">Reading their sections…</p>;
  }
  return (
    <>
      <SectionTimetable
        entries={entries}
        title={`${teacher.fullName} — timetable`}
        keepWeekAs="part-time-teacher-week"
        openable={(crn) => Boolean(inRegister(crn))}
        onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
        emptyMessage="No section of theirs carries a CRN yet, so there is no week to show."
      />
      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(registered.data ?? []).filter(
            (row) => row.courseCode === showingCrn.courseCode && row.termCode === showingCrn.termCode,
          )}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void registered.refetch()}
        />
      ) : null}
    </>
  );
}
