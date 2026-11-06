/**
 * Which cohorts are a semester's, for the pages that ask for a semester before a cohort.
 *
 * A cohort is a semester's when it has sets in it, or when its portal terms include the
 * portal term the semester is linked to — so a cohort just created for the semester is
 * there before anybody has given it a set. Groups & CRNs and the Cohorts page both ask, and
 * must agree: L1-S2 cannot be a Semester 2 cohort on one page and not on the other.
 */
export function cohortsIn<T extends { id: string; terms: string[] }>(
  cohorts: T[],
  portalTerm: string,
  hasSetsIn: (cohortId: string) => boolean,
): T[] {
  return cohorts.filter((cohort) => hasSetsIn(cohort.id) || (portalTerm !== "" && cohort.terms.includes(portalTerm)));
}
