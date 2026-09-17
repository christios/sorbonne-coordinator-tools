/**
 * Working out who goes in which group of a block — the plan, not the writing of it.
 *
 * Pure and in the browser on purpose. The order a coordinator fills by (ID, first name,
 * last name, or the luck of the draw) and the programme a group prefers both need names
 * and majors, which live in this tab and nowhere on the server. So the plan is made here,
 * shown here, and only `id -> group` ever leaves.
 *
 * The rules, in the order they bite:
 *   - nobody already placed in this block moves; a fill is for the students not yet in it,
 *     and the groups start at the size they already are
 *   - a student never goes into a group that meets at the same hour as one they already
 *     hold in another block — the timetable's word, computed by the server from the Hub
 *   - a group that prefers a programme takes its students first, then anybody may sit there
 *   - then the policy: *balanced* puts each student in the least-full permitted group,
 *     *packed* fills each group to capacity before opening the next
 *   - a group with a capacity is full at capacity; one without is never full
 */

import { sameProgram } from "@/services/programmes";

export type FillOrder = "id" | "first" | "last" | "random";
export type FillPolicy = "balanced" | "packed";

/** One sub-row of a group, as the fill sees it: whose seats these are, and how many are taken. */
export type FillMajor = {
  id: string;
  program: string;
  seats: number;
  assigned: number;
};

export type FillGroup = {
  id: string;
  label: string;
  capacity: number;
  /** How many sit in it already. */
  assigned: number;
  /** For a group of a nested set: the group of the parent set it sits inside. */
  parentGroupId?: string;
  /**
   * The majors the group holds, each with its seats. Empty for a group open to everybody.
   * Where it is not, the group is closed to anyone of another programme.
   */
  majors?: FillMajor[];
  /**
   * Whether every sub-row is taught the very same sections. Then a seat is a seat and a
   * student may overflow into another major's; where the sub-rows differ, a student in the
   * wrong sub-row would follow it into the wrong lecture, so the seats are hard.
   */
  identical?: boolean;
};

export type FillCandidate = {
  studentId: string;
  first: string;
  last: string;
  program: string;
  /** The groups this student already holds in the other blocks: `scope id -> group id`. */
  held: Record<string, string>;
};

export type Placement = {
  studentId: string;
  groupId: string;
  /** The sub-row taken, where the group has them. */
  majorId: string;
  why: "preferred" | "least full" | "next seat";
};

export type Unplaced = {
  studentId: string;
  why: string;
};

export type FillPlan = {
  placements: Placement[];
  unplaced: Unplaced[];
  /** Every group of the block, with its size before and after. */
  sizes: { groupId: string; label: string; before: number; after: number; capacity: number }[];
};

