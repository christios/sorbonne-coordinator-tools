import type { Student } from "@/services/studentDatabase";

export type MoveCost = {
  /** Students who would lose at least one placement. */
  students: number;
  /** Group assignments dropped, across every semester. */
  placements: number;
  /** The semesters they are in, named, so the cost is not read as "this one". */
  semesters: string[];
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
 * That test is not yet exactly the server's. The server deletes on the cohort each
 * ASSIGNMENT is filed under; this counts on the cohort the STUDENT belongs to. The two
 * agree for an ordinary placement, which is filed under the student's own cohort. They
 * part company for a set open to every cohort — a language set — where the assignment is
 * filed under whichever cohort owns the set. So a shared placement can be counted here
 * and not deleted there, or deleted there and not counted here. Making both sides ask
 * the same question needs the assignment's own cohort on the wire, which is scheduled
 * with the retention change; until then this errs toward warning about a language group
 * that would in fact survive.
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

  for (const student of students) {
    if (!wanted.has(student.studentId)) continue;
    if (student.cohortId === targetCohortId) continue;
    if (student.groups.length === 0) continue;
    losing += 1;
    placements += student.groups.length;
    for (const group of student.groups) semesters.add(termNames[group.termId] ?? group.termId);
  }

  return { students: losing, placements, semesters: [...semesters].sort() };
}

/** The cost as a sentence, or "" when the move throws nothing away. */
export function describeCost(cost: MoveCost): string {
  if (cost.placements === 0) return "";
  const students = `${cost.students} student${cost.students === 1 ? "" : "s"}`;
  const placements = `${cost.placements} group placement${cost.placements === 1 ? "" : "s"}`;
  const where =
    cost.semesters.length === 1
      ? `in ${cost.semesters[0]}`
      : `across ${cost.semesters.length} semesters — ${cost.semesters.join(", ")}`;
  return `${students} would lose ${placements} ${where}. Blocks belong to a cohort, so a student who leaves one leaves its groups; somebody will have to place them again. This cannot be undone.`;
}
