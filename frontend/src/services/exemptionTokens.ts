/**
 * What a student is exempt from, as the tables' "Exempt from" column says it.
 *
 * One entry per course: "SCEN-101 · LEA track". Where they are exempt from one set's part
 * of a course their cohort teaches in several sets, the part is named — "PHYS-125 (MTP)" —
 * since that is a different fact from not taking the course at all.
 */

import type { CohortCatalogue, Exemption } from "@/services/studentDatabase";

export function exemptionTokens(
  exemptions: Exemption[],
  cohortOf: (studentId: string) => string | null,
  cards: CohortCatalogue[],
): Map<string, string[]> {
  // Which sets carry each course, per cohort — a shared set counts for every cohort.
  const open = cards.flatMap((card) => card.scopes.filter((scope) => scope.openToAll));
  const setsCarrying = (cohortId: string | null, code: string) => {
    const own = cards.find((card) => card.cohort.id === cohortId)?.scopes ?? [];
    return new Set(
      [...own, ...open].filter((scope) => scope.courses.some((course) => course.code === code)).map((scope) => scope.code),
    );
  };
  const byStudent = new Map<string, Map<string, { sets: Set<string>; reasons: Set<string> }>>();
  for (const entry of exemptions) {
    const courses = byStudent.get(entry.studentId) ?? new Map();
    const held = courses.get(entry.courseCode) ?? { sets: new Set<string>(), reasons: new Set<string>() };
    held.sets.add(entry.scopeCode);
    if (entry.reason.trim()) held.reasons.add(entry.reason.trim());
    courses.set(entry.courseCode, held);
    byStudent.set(entry.studentId, courses);
  }
  const tokens = new Map<string, string[]>();
  for (const [studentId, courses] of byStudent) {
    tokens.set(
      studentId,
      [...courses.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, { sets, reasons }]) => {
          const carrying = setsCarrying(cohortOf(studentId), code);
          const part = carrying.size > sets.size ? ` (${[...sets].sort().join(", ")})` : "";
          return `${code}${part}${reasons.size ? ` · ${[...reasons].join(", ")}` : ""}`;
        }),
    );
  }
  return tokens;
}
