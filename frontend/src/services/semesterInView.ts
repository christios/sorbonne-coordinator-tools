/**
 * The semester a page is about, and that semester's cohorts.
 *
 * Remembered with the Group schema's and Groups & CRNs' (SCHEMA_TERM), so choosing
 * Semester 2 on one of them means Semester 2 on the Cohorts page and on the Students table
 * too. A cohort holds its students semester by semester, and this is how a page knows
 * which semester's to show.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useRemembered } from "@/components/useRemembered";
import { fetchTermLinks } from "@/services/portalLists";
import { SCHEMA_TERM } from "@/services/remembered";
import { cohortsIn } from "@/services/semesterCohorts";
import { useSemesterYears } from "@/services/semesterYears";
import { fetchCourseCards, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

export function useSemesterInView(cohorts: Cohort[]) {
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);
  const yearOf = useSemesterYears();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const cards = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  const semesters = useMemo(() => terms.data ?? [], [terms.data]);
  const semesterCohortsOf = useCallback(
    (semesterId: string) => {
      const term = (terms.data ?? []).find((candidate) => candidate.id === semesterId);
      return cohortsIn(
        cohorts,
        { id: semesterId, portalTerm: links.data?.[semesterId] ?? "", year: term ? yearOf(term) : "" },
        (id) => (cards.data ?? []).some((held) => held.cohort.id === id && held.scopes.some((scope) => scope.termId === semesterId)),
      );
    },
    // `yearOf` is rebuilt every render; what it reads is `links.data`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, links.data, cards.data, terms.data],
  );
  const semester =
    semesters.find((term) => term.id === termId) ??
    semesters.find((term) => semesterCohortsOf(term.id).length > 0) ??
    semesters[0] ??
    null;
  const semesterCohorts = useMemo(
    () => (semester ? semesterCohortsOf(semester.id) : cohorts),
    [semester, semesterCohortsOf, cohorts],
  );
  /** The portal term the semester is linked to: "262720". Empty when it has none. */
  const portalTerm = semester ? (links.data?.[semester.id] ?? "") : "";
  return {
    termId,
    setTermId,
    semesters,
    semester,
    semesterCohorts,
    semesterCohortsOf,
    portalTerm,
    /** Until the semesters have been read, there is no semester to speak of. */
    settled: !terms.isLoading && !links.isLoading && !cards.isLoading,
    links: links.data ?? {},
  };
}