/** Two group ids that meet at the same hour, in a form a Set can hold. */
export function clashKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function planFill({
  groups,
  candidates,
  clashes,
  order,
  policy,
  seed = Date.now(),
  parentScopeId = "",
}: {
  groups: FillGroup[];
  candidates: FillCandidate[];
  /** `clashKey` of every pair of groups that overlap, across the whole cohort. */
  clashes: ReadonlySet<string>;
  order: FillOrder;
  policy: FillPolicy;
  /** For the random order, so a preview and what is written are the same draw. */
  seed?: number;
  /**
   * For a nested set: the set it sits inside. A student may only go into a group that
   * nests in the parent group they already hold — a TP half of their own TD group —
   * and one not yet in a parent group waits.
   */
  parentScopeId?: string;
}): FillPlan {
  const counts = new Map(groups.map((group) => [group.id, group.assigned]));
  // Per sub-row too, since a sub-row's seats are its own.
  const onMajor = new Map(groups.flatMap((group) => (group.majors ?? []).map((major) => [major.id, major.assigned])));
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];

  const hasRoom = (group: FillGroup) => group.capacity === 0 || (counts.get(group.id) ?? 0) < group.capacity;
  const majorHasRoom = (major: FillMajor) => major.seats === 0 || (onMajor.get(major.id) ?? 0) < major.seats;
  /** The sub-row of their own programme, where the group holds it. */
  const ownMajor = (group: FillGroup, candidate: FillCandidate) =>
    (group.majors ?? []).find((major) => sameProgram(major.program, candidate.program)) ?? null;
  /**
   * The seat a student may take in a group: their own sub-row while it has room; another
   * sub-row's only where every sub-row is taught the same sections; nothing in a group that
   * holds no sub-row for them at all — the group is closed to their programme.
   */
  const seatIn = (group: FillGroup, candidate: FillCandidate): FillMajor | null | undefined => {
    const majors = group.majors ?? [];
    if (majors.length === 0) return null;
    const own = ownMajor(group, candidate);
    if (!own && !group.identical) return undefined;
    if (own && majorHasRoom(own)) return own;
    if (group.identical) return majors.find(majorHasRoom) ?? undefined;
    return undefined;
  };
  const permitted = (candidate: FillCandidate) =>
    groups.filter((group) => {
      if (parentScopeId && group.parentGroupId !== candidate.held[parentScopeId]) return false;
      if ((group.majors ?? []).length && !ownMajor(group, candidate) && !group.identical) return false;
      return !Object.values(candidate.held).some((held) => clashes.has(clashKey(held, group.id)));
    });

  const seat = (candidate: FillCandidate, among: FillGroup[], why: Placement["why"]): boolean => {
    const open = among.filter((group) => hasRoom(group) && seatIn(group, candidate) !== undefined);
    if (open.length === 0) return false;
    const chosen =
      policy === "packed"
        ? open[0]
        : open.reduce((best, group) => ((counts.get(group.id) ?? 0) < (counts.get(best.id) ?? 0) ? group : best));
    const major = seatIn(chosen, candidate);
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    if (major) onMajor.set(major.id, (onMajor.get(major.id) ?? 0) + 1);
    placements.push({
      studentId: candidate.studentId,
      groupId: chosen.id,
      majorId: major?.id ?? "",
      why: policy === "packed" && why !== "preferred" ? "next seat" : why,
    });
    return true;
  };

  const ordered = sortCandidates(candidates, order, seed);

  // First the students somebody asked for: a group that holds a sub-row for their
  // programme takes them before the general fill, so "Physics → G3" holds even when G3
  // is in the middle.
  const rest: FillCandidate[] = [];
  for (const candidate of ordered) {
    const preferring = permitted(candidate).filter((group) => ownMajor(group, candidate));
    if (preferring.length === 0 || !seat(candidate, preferring, "preferred")) rest.push(candidate);
  }

  for (const candidate of rest) {
    const allowed = permitted(candidate);
    if (groups.length === 0) {
      unplaced.push({ studentId: candidate.studentId, why: "the block has no groups" });
    } else if (parentScopeId && !candidate.held[parentScopeId]) {
      unplaced.push({ studentId: candidate.studentId, why: "not yet in a group of the set this one nests in" });
    } else if (allowed.length === 0) {
      unplaced.push({
        studentId: candidate.studentId,
        why: parentScopeId
          ? "no group of this set nests in their parent group"
          : groups.every((group) => (group.majors ?? []).length && !ownMajor(group, candidate) && !group.identical)
            ? "no group of this set holds a sub-row for their programme"
            : "every group meets at the same hour as one they already hold",
      });
    } else if (!seat(candidate, allowed, "least full")) {
      unplaced.push({
        studentId: candidate.studentId,
        why: allowed.length === groups.length ? "every group is full" : "every group they may sit in is full",
      });
    }
  }

  return {
    placements,
    unplaced,
    sizes: groups.map((group) => ({
      groupId: group.id,
      label: group.label,
      before: group.assigned,
      after: counts.get(group.id) ?? group.assigned,
      capacity: group.capacity,
    })),
  };
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function sortCandidates(candidates: FillCandidate[], order: FillOrder, seed: number): FillCandidate[] {
  const byId = (left: FillCandidate, right: FillCandidate) => collator.compare(left.studentId, right.studentId);
  const list = [...candidates];
  switch (order) {
    case "id":
      return list.sort(byId);
    case "first":
      return list.sort((left, right) => collator.compare(left.first, right.first) || collator.compare(left.last, right.last) || byId(left, right));
    case "last":
      return list.sort((left, right) => collator.compare(left.last, right.last) || collator.compare(left.first, right.first) || byId(left, right));
    case "random":
      return shuffle(list.sort(byId), seed);
  }
}

/** Fisher–Yates with a small seeded generator, so the same seed is the same draw. */
function shuffle<T>(items: T[], seed: number): T[] {
  const next = mulberry32(seed);
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** The plan as the server takes it: `group id -> student ids`. */
/** The sub-row each placed student takes, for `placeStudents`. Only those that took one. */
export function majorsByStudent(plan: FillPlan): Record<string, string> {
  const held: Record<string, string> = {};
  for (const placement of plan.placements) if (placement.majorId) held[placement.studentId] = placement.majorId;
  return held;
}

export function placementsByGroup(plan: FillPlan): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const placement of plan.placements) (grouped[placement.groupId] ??= []).push(placement.studentId);
  return grouped;
}
