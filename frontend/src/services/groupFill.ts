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

export type FillOrder = "id" | "first" | "last" | "random";
export type FillPolicy = "balanced" | "packed";

export type FillGroup = {
  id: string;
  label: string;
  capacity: number;
  /** The programme this group takes first. Empty means any. */
  program: string;
  /** How many sit in it already. */
  assigned: number;
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
}: {
  groups: FillGroup[];
  candidates: FillCandidate[];
  /** `clashKey` of every pair of groups that overlap, across the whole cohort. */
  clashes: Set<string>;
  order: FillOrder;
  policy: FillPolicy;
  /** For the random order, so a preview and what is written are the same draw. */
  seed?: number;
}): FillPlan {
  const counts = new Map(groups.map((group) => [group.id, group.assigned]));
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];

  const hasRoom = (group: FillGroup) => group.capacity === 0 || (counts.get(group.id) ?? 0) < group.capacity;
  const permitted = (candidate: FillCandidate) =>
    groups.filter((group) => !Object.values(candidate.held).some((held) => clashes.has(clashKey(held, group.id))));

  const seat = (candidate: FillCandidate, among: FillGroup[], why: Placement["why"]): boolean => {
    const open = among.filter(hasRoom);
    if (open.length === 0) return false;
    const chosen =
      policy === "packed"
        ? open[0]
        : open.reduce((best, group) => ((counts.get(group.id) ?? 0) < (counts.get(best.id) ?? 0) ? group : best));
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    placements.push({ studentId: candidate.studentId, groupId: chosen.id, why: policy === "packed" && why !== "preferred" ? "next seat" : why });
    return true;
  };

  const ordered = sortCandidates(candidates, order, seed);

  // First the students somebody asked for: a group that prefers their programme takes
  // them before the general fill, so "Physics → G3" holds even when G3 is in the middle.
  const rest: FillCandidate[] = [];
  for (const candidate of ordered) {
    const preferring = permitted(candidate).filter((group) => group.program && sameProgram(group.program, candidate.program));
    if (preferring.length === 0 || !seat(candidate, preferring, "preferred")) rest.push(candidate);
  }

  for (const candidate of rest) {
    const allowed = permitted(candidate);
    if (groups.length === 0) {
      unplaced.push({ studentId: candidate.studentId, why: "the block has no groups" });
    } else if (allowed.length === 0) {
      unplaced.push({ studentId: candidate.studentId, why: "every group meets at the same hour as one they already hold" });
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

function sameProgram(left: string, right: string): boolean {
  return normalise(left) === normalise(right);
}

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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
export function placementsByGroup(plan: FillPlan): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const placement of plan.placements) (grouped[placement.groupId] ??= []).push(placement.studentId);
  return grouped;
}
