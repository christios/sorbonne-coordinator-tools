import { describe, expect, it } from "vitest";

import { type FillCandidate, type FillGroup, clashKey, placementsByGroup, planFill, sortCandidates } from "@/services/groupFill";
import { rememberProgrammeCodes } from "@/services/programmes";

const group = (id: string, extra: Partial<FillGroup> = {}): FillGroup => ({
  id,
  label: id.toUpperCase(),
  capacity: 0,
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

  it("fills to capacity, then puts the rest in the least full and says they are over", () => {
    // Capacities are an estimate that goes stale; a student left out because of one was
    // worse than a group one over, and every L1 TP half was over its number.
    const result = plan({ groups: [group("g1", { capacity: 1 }), group("g2", { capacity: 1 })] });

    expect(where(result)).toEqual({ A1: "g1", A2: "g2", A3: "g1" });
    expect(result.placements.map((placement) => Boolean(placement.over))).toEqual([false, false, true]);
    expect(result.unplaced).toEqual([]);
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

describe("a group with sub-rows", () => {
  const maths = { id: "m-maths", program: "Mathematics", seats: 0, assigned: 0 };
  const physics = { id: "m-phys", program: "Physics", seats: 0, assigned: 0 };

  it("seats a student on the sub-row of their own programme first, then anybody elsewhere", () => {
    const result = plan({
      groups: [group("g1"), group("g2", { majors: [physics], identical: true })],
      candidates: [student("A1", { program: "Maths" }), student("A2", { program: "physics " }), student("A3", { program: "Maths" })],
    });

    // A2 is seated on G2's physics sub-row before the general deal; then A1 goes to the
    // emptier G1, and A3, with both at one, to the first of the tie.
    expect(where(result)).toEqual({ A2: "g2", A1: "g1", A3: "g1" });
    const seated = result.placements.find((p) => p.studentId === "A2");
    expect([seated?.why, seated?.majorId]).toEqual(["preferred", "m-phys"]);
  });

  it("is closed to a student it holds no sub-row for, unless every sub-row is taught the same sections", () => {
    const closed = plan({
      groups: [group("g1", { majors: [physics] })],
      candidates: [student("A1", { program: "Maths" })],
    });
    expect(closed.unplaced.map((row) => row.why)).toEqual(["no group of this set holds a sub-row for their programme"]);

    // MTP 3A: fifteen physics seats and two mathematics ones, one CRN — a seat is a seat.
    const open = plan({
      groups: [group("g1", { majors: [{ ...physics, seats: 2 }, { ...maths, seats: 1, assigned: 1 }], identical: true })],
      candidates: [student("A1", { program: "Mathematics" })],
    });
    expect(where(open)).toEqual({ A1: "g1" });
    expect(open.placements[0].majorId).toBe("m-phys");
  });

  it("seats a recoded student on the row of the code their new one means", () => {
    // L2's Mathematics became MATS; the department's list says MATS means MATH.
    const mathsRow = { id: "m-math", program: "MATH - Mathematics", seats: 0, assigned: 0 };
    const run = () =>
      plan({
        groups: [group("g1", { majors: [mathsRow, { ...physics, program: "PHYS - Physics" }] })],
        candidates: [student("A1", { program: "MATS - MAth" })],
      });

    expect(run().unplaced.map((row) => row.why)).toEqual(["no group of this set holds a sub-row for their programme"]);
    rememberProgrammeCodes([{ code: "MATS", sameAs: "MATH" }]);
    try {
      expect(run().placements.map((placement) => placement.majorId)).toEqual(["m-math"]);
    } finally {
      rememberProgrammeCodes([]);
    }
  });

  it("never gives a physics seat to a mathematician where the sub-rows are taught different things", () => {
    // CM 1: the mathematics sub-row is full, and a physics seat would send a mathematician
    // to the physics option. They go over on their own sub-row instead, and it is said.
    const result = plan({
      groups: [group("g1", { capacity: 20, majors: [{ ...maths, seats: 1, assigned: 1 }, { ...physics, seats: 19 }] })],
      candidates: [student("A1", { program: "Mathematics" })],
    });
    expect(result.placements.map((placement) => [placement.majorId, placement.over])).toEqual([["m-maths", true]]);
  });

  it("is closed to another programme when it holds one sub-row, whatever it teaches", () => {
    // The walk's reading of a group: one sub-row is never "all the same" — it is that
    // programme's group. Every sub-rowed group in production had exactly one.
    const result = plan({
      groups: [group("phil-2", { majors: [maths] })],
      candidates: [student("A1", { program: "Physics" })],
    });
    expect(result.placements).toEqual([]);
    expect(result.unplaced.map((row) => row.why)).toEqual(["no group of this set holds a sub-row for their programme"]);
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

  it("still places them over capacity in the only group they may sit in, never in the clashing one", () => {
    const result = plan({
      groups: [group("g1"), group("g2", { capacity: 1, assigned: 1 })],
      clashes,
      candidates: [student("A1", { held: { "scope-rdns": "rdns-8" } })],
    });

    expect(result.placements.map((placement) => [placement.groupId, placement.over])).toEqual([["g2", true]]);
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

    expect(result.unplaced[0].why).toMatch(/goes with their group/);
  });
});

describe("a set linked to another, where a group goes with several", () => {
  // L1 Philosophy: 1 goes with TD 1; 2 goes with TD 2 and TD 3.
  const philosophy = [
    group("phil-1", { parentGroupIds: ["td-1"] }),
    group("phil-2", { parentGroupIds: ["td-2", "td-3"] }),
  ];

  it("puts each student in the group that goes with theirs", () => {
    const result = plan({
      groups: philosophy,
      parentScopeId: "scope-td",
      candidates: [
        student("A1", { held: { "scope-td": "td-1" } }),
        student("A2", { held: { "scope-td": "td-2" } }),
        student("A3", { held: { "scope-td": "td-3" } }),
      ],
    });

    expect(where(result)).toEqual({ A1: "phil-1", A2: "phil-2", A3: "phil-2" });
  });

  it("reads a single parent the older way too", () => {
    const result = plan({
      groups: [group("tp-2a", { parentGroupId: "td-2" })],
      parentScopeId: "scope-td",
      candidates: [student("A1", { held: { "scope-td": "td-2" } })],
    });

    expect(where(result)).toEqual({ A1: "tp-2a" });
  });
});

describe("a group first for a programme", () => {
  // L1 TD: 3 was opened for the physicists; mathematicians go there once 1 and 2 are full.
  const tds = (full = false) => [
    group("td-1", { capacity: 2, assigned: full ? 2 : 0 }),
    group("td-2", { capacity: 2, assigned: full ? 2 : 1 }),
    group("td-3", { capacity: 40, firstFor: "PHYS - Physics" }),
  ];

  it("takes its programme's students first and keeps the others out while the rest have room", () => {
    const result = plan({
      groups: tds(),
      candidates: [student("A1", { program: "PHYS - Physics" }), student("A2", { program: "MATH - Mathematics" })],
    });

    expect(where(result)).toEqual({ A1: "td-3", A2: "td-1" });
    expect(result.placements.find((placement) => placement.studentId === "A1")?.why).toBe("preferred");
  });

  it("takes the others once the groups that are nobody's are full", () => {
    const result = plan({ groups: tds(true), candidates: [student("A2", { program: "MATH - Mathematics" })] });

    expect(where(result)).toEqual({ A2: "td-3" });
    expect(result.placements[0].over).toBeUndefined();
  });

  it("is only where the rest of their sets allow", () => {
    // A physicist's Optics TD goes with TD 3 only: their TD is 3 even when TD 3 is full.
    const result = plan({
      groups: [group("td-1"), group("td-3", { capacity: 1, assigned: 1, firstFor: "PHYS - Physics" })],
      candidates: [student("A1", { program: "PHYS - Physics", within: ["td-3"] })],
    });

    expect(result.placements.map((placement) => [placement.groupId, placement.over])).toEqual([["td-3", true]]);
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
