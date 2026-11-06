/**
 * Which cohorts are a semester's, for the pages that ask for a semester before a cohort.
 *
 * A cohort is a year's — L1, 2026-27 — and is a semester's when that semester is of its
 * year, when it has sets or students in it, or when its portal terms include the one the
 * semester is linked to. So L1 is there in Semester 2 before anybody has rolled it over or
 * given it a set. Groups & CRNs, the Group schema and the Cohorts page all ask, and must
 * agree.
 */
export function cohortsIn<T extends { id: string; term?: string; terms: string[]; memberCounts?: Record<string, number> }>(
  cohorts: T[],
  semester: { id: string; portalTerm: string; year: string },
  hasSetsIn: (cohortId: string) => boolean,
): T[] {
  return cohorts.filter(
    (cohort) =>
      hasSetsIn(cohort.id) ||
      (cohort.memberCounts?.[semester.id] ?? 0) > 0 ||
      (semester.portalTerm !== "" && cohort.terms.includes(semester.portalTerm)) ||
      (semester.year !== "" && (cohort.term ?? "").trim() === semester.year),
  );
}
