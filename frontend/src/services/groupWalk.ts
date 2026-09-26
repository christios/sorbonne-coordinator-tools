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
 * **A set their major does not take is left out**, not reported full: a mathematician has
 * no Optics group because mathematicians do not take Optics.
 *
 * **Nothing is proposed for a student whose major this browser does not know**, in a cohort
 * where the major decides anything. Guessing it was how mathematicians were proposed the
 * physicists' lecture.
 *
 * **A group is only proposed if the student can still sit in every set that follows it.**
 * A physicist's Optics TD goes with TD 3 only, so their TD is 3; a student already in
 * Mechanics TP 2A keeps a TD that 2A goes with.
 *
 * **Languages are left for a person.** They go by a placement test's level, which the
 * platform does not hold, and every guess it made — the emptiest group, which is the highest
 * level — was wrong. A set open to every cohort is the languages.
 */

import {
  type FillCandidate,
  type FillGroup,
  type FillOrder,
  type FillPlan,
  type FillPolicy,
  clashKey,
  planFill,
} from "@/services/groupFill";
import { sameProgram } from "@/services/programmes";
import { type CatalogueGroup, type CatalogueScope, groupIsRetired, parentsOf, partsOf, sectionFor } from "@/services/studentDatabase";

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
  /** Students nothing was proposed for, and why: their major is not known here. */
  notProposed: { studentId: string; why: string }[];
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
  const notProposed: Walk["notProposed"] = [];
  // One mutable copy per student, folded forward as each set is decided.
  const held = new Map(candidates.map((candidate) => [candidate.studentId, { ...candidate.held }]));
  const live = (scope: CatalogueScope) =>
    scope.groups.filter((group) => !groupIsRetired(group) && !collidesWithItself(group.id, clashes));

  // Where any group is somebody's in particular, the major decides something, and a
  // student whose major is not known here gets nothing rather than a guess.
  const majorDecides = scopes.some(
    (scope) => !scope.openToAll && live(scope).some((group) => (group.majors ?? []).length || group.firstFor),
  );
  const known = candidates.filter((candidate) => {
    if (!majorDecides || candidate.program.trim()) return true;
    notProposed.push({ studentId: candidate.studentId, why: "their major is not in this browser" });
    return false;
  });

  for (const scope of parentsFirst(scopes)) {
    if (scope.openToAll) {
      skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "chosen by level — choose it yourself" });
      continue;
    }
    const groups = live(scope);
    if (groups.length === 0) {
      skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "no group of this set can take anybody" });
      continue;
    }
    const unplanned = known.filter((candidate) => !held.get(candidate.studentId)?.[scope.id]);
    if (unplanned.length === 0) {
      if (known.length) skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "already in a group of this set" });
      continue;
    }
    const waiting = unplanned.filter((candidate) => takes(groups, candidate.program));
    if (waiting.length === 0) {
      skipped.push({ scopeId: scope.id, scopeCode: scope.code, why: "not taken by their major" });
      continue;
    }

    // The sets that follow this one, for looking ahead.
    const following = scopes.filter(
      (other) => other.kind === "nested" && other.parentScopeId === scope.id && !other.openToAll,
    );
    const plan = planFill({
      groups: groups.map((group) => fillGroupOf(group, scope)),
      candidates: waiting.map((candidate) => {
        const mine = held.get(candidate.studentId) ?? candidate.held;
        const within = goesWithAll(groups, following.map((other) => ({ groups: live(other), held: mine[other.id] ?? "" })), candidate.program);
        return { ...candidate, held: mine, ...(within ? { within } : {}) };
      }),
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

  return { steps, skipped, notProposed };
}

/**
 * Whether a student of this programme takes the set at all.
 *
 * Not when every group of it is another programme's — sub-rows for other majors and none
 * for theirs, as Optics is to a mathematician. A group with no sub-rows is anybody's.
 */
export function takes(groups: CatalogueGroup[], program: string): boolean {
  return groups.some((group) => {
    const majors = group.majors ?? [];
    return majors.length === 0 || majors.length >= 2 || majors.some((major) => sameProgram(major.program, program));
  });
}

/**
 * The groups of a set a student may still be proposed, given the sets that follow it.
 *
 * For each following set: the group they already hold there says which of these it goes
 * with; otherwise, if their programme takes it, one of its groups open to them must go with
 * the one chosen here. The groups every following set allows, or nothing — no restriction —
 * when nothing follows or the sets disagree, which a person has to untangle anyway.
 */
export function goesWithAll(
  groups: CatalogueGroup[],
  following: { groups: CatalogueGroup[]; held: string }[],
  program: string,
): string[] | null {
  let allowed: string[] | null = null;
  for (const set of following) {
    const holding = set.groups.find((group) => group.id === set.held);
    let parents: string[];
    if (holding) {
      parents = parentsOf(holding);
    } else {
      if (!takes(set.groups, program)) continue;
      parents = set.groups
        .filter((group) => {
          const majors = group.majors ?? [];
          return majors.length === 0 || majors.length >= 2 || majors.some((major) => sameProgram(major.program, program));
        })
        .flatMap((group) => parentsOf(group));
    }
    const these: string[] = allowed === null ? parents : allowed.filter((id: string) => parents.includes(id));
    allowed = these;
  }
  if (allowed === null) return null;
  const permitted: string[] = allowed;
  const within = groups.map((group) => group.id).filter((id) => permitted.includes(id));
  return within.length ? within : null;
}

/**
 * A catalogue group as the fill takes it: its sub-rows with their seats, and whether every
 * sub-row is taught the same sections — which is what decides whether a seat is a seat.
 */
export function fillGroupOf(group: CatalogueGroup, scope: CatalogueScope): FillGroup {
  const majors = (group.majors ?? []).map((major) => ({
    id: major.id,
    program: major.program,
    seats: major.seats,
    assigned: major.assigned,
  }));
  return {
    id: group.id,
    label: group.label,
    capacity: group.capacity,
    assigned: group.assigned,
    parentGroupId: group.parentGroupId,
    parentGroupIds: parentsOf(group),
    firstFor: group.firstFor ?? "",
    majors,
    // A seat is a seat only between two sub-rows or more taught the same. One sub-row is a
    // group that is that programme's alone — every sub-rowed group in production is — and
    // reading it as "all the same" opened each of them to everybody.
    identical: majors.length >= 2 && sameSections(group, scope),
  };
}

/** Whether every sub-row of a group comes to the same CRNs, course for course. */
export function sameSections(group: CatalogueGroup, scope: CatalogueScope): boolean {
  const readings = (group.majors ?? []).map((major) =>
    scope.courses
      .map((course) => {
        const section = sectionFor(group, major.id, course.id);
        return `${course.id}=${section ? partsOf(section).map((part) => part.crn).join("+") : "-"}`;
      })
      .join("|"),
  );
  return readings.every((reading) => reading === readings[0]);
}

/** What the walk would write, per set, in the shape `placeStudents` takes. */
export function walkPlacements(
  walk: Walk,
): { scopeId: string; byGroup: Record<string, string[]>; majors: Record<string, string> }[] {
  return walk.steps
    .filter((step) => step.plan.placements.length > 0)
    .map((step) => {
      const byGroup: Record<string, string[]> = {};
      const majors: Record<string, string> = {};
      for (const placement of step.plan.placements) {
        (byGroup[placement.groupId] ??= []).push(placement.studentId);
        if (placement.majorId) majors[placement.studentId] = placement.majorId;
      }
      return { scopeId: step.scopeId, byGroup, majors };
    });
}
