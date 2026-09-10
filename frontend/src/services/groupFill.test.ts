import { describe, expect, it } from "vitest";

import { type FillCandidate, type FillGroup, clashKey, placementsByGroup, planFill, sortCandidates } from "@/services/groupFill";

const group = (id: string, extra: Partial<FillGroup> = {}): FillGroup => ({
  id,
  label: id.toUpperCase(),
  capacity: 0,
  program: "",
  assigned: 0,
  ...extra,
});

const student = (studentId: string, extra: Partial<FillCandidate> = {}): FillCandidate => ({
  studentId,
  first: "",
  last: "",
  program: "",
  held: {},
  ...extra,
});

const plan = (overrides: Partial<Parameters<typeof planFill>[0]>) =>
  planFill({
    groups: [group("g1"), group("g2")],
    candidates: [student("A3"), student("A1"), student("A2")],
    clashes: new Set(),
    order: "id",
    policy: "balanced",
    seed: 1,
    ...overrides,
  });

const where = (result: ReturnType<typeof planFill>) =>
  Object.fromEntries(result.placements.map((placement) => [placement.studentId, placement.groupId]));

describe("balanced", () => {
  it("deals students to the least-full group, in the order asked", () => {
    expect(where(plan({}))).toEqual({ A1: "g1", A2: "g2", A3: "g1" });
  });

  it("starts from the sizes the groups already have, so a late arrival goes where there is room", () => {
    // Nobody already placed moves: only the newcomer is a candidate, and G1 is fuller.
    const result = plan({ groups: [group("g1", { assigned: 20 }), group("g2", { assigned: 18 })], candidates: [student("A9")] });

    expect(where(result)).toEqual({ A9: "g2" });
    expect(result.sizes).toEqual([
      { groupId: "g1", label: "G1", before: 20, after: 20, capacity: 0 },
      { groupId: "g2", label: "G2", before: 18, after: 19, capacity: 0 },
    ]);
  });

  it("stops at capacity and says who did not fit", () => {
    const result = plan({ groups: [group("g1", { capacity: 1 }), group("g2", { capacity: 1 })] });

    expect(result.placements).toHaveLength(2);
    expect(result.unplaced).toEqual([{ studentId: "A3", why: "every group is full" }]);
  });
});

describe("packed", () => {
  it("fills each group to capacity before opening the next", () => {
    const result = plan({ policy: "packed", groups: [group("g1", { capacity: 2 }), group("g2", { capacity: 2 })] });

    expect(where(result)).toEqual({ A1: "g1", A2: "g1", A3: "g2" });
    expect(result.placements[0].why).toBe("next seat");
  });

  it("puts everyone in the first group when nothing has a capacity, which is what packed means", () => {
    expect(where(plan({ policy: "packed" }))).toEqual({ A1: "g1", A2: "g1", A3: "g1" });
  });
});

describe("a group that prefers a programme", () => {
  it("takes its students first, then anybody", () => {
    const result = plan({
      groups: [group("g1"), group("g2", { program: "Physics" })],
      candidates: [student("A1", { program: "Maths" }), student("A2", { program: "physics " }), student("A3", { program: "Maths" })],
    });

    // A2 is seated in G2 before the general deal; then A1 goes to the emptier G1, and A3,
    // with both at one, to the first of the tie.
    expect(where(result)).toEqual({ A2: "g2", A1: "g1", A3: "g1" });
    expect(result.placements.find((p) => p.studentId === "A2")?.why).toBe("preferred");
  });

  it("does not hold seats: once its students are in, others may sit there", () => {
    const result = plan({
      groups: [group("g1", { capacity: 1 }), group("g2", { program: "Physics", capacity: 2 })],
      candidates: [student("A1"), student("A2"), student("A3")],
    });

    expect(result.unplaced).toEqual([]);
  });
});

describe("a group that clashes with one the student holds", () => {
  const clashes = new Set([clashKey("g1", "rdns-8")]);

  it("is never chosen for that student", () => {
    const result = plan({ clashes, candidates: [student("A1", { held: { "scope-rdns": "rdns-8" } })] });

    expect(where(result)).toEqual({ A1: "g2" });
  });

  it("leaves the student out, and says why, when every group clashes", () => {
    const result = plan({
      groups: [group("g1")],
      clashes,
      candidates: [student("A1", { held: { "scope-rdns": "rdns-8" } })],
    });

    expect(result.placements).toEqual([]);
    expect(result.unplaced[0].why).toMatch(/same hour/);
  });

  it("says when the only groups they may sit in are full", () => {
    const result = plan({
      groups: [group("g1"), group("g2", { capacity: 1, assigned: 1 })],
      clashes,
      candidates: [student("A1", { held: { "scope-rdns": "rdns-8" } })],
    });

    expect(result.unplaced[0].why).toBe("every group they may sit in is full");
  });
});

describe("a set nested inside another", () => {
  // TP halves 2A and 2B sit inside TD group 2; 3A inside TD 3.
  const halves = [
    group("tp-2a", { capacity: 1, parentGroupId: "td-2" }),
    group("tp-2b", { capacity: 5, parentGroupId: "td-2" }),
    group("tp-3a", { capacity: 5, parentGroupId: "td-3" }),
  ];

  it("keeps a student inside the half of their own parent group", () => {
    const result = plan({
      groups: halves,
      parentScopeId: "scope-td",
      candidates: [student("A1", { held: { "scope-td": "td-2" } }), student("A2", { held: { "scope-td": "td-2" } }), student("A3", { held: { "scope-td": "td-3" } })],
    });

    expect(where(result)).toEqual({ A1: "tp-2a", A2: "tp-2b", A3: "tp-3a" });
  });

  it("makes a student wait who is not yet in a parent group, and says so", () => {
    const result = plan({ groups: halves, parentScopeId: "scope-td", candidates: [student("A9")] });

    expect(result.placements).toEqual([]);
    expect(result.unplaced[0].why).toMatch(/not yet in a group/);
  });

  it("says when their parent group has no half of its own", () => {
    const result = plan({ groups: halves, parentScopeId: "scope-td", candidates: [student("A5", { held: { "scope-td": "td-5" } })] });

    expect(result.unplaced[0].why).toMatch(/nests in their parent group/);
  });
});

describe("the order", () => {
  const people = [
    student("A2", { first: "Zara", last: "Haddad" }),
    student("A1", { first: "Amir", last: "Saleh" }),
    student("A3", { first: "Lina", last: "Haddad" }),
  ];
  const ids = (list: FillCandidate[]) => list.map((c) => c.studentId);

  it("goes by id, first name or last name", () => {
    expect(ids(sortCandidates(people, "id", 1))).toEqual(["A1", "A2", "A3"]);
    expect(ids(sortCandidates(people, "first", 1))).toEqual(["A1", "A3", "A2"]);
    expect(ids(sortCandidates(people, "last", 1))).toEqual(["A3", "A2", "A1"]);
  });

  it("draws the same random order for the same seed, so the preview is what gets written", () => {
    expect(ids(sortCandidates(people, "random", 7))).toEqual(ids(sortCandidates(people, "random", 7)));
    expect(new Set(ids(sortCandidates(people, "random", 7)))).toEqual(new Set(["A1", "A2", "A3"]));
  });
});

describe("what leaves the browser", () => {
  it("is only group id -> student ids", () => {
    expect(placementsByGroup(plan({}))).toEqual({ g1: ["A1", "A3"], g2: ["A2"] });
  });

  it("says so when the block has no groups", () => {
    expect(plan({ groups: [] }).unplaced[0].why).toBe("the block has no groups");
  });
});
