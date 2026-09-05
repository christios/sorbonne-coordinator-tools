import { describe, expect, it } from "vitest";

import {
  describeWarning,
  unplacedWarnings,
  warningsForCohort,
  warningsText,
  type Change,
  type Placed,
  type Rule,
} from "@/services/discrepancies";

const L1_MATHS = { id: "c1", program: "Applied Mathematics and Physics", yearLevel: "L1" };
const NO_EXPECTATION = { id: "c2", program: "", yearLevel: "" };

const placed = (studentId: string, cohortId: string | null, cohortSince = "2026-09-01T09:00:00Z"): Placed => ({
  studentId,
  cohortId,
  cohortSince,
});

const T = (iso: string) => Date.parse(iso);

function engine(
  cohort: typeof L1_MATHS,
  students: Placed[],
  rules: Rule[],
  current: Record<string, Record<string, string>>,
  changes: Record<string, Change[]> = {},
) {
  return warningsForCohort({
    cohort,
    students,
    rules,
    current: (id) => current[id],
    changes: (id) => changes[id] ?? [],
  });
}

describe("a change since placement", () => {
  const rule: Rule = { id: "r1", field: "STST_CODE", kind: "changed", values: [] };

  it("warns about a change made after the student was placed", () => {
    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1", "2026-09-01T09:00:00Z")],
      [rule],
      { A001: { STST_CODE: "WD" } },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }] },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ kind: "changed", field: "STST_CODE", from: "AS", to: "WD" });
  });

  it("ignores a change made before the student was placed", () => {
    // The record as it stood at placement is the one the coordinator accepted.
    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1", "2026-09-10T09:00:00Z")],
      [rule],
      { A001: { STST_CODE: "WD" } },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }] },
    );

    expect(warnings).toEqual([]);
  });

  it("ignores changes to fields the rule does not name", () => {
    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1")],
      [rule],
      { A001: {} },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "PSUAD_EMAIL", from: "a@b", to: "c@d" }] },
    );

    expect(warnings).toEqual([]);
  });

  it("warns only about a change to one of the named values", () => {
    const toWithdrawn: Rule = { id: "r2", field: "STST_CODE", kind: "changed_to", values: ["WD", "IS"] };
    const changes = {
      A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }],
      A002: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "DF" }],
    };

    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1"), placed("A002", "c1")],
      [toWithdrawn],
      { A001: {}, A002: {} },
      changes,
    );

    expect(warnings.map((w) => w.studentId)).toEqual(["A001"]);
  });

  it("matches a value regardless of case and spacing, as the portal is not tidy", () => {
    const toWithdrawn: Rule = { id: "r2", field: "STST_CODE", kind: "changed_to", values: ["wd"] };

    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1")],
      [toWithdrawn],
      { A001: {} },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: " WD " }] },
    );

    expect(warnings).toHaveLength(1);
  });

  it("says so, once, for a student placed before the moment was recorded", () => {
    // Rather than judging every change they have ever had, or none, silently.
    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c1", "")],
      [rule],
      { A001: {} },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }] },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0].kind).toBe("no_baseline");
  });

  it("does not mention a missing baseline when there is no change rule to need one", () => {
    const isWithdrawn: Rule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD"] };

    const warnings = engine(L1_MATHS, [placed("A001", "c1", "")], [isWithdrawn], { A001: { STST_CODE: "AS" } });

    expect(warnings).toEqual([]);
  });

  it("looks only at the cohort's own students", () => {
    const warnings = engine(
      L1_MATHS,
      [placed("A001", "c2")],
      [rule],
      { A001: {} },
      { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }] },
    );

    expect(warnings).toEqual([]);
  });
});

