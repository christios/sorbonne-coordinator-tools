import { describe, expect, it } from "vitest";

import { describeRemoval, semestersHeldBy, setsToEmpty } from "@/services/groupRemoval";
import type { Student } from "@/services/studentDatabase";

const student = (studentId: string, groups: Student["groups"]): Student =>
  ({ studentId, cohortId: "c1", cohortName: "L1", groups, status: "in_portal" }) as unknown as Student;

const held = (termId: string, scopeCode: string, groupLabel: string, openToAll = false) => ({
  termId,
  scopeCode,
  groupLabel,
  openToAll,
});

const TERMS = { "term-1": "Semester 1", "term-2": "Semester 2" };

const ROSTER = [
  student("A001", [held("term-1", "TD", "1"), held("term-1", "CM", "A"), held("term-2", "TD", "3")]),
  student("A002", [held("term-1", "TD", "1"), held("term-1", "LANG", "A0-F5", true)]),
  student("A003", [held("term-1", "TD", "2")]),
];

describe("which semesters the chosen are in", () => {
  it("names only the semesters they actually hold a group in", () => {
    // Not a picker of every semester the department has ever run: the answer is one of
    // the two or three they are in, and it is already on screen.
    const seen = semestersHeldBy(ROSTER, ["A001", "A002"], TERMS);

    expect(seen.map((row) => row.termName)).toEqual(["Semester 1", "Semester 2"]);
  });

  it("counts the placements and the students, and names each group once", () => {
    const [first] = semestersHeldBy(ROSTER, ["A001", "A002"], TERMS);

    expect(first.placements).toBe(4);
    expect(first.students).toBe(2);
    // TD 1 holds both of them and is named once: the confirm is about which groups empty
    // out, not how many sit in each.
    expect(first.groups).toEqual(["CM A", "LANG A0-F5", "TD 1"]);
  });

  it("says which of them are sets the whole department shares", () => {
    const [first] = semestersHeldBy(ROSTER, ["A002"], TERMS);

    expect(first.shared).toEqual(["LANG A0-F5"]);
  });

  it("puts the semester with most to lose first", () => {
    expect(semestersHeldBy(ROSTER, ["A001"], TERMS).map((row) => row.placements)).toEqual([2, 1]);
  });

  it("says nothing about students who hold no group at all", () => {
    expect(semestersHeldBy([student("A009", [])], ["A009"], TERMS)).toEqual([]);
  });

  it("ignores rows nobody selected", () => {
    const seen = semestersHeldBy(ROSTER, ["A003"], TERMS);

    expect(seen).toHaveLength(1);
    expect(seen[0].groups).toEqual(["TD 2"]);
  });

  it("falls back to the id when a semester has no name to give", () => {
    expect(semestersHeldBy(ROSTER, ["A003"], {})[0].termName).toBe("term-1");
  });
});

describe("what the confirm says", () => {
  it("lists the groups rather than counting them", () => {
    const said = describeRemoval(semestersHeldBy(ROSTER, ["A001", "A002"], TERMS)[0]);

    expect(said).toContain("2 students would give up 4 group placements in Semester 1");
    expect(said).toContain("CM A, LANG A0-F5, TD 1");
    expect(said).toContain("Their cohort is unchanged, and no other semester is touched");
    expect(said).toContain("cannot be undone");
  });

  it("says out loud when a language group is among them", () => {
    // A set open to every cohort is somebody else's rows too, so it is named rather than
    // swept up in a count.
    expect(describeRemoval(semestersHeldBy(ROSTER, ["A002"], TERMS)[0])).toContain(
      "LANG A0-F5 is a set open to every cohort",
    );
  });

  it("says nothing when there is nothing to give up", () => {
    expect(describeRemoval(null)).toBe("");
  });
});

describe("which sets the removal writes to", () => {
  const SCOPES = [
    { id: "s-td", code: "TD" },
    { id: "s-cm", code: "CM" },
    { id: "s-tp", code: "TP" },
  ];

  it("writes only to the sets they are in", () => {
    // One request per set, so a write to a set holding none of them is a request that
    // says nothing.
    expect(setsToEmpty(ROSTER, ["A001"], "term-1", SCOPES)).toEqual(["s-td", "s-cm"]);
  });

  it("keeps to the semester it was given", () => {
    expect(setsToEmpty(ROSTER, ["A001"], "term-2", SCOPES)).toEqual(["s-td"]);
  });

  it("writes nothing for a selection that holds nothing there", () => {
    expect(setsToEmpty(ROSTER, ["A003"], "term-2", SCOPES)).toEqual([]);
  });
});
