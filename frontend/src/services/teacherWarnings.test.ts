import { describe, expect, it } from "vitest";

import { warningRank, warningsFor, type TeacherFigures } from "@/services/teacherWarnings";

const figures = (over: Partial<TeacherFigures> = {}): TeacherFigures => ({
  teacherKey: "act-1",
  teacher: "Amina Menaa",
  planned: 195,
  registrar: 195,
  contracted: 0,
  taughtSoFar: 0,
  claims: [],
  ...over,
});

const kinds = (held: ReturnType<typeof warningsFor>) => held.map((warning) => warning.kind);

describe("when the four records agree", () => {
  it("says nothing at all", () => {
    expect(warningsFor(figures())).toEqual([]);
  });

  it("says nothing for a difference small enough to be a class running short", () => {
    expect(warningsFor(figures({ registrar: 193.5 }))).toEqual([]);
  });
});

describe("ours against the registrar's", () => {
  it("shows once they are further apart than the department allows", () => {
    const [warning] = warningsFor(figures({ registrar: 189 }));

    expect(warning.kind).toBe("plan_vs_registrar");
    expect(warning.label).toBe("Registrar short 6 h");
    expect(warning.sentence).toContain("we plan 195 h and the registrar has booked 189 h");
  });

  it("says which way round it is", () => {
    expect(warningsFor(figures({ registrar: 205 }))[0].label).toBe("Registrar over 10 h");
  });

  it("is silent where the registrar has been asked about nothing", () => {
    // A term nobody has swept reads as zero, and zero is not a disagreement.
    expect(warningsFor(figures({ registrar: 0 }))).toEqual([]);
  });

  it("obeys the threshold it is given", () => {
    expect(warningsFor(figures({ registrar: 192 }), 2)).toHaveLength(1);
    expect(warningsFor(figures({ registrar: 192 }), 5)).toHaveLength(0);
  });
});

describe("ours against their contract", () => {
  it("shows a teacher carrying more than they are contracted for", () => {
    const [warning] = warningsFor(figures({ contracted: 150 }));

    expect(warning.kind).toBe("plan_vs_contract");
    expect(warning.label).toBe("Contract short 45 h");
  });

  it("stays silent for somebody who has no requisition at all", () => {
    // Most of the full-time staff. Judging them against an absent number would invent a
    // problem out of a blank.
    expect(kinds(warningsFor(figures({ contracted: 0 })))).not.toContain("plan_vs_contract");
  });
});

describe("what was claimed against what met", () => {
  const claim = (over = {}) => ({ periodStart: "2026-09-15", periodLabel: "15 Sep – 14 Oct 2026", claimed: 61, taught: 61, ...over });

  it("says nothing when a sheet matches the timetable", () => {
    expect(warningsFor(figures({ claims: [claim()] }))).toEqual([]);
  });

  it("shows an over-claim, naming the period", () => {
    const [warning] = warningsFor(figures({ claims: [claim({ claimed: 70 })] }));

    expect(warning.label).toBe("Claim over 9 h");
    expect(warning.sentence).toContain("15 Sep – 14 Oct 2026");
  });

  it("shows an under-claim too", () => {
    expect(warningsFor(figures({ claims: [claim({ claimed: 50 })] }))[0].label).toBe("Claim under 11 h");
  });

  it("judges each period on its own", () => {
    const held = warningsFor(
      figures({ claims: [claim({ claimed: 70 }), claim({ periodStart: "2026-08-15", claimed: 40 })] }),
    );

    expect(held).toHaveLength(2);
  });
});

describe("a contract running out", () => {
  /** Planned to match the contract, so only the one comparison under test speaks. */
  const running = (over = {}) => figures({ planned: 60, registrar: 60, contracted: 60, ...over });

  it("says so before it runs out, not after", () => {
    const [warning] = warningsFor(running({ taughtSoFar: 59 }));

    expect(warning.kind).toBe("contract_nearly_spent");
    expect(warning.label).toBe("1 h of contract left");
  });

  it("says how far past it they are once it is spent", () => {
    const [warning] = warningsFor(running({ taughtSoFar: 66 }));

    expect(warning.label).toBe("6 h past contract");
    expect(warning.sentence).toContain("past it");
  });

  it("is quiet while there are hours to spare", () => {
    expect(kinds(warningsFor(running({ taughtSoFar: 20 })))).not.toContain("contract_nearly_spent");
  });
});

describe("the key a dismissal points at", () => {
  it("holds still while the same two numbers do", () => {
    const first = warningsFor(figures({ registrar: 189 }))[0].key;

    expect(warningsFor(figures({ registrar: 189 }))[0].key).toBe(first);
  });

  it("changes the moment either side moves, so a decision expires on its own", () => {
    const before = warningsFor(figures({ registrar: 189 }))[0].key;

    expect(warningsFor(figures({ registrar: 180 }))[0].key).not.toBe(before);
    expect(warningsFor(figures({ planned: 200, registrar: 189 }))[0].key).not.toBe(before);
  });
});

describe("ranking a row", () => {
  it("is the widest gap still standing on it", () => {
    const held = warningsFor(figures({ registrar: 189, contracted: 150 }));

    expect(warningRank(held)).toBe(45);
  });

  it("ignores the ones somebody has already decided about", () => {
    const held = warningsFor(figures({ registrar: 189, contracted: 150 }));
    const decided = held.map((warning) => (warning.kind === "plan_vs_contract" ? { ...warning, dismissed: true } : warning));

    expect(warningRank(decided)).toBe(6);
  });

  it("is nothing where every warning has been answered", () => {
    const held = warningsFor(figures({ registrar: 189 })).map((warning) => ({ ...warning, dismissed: true }));

    expect(warningRank(held)).toBe(0);
  });
});
