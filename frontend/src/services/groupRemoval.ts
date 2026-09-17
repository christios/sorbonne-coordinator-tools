/**
 * Taking students out of the groups they hold, for one semester.
 *
 * Removing somebody used to be the last line of a dialog about moving them: "Move to
 * cohort…", then a dropdown of twenty cohorts, then "Take them out of their cohort" at the
 * bottom of it. The act is not a move and reading it as one cost a coordinator two guesses
 * — which cohort, and then whether the last option really meant what it said.
 *
 * Two acts, not one, and they are different sizes. Out of a cohort drops every group in
 * every semester and is how somebody leaves the department's care. Out of their groups
 * keeps the cohort and empties one semester, which is what "they are repeating the year"
 * or "they never turned up" actually means.
 *
 * Nothing here writes. It works out what a removal would cost so the confirm can list it,
 * because a number is something to click past and a list of groups is something to read.
 */

import type { Student } from "@/services/studentDatabase";

/** One semester the chosen students hold groups in, and what emptying it would cost. */
export type SemesterHeld = {
  termId: string;
  termName: string;
  /** Group placements that would be given up. */
  placements: number;
  /** How many of the chosen hold at least one. */
  students: number;
  /** "TD 1", "LANG A0-F5" — what actually goes, so the confirm is a list and not a number. */
  groups: string[];
  /** Of those, the ones in sets open to every cohort: the languages. */
  shared: string[];
};

const labelOf = (group: { scopeCode: string; groupLabel: string }) =>
  `${group.scopeCode} ${group.groupLabel}`.trim();

/**
 * Every semester the chosen students hold a group in, worst first.
 *
 * Derived from the rows already on screen rather than asked for, so the dialog can name
 * the semester instead of offering a picker of every semester the department has ever run
 * — the answer is only ever one of the two or three they are actually in.
 */
export function semestersHeldBy(
  students: Student[],
  chosen: string[],
  termNames: Record<string, string>,
): SemesterHeld[] {
  const wanted = new Set(chosen);
  const held = new Map<string, SemesterHeld & { who: Set<string> }>();
  for (const student of students) {
    if (!wanted.has(student.studentId)) continue;
    for (const group of student.groups) {
      const seen =
        held.get(group.termId) ??
        {
          termId: group.termId,
          termName: termNames[group.termId] ?? group.termId,
          placements: 0,
          students: 0,
          groups: [],
          shared: [],
          who: new Set<string>(),
        };
      seen.placements += 1;
      seen.who.add(student.studentId);
      const label = labelOf(group);
      // Named once however many of them are in it: the confirm is about which groups
      // empty out, not about how many students sit in each.
      if (!seen.groups.includes(label)) seen.groups.push(label);
      if (group.openToAll && !seen.shared.includes(label)) seen.shared.push(label);
      held.set(group.termId, seen);
    }
  }
  return [...held.values()]
    .map(({ who, ...rest }) => ({ ...rest, students: who.size, groups: [...rest.groups].sort() }))
    .sort((left, right) => right.placements - left.placements || left.termName.localeCompare(right.termName));
}

/** What emptying one semester would throw away, as a sentence a person can act on. */
export function describeRemoval(held: SemesterHeld | null): string {
  if (!held || held.placements === 0) return "";
  const students = `${held.students} student${held.students === 1 ? "" : "s"}`;
  const placements = `${held.placements} group placement${held.placements === 1 ? "" : "s"}`;
  const shared = held.shared.length
    ? ` ${held.shared.join(", ")} ${held.shared.length === 1 ? "is a set" : "are sets"} open to every cohort — the ` +
      `languages — so ${held.shared.length === 1 ? "it is" : "they are"} given up too.`
    : "";
  return (
    `${students} would give up ${placements} in ${held.termName}: ${held.groups.join(", ")}. ` +
    `Their cohort is unchanged, and no other semester is touched. Somebody will have to place ` +
    `them again. This cannot be undone.${shared}`
  );
}

/** Which of a semester's sets the chosen students actually hold a group in. */
export function setsToEmpty(
  students: Student[],
  chosen: string[],
  termId: string,
  scopes: { id: string; code: string }[],
): string[] {
  const wanted = new Set(chosen);
  const codes = new Set<string>();
  for (const student of students) {
    if (!wanted.has(student.studentId)) continue;
    for (const group of student.groups) {
      if (group.termId === termId) codes.add(group.scopeCode);
    }
  }
  // Only the sets they are in: a write to a set holding none of them is a request that
  // says nothing, and the removal is one request per set.
  return scopes.filter((scope) => codes.has(scope.code)).map((scope) => scope.id);
}
