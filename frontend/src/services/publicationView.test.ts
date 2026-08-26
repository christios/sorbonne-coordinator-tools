import { describe, expect, it } from "vitest";

import type { CohortReadiness, Publication, PublicationPreview } from "@/services/publication";
import {
  blockersOf,
  describeChange,
  isDestructive,
  sortCohorts,
  unplacedIn,
  verdictFor,
} from "@/services/publicationView";

function cohort(overrides: Partial<CohortReadiness> = {}): CohortReadiness {
  return {
    cohortId: "c1",
    cohort: "Foundation Year",
    students: 24,
    studentsResolved: 24,
    unassigned: {},
    warnings: [],
    isReady: true,
    ...overrides,
  };
}

function publication(overrides: Partial<Publication> = {}): Publication {
  return {
    cohorts: [cohort()],
    validation: {},
    unmatchedCrns: 0,
    sections: 43,
    resolved: { students: 24, enrolments: 168 },
    isReady: true,
    ...overrides,
  };
}

function preview(summary: Partial<PublicationPreview["summary"]> = {}): PublicationPreview {
  return {
    term: { id: "t1", name: "S1", updatedAt: "2026-08-25T00:00:00Z" },
    baseUpdatedAt: "2026-08-25T00:00:00Z",
    summary: {
      studentsBefore: 24,
      studentsAfter: 24,
      enrolmentsAdded: 0,
      enrolmentsRemoved: 0,
      enrolmentsUnchanged: 168,
      studentsGaining: 0,
      studentsLosing: 0,
      studentsLosingEverything: 0,
      unknownCrns: 0,
      ...summary,
    },
    gaining: [],
    losing: [],
    unknownCrns: [],
  };
}

describe("what stands in the way", () => {
  it("finds nothing wrong with a semester that is ready", () => {
    expect(blockersOf(publication())).toEqual([]);
  });

  it("blocks on a CRN the timetable does not have", () => {
    // The real case: TD group 7 pointing at sections that no longer exist.
    const [blocker] = blockersOf(publication({ unmatchedCrns: 3, isReady: false }));
    expect(blocker.severity).toBe("blocking");
    expect(blocker.label).toContain("3 CRNs not in the timetable");
  });

  it("blocks on students who have no group, and counts them across scopes", () => {
    const [blocker] = blockersOf(
      publication({
        isReady: false,
        cohorts: [cohort({ isReady: false, unassigned: { CM: ["A1", "A2"], TD: ["A3"] }, warnings: ["x"] })],
      }),
    );
    expect(blocker.severity).toBe("blocking");
    expect(blocker.label).toBe("Foundation Year: 3 students with no group");
  });

  it("only warns when a cohort has no blocks yet, which is normal in August", () => {
    const [blocker] = blockersOf(
      publication({
        isReady: false,
        cohorts: [cohort({ isReady: false, warnings: ["Tutorials has no groups yet"] })],
      }),
    );
    expect(blocker.severity).toBe("warning");
  });

  it("puts what blocks above what merely warns", () => {
    const blockers = blockersOf(
      publication({
        unmatchedCrns: 1,
        isReady: false,
        cohorts: [cohort({ isReady: false, warnings: ["no groups yet"] })],
      }),
    );
    expect(blockers.map((entry) => entry.severity)).toEqual(["blocking", "warning"]);
  });

  it("says so when no cohort has been pointed at the semester at all", () => {
    const [blocker] = blockersOf(publication({ cohorts: [], isReady: false }));
    expect(blocker.label).toContain("No cohort has blocks");
  });
});

describe("how big the change is", () => {
  it("says plainly when publishing would change nothing", () => {
    expect(describeChange(preview())).toContain("change nothing");
  });

  it("counts what is added and what is taken away", () => {
    const text = describeChange(preview({ enrolmentsAdded: 114, enrolmentsRemoved: 1334 }));
    expect(text).toContain("114 enrolment(s) added");
    expect(text).toContain("1334 removed");
  });

  it("names the students who would be left with nothing", () => {
    // The case that stopped the real run: 165 students about to lose their whole timetable.
    const big = preview({ enrolmentsAdded: 114, enrolmentsRemoved: 1334, studentsLosingEverything: 165 });
    expect(describeChange(big)).toContain("165 student(s) would be left with no timetable");
    expect(isDestructive(big)).toBe(true);
  });

  it("does not call a change destructive when everybody keeps something", () => {
    expect(isDestructive(preview({ enrolmentsRemoved: 12, studentsLosing: 6 }))).toBe(false);
  });
});

describe("reading the catalogue's verdicts", () => {
  it("finds a cell by its group and course", () => {
    const validation = { "g1|MATH-001": { status: "matched" as const, detail: "" } };
    expect(verdictFor(validation, "g1", "MATH-001")?.status).toBe("matched");
    expect(verdictFor(validation, "g1", "PHYS-002")).toBeUndefined();
  });
});

describe("which cohort to look at first", () => {
  it("puts the ones with something wrong above the ones that are fine", () => {
    const rows = sortCohorts([
      cohort({ cohort: "Foundation Year", isReady: true }),
      cohort({ cohort: "L1", isReady: false }),
    ]);
    expect(rows.map((row) => row.cohort)).toEqual(["L1", "Foundation Year"]);
  });

  it("orders the rest by name, ignoring case", () => {
    const rows = sortCohorts([cohort({ cohort: "l2" }), cohort({ cohort: "L1" })]);
    expect(rows.map((row) => row.cohort)).toEqual(["L1", "l2"]);
  });
});

describe("the students nobody has placed", () => {
  const held = (unassigned: Record<string, string[]>): Publication =>
    publication({ cohorts: [cohort({ cohortId: "c1", unassigned })] });

  it("counts each block's gap and the people behind them", () => {
    const report = unplacedIn(held({ CM: ["A1", "A2"], TD: ["A2"] }), "c1");

    expect(report.byBlock).toEqual([
      { scopeCode: "CM", count: 2 },
      { scopeCode: "TD", count: 1 },
    ]);
    // Three gaps, two people: A2 is missing from both.
    expect(report.total).toBe(2);
    expect(report.ids).toEqual(["A1", "A2"]);
  });

  it("puts the worst block first, so the sentence starts with the real problem", () => {
    const report = unplacedIn(held({ TD: ["A1"], RDNS: ["A1", "A2", "A3"] }), "c1");
    expect(report.byBlock.map((entry) => entry.scopeCode)).toEqual(["RDNS", "TD"]);
  });

  it("says nothing about a cohort that is fully placed", () => {
    expect(unplacedIn(held({}), "c1")).toEqual({ total: 0, byBlock: [], ids: [] });
  });

  it("says nothing about a cohort this semester has no blocks for", () => {
    expect(unplacedIn(held({ CM: ["A1"] }), "another-cohort").total).toBe(0);
  });
});
