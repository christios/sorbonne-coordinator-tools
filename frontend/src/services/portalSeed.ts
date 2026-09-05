/**
 * Starting a course card from the portal's own list of CRNs.
 *
 * The portal knows every section it has made for a term: the CRN, the course, the
 * title, who teaches it, how many are registered. Typing those in again is how a CRN
 * gets a digit wrong. So a card starts from the portal: pick the course, say which group
 * set and group each of its CRNs is, and the sections are made — teacher name carried
 * across as the portal's word, to be confirmed against Active teachers on the card.
 */

import type { TermCrns } from "@/services/portalLists";
import type { CatalogueScope } from "@/services/studentDatabase";

export type PortalCourseChoice = {
  courseCode: string;
  title: string;
  sections: { crn: string; teacherName: string; status: string }[];
};

/** The term's CRNs grouped by course, as the picker lists them. */
export function portalCourses(crns: TermCrns["crns"]): PortalCourseChoice[] {
  const byCode = new Map<string, PortalCourseChoice>();
  for (const [crn, row] of Object.entries(crns)) {
    if (!row.courseCode) continue;
    const held = byCode.get(row.courseCode) ?? { courseCode: row.courseCode, title: row.title, sections: [] };
    held.title ||= row.title;
    held.sections.push({ crn, teacherName: row.teacherName, status: row.status });
    byCode.set(row.courseCode, held);
  }
  for (const course of byCode.values()) {
    course.sections.sort((left, right) => left.crn.localeCompare(right.crn, undefined, { numeric: true }));
  }
  return [...byCode.values()].sort((left, right) => left.courseCode.localeCompare(right.courseCode, undefined, { numeric: true }));
}

/** Where one CRN goes: which set, and which group in it — by label, made if missing. */
export type SeedRow = { crn: string; teacherName: string; scopeId: string; groupLabel: string; skip: boolean };

/**
 * A first guess at where a course's CRNs go, for the coordinator to correct.
 *
 * One CRN in a set of one group is that group. Several go to the set's groups in order,
 * and past the last existing group the labels keep counting, so a course with six TD
 * sections in a set of four groups proposes groups 5 and 6.
 */
export function proposeRows(course: PortalCourseChoice, scope: CatalogueScope | null): SeedRow[] {
  return course.sections.map((section, index) => {
    const label = scope?.groups[index]?.label ?? String(index + 1);
    return { crn: section.crn, teacherName: section.teacherName, scopeId: scope?.id ?? "", groupLabel: label, skip: section.status !== "in_portal" };
  });
}

export type SeedStep =
  | { kind: "course"; scopeId: string; code: string; name: string; component: string }
  | { kind: "group"; scopeId: string; label: string }
  | { kind: "section"; scopeId: string; groupLabel: string; code: string; crn: string; teacherName: string };

/**
 * What has to be made, in order: the course row in each set it lands in, the groups the
 * rows name that the set does not have, then every section. Pure, so the page can show
 * it before doing it.
 */
export function seedSteps(course: PortalCourseChoice, rows: SeedRow[], scopes: CatalogueScope[]): SeedStep[] {
  const steps: SeedStep[] = [];
  const kept = rows.filter((row) => !row.skip && row.scopeId && row.groupLabel.trim());
  const byScope = new Map<string, SeedRow[]>();
  for (const row of kept) byScope.set(row.scopeId, [...(byScope.get(row.scopeId) ?? []), row]);
  for (const [scopeId, held] of byScope) {
    const scope = scopes.find((candidate) => candidate.id === scopeId);
    if (!scope) continue;
    if (!scope.courses.some((candidate) => candidate.code.toUpperCase() === course.courseCode.toUpperCase())) {
      steps.push({ kind: "course", scopeId, code: course.courseCode, name: course.title, component: scope.code });
    }
    const labels = new Set(scope.groups.map((group) => group.label.toUpperCase()));
    for (const row of held) {
      const label = row.groupLabel.trim();
      if (!labels.has(label.toUpperCase())) {
        steps.push({ kind: "group", scopeId, label });
        labels.add(label.toUpperCase());
      }
      steps.push({ kind: "section", scopeId, groupLabel: label, code: course.courseCode, crn: row.crn, teacherName: row.teacherName });
    }
  }
  return steps;
}
