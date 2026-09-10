/**
 * Proposing a group in every set of a semester, for one student or for a selection.
 *
 * A loop around `planFill`, which is unchanged: the rules about who may sit where — the
 * clash rule, the preferred programme, the capacities, the parent group of a nested set —
 * are the fill's and stay the fill's. What this adds is the four things a loop over sets
 * has to get right, and each of them is a way the loop could silently defeat the rule it
 * is wrapped around.
 *
 * **Parent sets before the sets nested in them.** `planFill` reads
 * `candidate.held[parentScopeId]` to keep a student inside the TD group their TP half
 * nests in. Plan the TP first and every candidate reports "not yet in a group of the set
 * this one nests in" — for a student the walk is about to place in one.
 *
 * **Fold each choice into `held` before the next set.** The load-bearing one. A candidate's
 * entire cross-set memory is `held`, so without the fold the walk cheerfully seats somebody
 * in TD 1 at 08:30 and TP B at 08:30: the clash rule defeated by the loop around it.
 *
 * **Seed `held` from what the student already holds**, including the sets this walk is not
 * planning, so a set left out still constrains the ones taken.
 *
 * **A group whose own sections meet at the same hour cannot hold anyone**, so it is dropped
 * before `planFill` sees it rather than being offered and then refused.
 *
 * A set open to every cohort is listed and never seated. The languages are chosen by level
 * from a placement test, the platform holds no level data, and a language group picked on
 * capacity and major would be confidently wrong.
 */

import {
  type FillCandidate,
  type FillOrder,
  type FillPlan,
  type FillPolicy,
  clashKey,
  planFill,
} from "@/services/groupFill";
import { type CatalogueScope, groupIsRetired } from "@/services/studentDatabase";

/** One set's share of the walk: the plan the fill made, and which set it was for. */
export type WalkStep = {
  scopeId: string;
  scopeCode: string;
  scopeName: string;
  plan: FillPlan;
};

/** A set the walk deliberately declined, and the reason a person can act on. */
export type WalkSkip = {
  scopeId: string;
  scopeCode: string;
  why: string;
};

export type Walk = {
  steps: WalkStep[];
  skipped: WalkSkip[];
};

/**
 * Parent sets first, then by the order they are shown in, so a nested set is never planned
 * before the one it nests in.
 *
 * Not a general topological sort: sets nest one deep — a set names a parent or does not —
 * and inventing depth here would be inventing a shape the rest of the platform does not
 * have.
 */
export function parentsFirst(scopes: CatalogueScope[]): CatalogueScope[] {
  return [...scopes].sort((one, other) => {
    const nested = Number(Boolean(one.parentScopeId)) - Number(Boolean(other.parentScopeId));
    return nested !== 0 ? nested : 0;
  });
}

/** A group that meets at the same hour as itself teaches nobody, whoever is put in it. */
function collidesWithItself(groupId: string, clashes: ReadonlySet<string>): boolean {
  return clashes.has(clashKey(groupId, groupId));
}

export function walkSets({
  scopes,
  candidates,
  clashes,
  order,
  policy,
  seed,
}: {
  /** Every set of the semester in question, shared ones included — they are named, not seated. */
  scopes: CatalogueScope[];
  /**
   * Who to place, each carrying every group they already hold — the sets this walk is not
   * planning included, because those still say when the student is busy.
   */
  candidates: FillCandidate[];
  clashes: ReadonlySet<string>;
  order: FillOrder;
  policy: FillPolicy;
  seed: number;
}): Walk {
  const steps: WalkStep[] = [];
  const skipped: WalkSkip[] = [];
  // One mutable copy per student, folded forward as each set is decided.
  const held = new Map(candidates.map((candidate) => [candidate.studentId, { ...candidate.held }]));

  for (const scope of parentsFirst(scopes)) {
    if (scope.openToAll) {
      skipped.push({
        scopeId: scope.id,
        scopeCode: scope.code,
        why: "chosen by level, so a person places these by hand",
      });
      continue;
    }
    const groups = scope.groups.filter(
      (group) => !groupIsRetired(group) && !collidesWithItself(group.id, clashes),
    );
    if (groups.length === 0) {
      skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "no group of this set can take anybody" });
      continue;
    }
    const waiting = candidates.filter((candidate) => !held.get(candidate.studentId)?.[scope.id]);
    if (waiting.length === 0) {
      skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "already in a group of this set" });
      continue;
    }

    const plan = planFill({
      groups: groups.map((group) => ({
        id: group.id,
        label: group.label,
        capacity: group.capacity,
        program: group.program,
        assigned: group.assigned,
        parentGroupId: group.parentGroupId,
      })),
      candidates: waiting.map((candidate) => ({
        ...candidate,
        held: held.get(candidate.studentId) ?? candidate.held,
      })),
      clashes,
      order,
      policy,
      seed,
      parentScopeId: scope.kind === "nested" ? scope.parentScopeId : "",
    });

    // Before the next set, or the clash rule is being asked about a timetable that is one
    // set out of date every time round.
    for (const placement of plan.placements) {
      const mine = held.get(placement.studentId);
      if (mine) mine[scope.id] = placement.groupId;
    }
    steps.push({ scopeId: scope.id, scopeCode: scope.code, scopeName: scope.name, plan });
  }

  return { steps, skipped };
}

/** What the walk would write, per set, in the shape `placeStudents` takes. */
export function walkPlacements(walk: Walk): { scopeId: string; byGroup: Record<string, string[]> }[] {
  return walk.steps
    .filter((step) => step.plan.placements.length > 0)
    .map((step) => {
      const byGroup: Record<string, string[]> = {};
      for (const placement of step.plan.placements) {
        (byGroup[placement.groupId] ??= []).push(placement.studentId);
      }
      return { scopeId: step.scopeId, byGroup };
    });
}
