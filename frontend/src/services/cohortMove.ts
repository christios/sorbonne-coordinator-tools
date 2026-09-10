import type { Student } from "@/services/studentDatabase";

export type MoveCost = {
  /** Students who would lose at least one placement. */
  students: number;
  /** Group assignments dropped, across every semester. */
  placements: number;
  /** The semesters they are in, named, so the cost is not read as "this one". */
  semesters: string[];
  /**
   * Placements the move KEEPS: the sets open to every cohort.
   *
   * Counted and said, because a warning that overstates the damage is trusted no more than
   * one that understates it. A student moving from L1 to L2 keeps their language group —
   * that set is the university's, not the cohort's — and the dialog used to threaten it.
   */
  retained: number;
};

/**
 * What a move to another cohort would throw away.
 *
 * Leaving a cohort drops every group the student held in it — the groups belong to that
 * cohort's blocks, so keeping them would seat somebody in a matrix they are no longer
 * part of. That is right, and it is silent, and it is not confined to the semester on
 * screen: a student moved in June loses the placements somebody made for them in
 * September. Counting them first is what makes the deletion a decision.
 *
 * The test is whether they are already in the cohort being moved to: if they are, the
 * move costs nothing.
 *
 * The two sides ask the same question now. An earlier note here worried that the server
 * deleted on the cohort each ASSIGNMENT is filed under while this counted on the cohort
 * the STUDENT belongs to — which would part company for a language set. They do not:
 * `assign` files a row under the student's own cohort, and `set_cohort(keep_shared=True)`
 * spares the sets open to every cohort outright. So the language groups are counted as
 * RETAINED here and kept there, rather than threatened here and quietly lost there.
 */
export function costOfMove(
  students: Student[],
  chosen: string[],
  targetCohortId: string | null,
  termNames: Record<string, string>,
): MoveCost {
  const wanted = new Set(chosen);
  const semesters = new Set<string>();
  let losing = 0;
  let placements = 0;

  let retained = 0;
  for (const student of students) {
    if (!wanted.has(student.studentId)) continue;
    if (student.cohortId === targetCohortId) continue;
    const kept = student.groups.filter((group) => group.openToAll);
    const lost = student.groups.filter((group) => !group.openToAll);
    retained += kept.length;
    if (lost.length === 0) continue;
    losing += 1;
    placements += lost.length;
    for (const group of lost) semesters.add(termNames[group.termId] ?? group.termId);
  }

  return { students: losing, placements, semesters: [...semesters].sort(), retained };
}

/** The cost as a sentence, or "" when the move throws nothing away. */
export function describeCost(cost: MoveCost): string {
  if (cost.placements === 0) {
    // Nothing is lost. Saying what is KEPT would be reassurance nobody asked for, and a
    // dialog that appears to say "this is fine" is a dialog that gets clicked through.
    return "";
  }
  const students = `${cost.students} student${cost.students === 1 ? "" : "s"}`;
  const placements = `${cost.placements} group placement${cost.placements === 1 ? "" : "s"}`;
  const where =
    cost.semesters.length === 1
      ? `in ${cost.semesters[0]}`
      : `across ${cost.semesters.length} semesters — ${cost.semesters.join(", ")}`;
  const kept = cost.retained
    ? ` ${cost.retained} placement${cost.retained === 1 ? "" : "s"} in sets open to every cohort — the languages — ${cost.retained === 1 ? "is" : "are"} kept.`
    : "";
  return `${students} would lose ${placements} ${where}. Blocks belong to a cohort, so a student who leaves one leaves its groups; somebody will have to place them again. This cannot be undone.${kept}`;
}
