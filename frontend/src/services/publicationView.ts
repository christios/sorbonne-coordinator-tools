/**
 * What the publish screen says, and when it will let you press the button.
 *
 * Pure, because these are the rules that decide whether 180 students keep their timetable.
 * The screen renders; this decides.
 *
 * The governing idea: publishing replaces. Every number here exists so that a coordinator
 * can tell the difference between "this is the change I meant to make" and "I am about to
 * remove a cohort I forgot to fill", which look identical if you only count what was added.
 */

import type {
  ClashWindow,
  CohortReadiness,
  CrnVerdict,
  GroupClash,
  Publication,
  PublicationPreview,
} from "@/services/publication";

/** How serious a thing standing in the way is. */
export type Severity = "blocking" | "warning" | "clear";

export type Blocker = {
  severity: Severity;
  label: string;
  detail: string;
};

/**
 * Everything stopping this semester going out, worst first.
 *
 * A CRN that is not in the timetable blocks: it enrols nobody, silently. Students with no
 * group block too — they are not a smaller timetable, they are a person who will be taught
 * nothing. A cohort with no blocks at all is only a warning, because a semester where L2 has
 * not been set up yet is a normal state of affairs halfway through August.
 */
export function blockersOf(publication: Publication): Blocker[] {
  const blockers: Blocker[] = [];

  if (publication.unmatchedCrns > 0) {
    blockers.push({
      severity: "blocking",
      label: `${publication.unmatchedCrns} CRN${publication.unmatchedCrns === 1 ? "" : "s"} not in the timetable`,
      detail: "A group pointing at a section that does not exist enrols nobody in it.",
    });
  }

  for (const cohort of publication.cohorts) {
    const missing = Object.values(cohort.unassigned).reduce((total, students) => total + students.length, 0);
    if (missing > 0) {
      blockers.push({
        severity: "blocking",
        label: `${cohort.cohort}: ${missing} student${missing === 1 ? "" : "s"} with no group`,
        detail: cohort.warnings.join(" · "),
      });
    } else if (!cohort.isReady) {
      blockers.push({ severity: "warning", label: cohort.cohort, detail: cohort.warnings.join(" · ") });
    }
  }

  if (publication.cohorts.length === 0) {
    blockers.push({
      severity: "warning",
      label: "No cohort has blocks for this semester",
      detail: "Point a cohort's blocks at it before publishing.",
    });
  }

  return blockers.sort((left, right) => rank(left.severity) - rank(right.severity));
}

function rank(severity: Severity): number {
  return severity === "blocking" ? 0 : severity === "warning" ? 1 : 2;
}

/**
 * Whether the change is big enough to want a second look.
 *
 * Not a blocker — removing people is sometimes exactly right — but a publish that takes the
 * timetable away from more students than it gives one to is worth stopping at.
 */
export function isDestructive(preview: PublicationPreview): boolean {
  return preview.summary.studentsLosingEverything > 0;
}

/** The one sentence that has to be true before somebody presses publish. */
export function describeChange(preview: PublicationPreview): string {
  const { summary } = preview;
  if (summary.enrolmentsAdded === 0 && summary.enrolmentsRemoved === 0) {
    return "Students already see exactly this. Publishing would change nothing.";
  }
  const parts: string[] = [];
  if (summary.enrolmentsAdded) parts.push(`${summary.enrolmentsAdded} enrolment(s) added`);
  if (summary.enrolmentsRemoved) parts.push(`${summary.enrolmentsRemoved} removed`);
  const tail =
    summary.studentsLosingEverything > 0
      ? ` — ${summary.studentsLosingEverything} student(s) would be left with no timetable at all`
      : "";
  return `${parts.join(", ")}${tail}.`;
}

/** The verdict for one cell of the catalogue, if there is one. */
export function verdictFor(
  validation: Record<string, CrnVerdict>,
  groupId: string,
  courseCode: string,
): CrnVerdict | undefined {
  return validation[`${groupId}|${courseCode}`];
}

/** Cohorts worth showing first: the ones with something wrong. */
export function sortCohorts(cohorts: CohortReadiness[]): CohortReadiness[] {
  return [...cohorts].sort((left, right) => {
    if (left.isReady !== right.isReady) return left.isReady ? 1 : -1;
    return left.cohort.localeCompare(right.cohort, undefined, { numeric: true, sensitivity: "accent" });
  });
}

/** Who this cohort has not placed in a block yet, for the semester being looked at. */
export type Unplaced = {
  /** Distinct students missing from at least one block. */
  total: number;
  /** One entry per block that is missing somebody, worst first. */
  byBlock: { scopeCode: string; count: number }[];
  /** Every id involved, so the Students table can be opened on exactly them. */
  ids: string[];
};

/**
 * A student in no block gets a blank timetable, and nothing else says so.
 *
 * The publish screen already refuses to go out with them, but that is the last possible
 * moment to find out — by then the semester is meant to be finished. This is the same fact
 * carried back to where the placing happens.
 *
 * Counted per block and then de-duplicated: somebody missing from both CM and TD is two
 * gaps to fill and one person to find, and the sentence has to be able to say both.
 */
export function unplacedIn(publication: Publication, cohortId: string): Unplaced {
  const cohort = publication.cohorts.find((candidate) => candidate.cohortId === cohortId);
  if (!cohort) return { total: 0, byBlock: [], ids: [] };

  const byBlock = Object.entries(cohort.unassigned)
    .map(([scopeCode, students]) => ({ scopeCode, count: students.length }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count || left.scopeCode.localeCompare(right.scopeCode));

  const ids = [...new Set(Object.values(cohort.unassigned).flat())].sort();
  return { total: ids.length, byBlock, ids };
}

/** The groups of one cohort that meet at the same hour, worst first — as the report has them. */
export function clashesIn(publication: Publication, cohortId: string): GroupClash[] {
  return publication.cohorts.find((candidate) => candidate.cohortId === cohortId)?.clashes ?? [];
}

/** "CM A × TD 1", or "TD 1 (its own CRNs)" when a group clashes with itself. */
export function clashName(clash: GroupClash): string {
  const names = clash.groups.map((group) => `${group.scopeCode} ${group.label}`.trim());
  return names.length === 1 ? `${names[0]} (its own CRNs)` : names.join(" × ");
}

/** "Mon 08:30–10:00 (22151 / 23652) ×14" — the hour, the two CRNs, and how often. */
export function describeClashWindow(window: ClashWindow): string {
  const often = window.dates > 1 ? ` ×${window.dates}` : "";
  return `${window.weekday} ${window.start}–${window.end} (${window.crns.join(" / ")})${often}`;
}
