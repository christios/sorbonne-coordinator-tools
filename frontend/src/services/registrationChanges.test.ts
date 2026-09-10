import { describe, expect, it } from "vitest";

import type { Mismatch } from "@/services/portalLists";
import type { Warning } from "@/services/discrepancies";
import { changesTable, noteChanges, registrationChanges } from "@/services/registrationChanges";

const mismatch = (over: Partial<Mismatch>): Mismatch => ({
  studentId: "A00027997", termId: "t1", termCode: "262710", courseCode: "MATH-001",
  kind: "missing", expected: ["23561"], registered: [], scopeCode: "", ...over,
});

const named = (id: string) => (id === "A00027997" ? "Amira Haddad" : "");

describe("the registrar's worklist", () => {
  it("adds what they should hold and drops what they should not", () => {
    // The arithmetic is expected against registered, not the verdict's name: what we say
    // minus what they hold is the adds, and the other way round is the removes.
    const changes = registrationChanges(
      [mismatch({ kind: "wrong", expected: ["23561"], registered: ["23999"] })],
      named,
      "FYS-S1",
    );

    expect(changes.map((row) => [row.action, row.crn])).toEqual([
      ["Remove", "23999"],
      ["Add", "23561"],
    ]);
  });

  it("frees the seat before filling it, which is the order they have to be done in", () => {
    const changes = registrationChanges(
      [mismatch({ kind: "wrong", expected: ["23561"], registered: ["23999"] })],
      named,
      "FYS-S1",
    );

    expect(changes[0].action).toBe("Remove");
  });

  it("says nothing about a course they are registered in and we have not placed them in", () => {
    /*
     * `unplaced` means the registrar has them in something we hold no group for. The
     * remedy is to place them, not to take the registration away — and a wrong line in
     * front of somebody who acts on it is worse than no line.
     */
    const changes = registrationChanges(
      [mismatch({ kind: "unplaced", expected: [], registered: ["23561"] })],
      named,
      "FYS-S1",
    );

    expect(changes).toEqual([]);
  });

  it("says nothing about two groups of one set, because it cannot say which is the mistake", () => {
    const changes = registrationChanges(
      [mismatch({ kind: "doubled", expected: [], registered: ["23302", "23421"] })],
      named,
      "FYS-S1",
    );

    expect(changes).toEqual([]);
  });

  it("carries the name and the course, so a line reads without a lookup", () => {
    const [change] = registrationChanges([mismatch({})], named, "FYS-S1");

    expect(change.studentName).toBe("Amira Haddad");
    expect(change.courseCode).toBe("MATH-001");
    expect(change.cohortName).toBe("FYS-S1");
  });

  it("writes the student once per block, the way the sheet it replaces does", () => {
    // Eight lines repeating one id eight times reads as eight students at a glance.
    const table = changesTable(
      registrationChanges(
        [
          mismatch({ expected: ["23561"] }),
          mismatch({ expected: ["23564"], courseCode: "MATH-009" }),
        ],
        named,
        "FYS-S1",
      ),
    );

    const [header, first, second] = table.split("\n");
    expect(header.split("\t")).toEqual(["Student ID", "Student", "Cohort", "Action", "Remove CRN", "Add CRN", "Course", "Note"]);
    expect(first.split("\t")).toEqual(["A00027997", "Amira Haddad", "FYS-S1", "Add", "", "23561", "MATH-001", ""]);
    expect(second.split("\t")).toEqual(["", "", "", "Add", "", "23564", "MATH-009", ""]);
  });

  it("puts a removal's CRN in the remove column and an addition's in the add column", () => {
    const table = changesTable(
      registrationChanges([mismatch({ kind: "extra", expected: [], registered: ["23999"] })], named, "FYS-S1"),
    );

    expect(table.split("\n")[1].split("\t")).toEqual(["A00027997", "Amira Haddad", "FYS-S1", "Remove", "23999", "", "MATH-001", ""]);
  });

  it("orders by cohort then by the name somebody will read down", () => {
    const changes = registrationChanges(
      [
        mismatch({ studentId: "A00099999", expected: ["1"] }),
        mismatch({ studentId: "A00027997", expected: ["2"] }),
      ],
      named,
      "FYS-S1",
    );

    // The named student first; the unnamed sort under their id, after every name.
    expect(changes.map((row) => row.studentId)).toEqual(["A00027997", "A00099999"]);
  });
});

describe("the lines with no CRN to act on", () => {
  const warning = (over: Partial<Warning> = {}): Warning => ({
    key: "k1", studentId: "A00027997", ruleId: "r1", kind: "differs",
    field: "MAJOR_CODE_DESC", value: "Physics", expected: "Mathematics", ...over,
  });

  it("carries what is wrong instead of a CRN, so four blank columns are not a mistake", () => {
    const [line] = noteChanges([warning()], named, "FYS-S1");

    expect(line.action).toBe("");
    expect(line.crn).toBe("");
    expect(line.source).toBe("record");
    expect(line.note).toContain("Physics");
  });

  it("leaves the register's own verdicts to the arithmetic that can act on them", () => {
    // A registration warning has CRNs to add and drop; saying it twice, once as a note
    // and once as a pair of lines, would be one fact in two shapes.
    const lines = noteChanges([warning({ kind: "registration", field: "registration" })], named, "FYS-S1");

    expect(lines).toEqual([]);
  });

  it("says nothing about a student whose changes cannot be judged", () => {
    // `no_baseline` is the absence of an answer, not an answer.
    expect(noteChanges([warning({ kind: "no_baseline" })], named, "FYS-S1")).toEqual([]);
  });
});