describe("the state right now", () => {
  const isWithdrawn: Rule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD", "IS"] };

  it("warns when the current value is one the rule names", () => {
    const warnings = engine(L1_MATHS, [placed("A001", "c1")], [isWithdrawn], { A001: { STST_CODE: "IS" } });

    expect(warnings[0]).toMatchObject({ kind: "is", field: "STST_CODE", value: "IS" });
  });

  it("stays quiet when it is not", () => {
    expect(engine(L1_MATHS, [placed("A001", "c1")], [isWithdrawn], { A001: { STST_CODE: "AS" } })).toEqual([]);
  });

  it("stays quiet for a student this browser holds no record of", () => {
    // Nothing to judge by is not the same as in trouble.
    expect(engine(L1_MATHS, [placed("A001", "c1")], [isWithdrawn], {})).toEqual([]);
  });
});

describe("the state right now, the other way round", () => {
  // The allow-list: name what is fine, and anything else warns — including a code
  // admissions invented last week that nobody here has seen.
  const notEligible: Rule = { id: "r6", field: "ESTS_CODE", kind: "is_not", values: ["EL"] };

  it("warns when the current value is not one the rule allows", () => {
    const warnings = engine(L1_MATHS, [placed("A001", "c1")], [notEligible], { A001: { ESTS_CODE: "NE" } });

    expect(warnings[0]).toMatchObject({ kind: "is_not", field: "ESTS_CODE", value: "NE", expected: "EL" });
  });

  it("stays quiet when it is one of them", () => {
    expect(engine(L1_MATHS, [placed("A001", "c1")], [notEligible], { A001: { ESTS_CODE: "el" } })).toEqual([]);
  });

  it("does not judge a student who has no value for the field", () => {
    expect(engine(L1_MATHS, [placed("A001", "c1")], [notEligible], { A001: { STST_CODE: "AS" } })).toEqual([]);
  });

  it("counts as trouble for the unplaced list, so such a student is not a placement candidate", () => {
    const warnings = unplacedWarnings({
      students: [placed("A001", null, ""), placed("A002", null, "")],
      rules: [notEligible],
      current: (id) => ({ A001: { ESTS_CODE: "EL" }, A002: { ESTS_CODE: "NE" } })[id],
    });

    expect(warnings.map((w) => w.studentId)).toEqual(["A001"]);
  });

  it("reads as a sentence that says what was expected", () => {
    expect(
      describeWarning({ key: "", studentId: "A001", ruleId: "r6", kind: "is_not", field: "ESTS_CODE", value: "NE", expected: "EL" }),
    ).toBe("enrolment status is NE, not EL");
  });
});

describe("differing from what the cohort expects", () => {
  const major: Rule = { id: "r4", field: "MAJOR_CODE_DESC", kind: "differs", values: [] };
  const year: Rule = { id: "r5", field: "YEARLEVEL_CODE", kind: "differs", values: [] };

  it("warns when the student's major is not the cohort's program", () => {
    const warnings = engine(L1_MATHS, [placed("A001", "c1")], [major], {
      A001: { MAJOR_CODE_DESC: "Physics" },
    });

    expect(warnings[0]).toMatchObject({
      kind: "differs",
      value: "Physics",
      expected: "Applied Mathematics and Physics",
    });
  });

  it("stays quiet when they match, however the portal spells it", () => {
    const warnings = engine(L1_MATHS, [placed("A001", "c1")], [major, year], {
      A001: { MAJOR_CODE_DESC: "applied mathematics and physics ", YEARLEVEL_CODE: "l1" },
    });

    expect(warnings).toEqual([]);
  });

  it("has nothing to say for a cohort that states no expectation", () => {
    const warnings = engine(NO_EXPECTATION, [placed("A001", "c2")], [major, year], {
      A001: { MAJOR_CODE_DESC: "Physics", YEARLEVEL_CODE: "L3" },
    });

    expect(warnings).toEqual([]);
  });
});

