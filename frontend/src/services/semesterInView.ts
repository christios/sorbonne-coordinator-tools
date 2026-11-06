/**
 * The semester a page is about, and that semester's cohorts.
 *
 * Remembered with the Group schema's and Groups & CRNs' (SCHEMA_TERM), so choosing
 * Semester 2 on one of them means Semester 2 on the Cohorts page and on the Students table
 * too. A student is in one cohort per semester — L1-S1, then L1-S2 — and this is how a page
 * knows which of theirs to show.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useRemembered } from "@/components/useRemembered";
import { fetchTermLinks } from "@/services/portalLists";
import { SCHEMA_TERM } from "@/services/remembered";
import { cohortsIn } from "@/services/semesterCohorts";
import { fetchCourseCards, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

export function useSemesterInView(cohorts: Cohort[]) {
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const cards = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  const semesters = useMemo(() => terms.data ?? [], [terms.data]);
  const semesterCohortsOf = useCallback(
    (semesterId: string) =>
      cohortsIn(cohorts, links.data?.[semesterId] ?? "", (id) =>
        (cards.data ?? []).some((held) => held.cohort.id === id && held.scopes.some((scope) => scope.termId === semesterId)),
      ),
    [cohorts, links.data, cards.data],
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