describe("students in no cohort", () => {
  const isWithdrawn: Rule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD"] };
  const students = [placed("A001", null, ""), placed("A002", null, ""), placed("A003", "c1")];

  it("lists those the rules find nothing wrong with", () => {
    const warnings = unplacedWarnings({
      students,
      rules: [isWithdrawn],
      current: (id) => ({ A001: { STST_CODE: "AS" }, A002: { STST_CODE: "WD" }, A003: { STST_CODE: "AS" } })[id],
    });

    // A001 is fine and unplaced; A002 is withdrawn, not a candidate; A003 is placed.
    expect(warnings.map((w) => w.studentId)).toEqual(["A001"]);
    expect(warnings[0].kind).toBe("unplaced");
  });

  it("does not list a student this browser holds no record of", () => {
    expect(unplacedWarnings({ students, rules: [isWithdrawn], current: () => undefined })).toEqual([]);
  });

  it("lists everyone unplaced when there are no rules to say otherwise", () => {
    const warnings = unplacedWarnings({ students, rules: [], current: () => ({ STST_CODE: "AS" }) });

    expect(warnings.map((w) => w.studentId)).toEqual(["A001", "A002"]);
  });
});

describe("a warning's key", () => {
  it("holds still while the fact does, so a dismissal can point at it", () => {
    const rule: Rule = { id: "r1", field: "STST_CODE", kind: "changed", values: [] };
    const run = () =>
      engine(
        L1_MATHS,
        [placed("A001", "c1")],
        [rule],
        { A001: {} },
        { A001: [{ at: T("2026-09-05T10:00:00Z"), field: "STST_CODE", from: "AS", to: "WD" }] },
      )[0].key;

    expect(run()).toBe(run());
  });

  it("changes when the record changes again, which is what lets a dismissal expire", () => {
    const rule: Rule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD", "IS"] };
    const before = engine(L1_MATHS, [placed("A001", "c1")], [rule], { A001: { STST_CODE: "WD" } })[0].key;
    const after = engine(L1_MATHS, [placed("A001", "c1")], [rule], { A001: { STST_CODE: "IS" } })[0].key;

    expect(before).not.toBe(after);
  });
});

describe("reading a warning", () => {
  it("says what happened in plain words", () => {
    expect(
      describeWarning({ key: "", studentId: "A001", ruleId: "r", kind: "changed_to", field: "STST_CODE", from: "AS", to: "WD" }),
    ).toBe("student status changed to WD (was AS)");
    expect(
      describeWarning({
        key: "", studentId: "A001", ruleId: "r", kind: "differs", field: "MAJOR_CODE_DESC", value: "Physics", expected: "Maths",
      }),
    ).toBe("major is Physics, cohort expects Maths");
  });

  it("comes out as a block that pastes into a sheet", () => {
    const text = warningsText([
      {
        studentId: "A001",
        name: "Amira Haddad",
        warnings: [{ key: "", studentId: "A001", ruleId: "r", kind: "is", field: "STST_CODE", value: "WD" }],
      },
    ]);

    expect(text).toBe("Id\tStudent\tWarning\nA001\tAmira Haddad\tstudent status is WD");
  });
});

describe("the registrar's registrations, as warnings", () => {
  const describe_ = (m: { courseCode: string; kind: string }) => `${m.courseCode} ${m.kind}`;

  it("carries the server's sentence, and a key that holds while the fact does", async () => {
    const { registrationWarnings } = await import("@/services/discrepancies");
    const mismatch = { studentId: "A001", termCode: "262710", courseCode: "MATH-011", kind: "wrong" as const, expected: "23652", registered: ["23653"] };

    const [warning] = registrationWarnings([mismatch], describe_);

    expect(warning).toMatchObject({ studentId: "A001", kind: "registration", value: "MATH-011 wrong" });
    expect(describeWarning(warning)).toBe("MATH-011 wrong");
    expect(registrationWarnings([mismatch], describe_)[0].key).toBe(warning.key);
    expect(registrationWarnings([{ ...mismatch, registered: ["23654"] }], describe_)[0].key).not.toBe(warning.key);
  });
});
