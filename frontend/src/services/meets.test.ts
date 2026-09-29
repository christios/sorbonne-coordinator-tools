import { describe, expect, it } from "vitest";

import { DAY_UNKNOWN, groupCrns, meetsTokens, setTokens, type GroupCrns } from "@/services/meets";
import { EMPTY_SECTION, type Catalogue } from "@/services/studentDatabase";

const CRNS: GroupCrns = {
  "g-lang": [{ crn: "24001", courseId: "c-lang" }],
  "g-td": [{ crn: "23652", courseId: "c-math" }],
  "g-empty": [],
};
const DAYS = { "24001": ["Tue"], "23652": ["Mon", "Wed"] };
const lang = { termId: "t1", scopeCode: "LANG", groupId: "g-lang" };
const td = { termId: "t1", scopeCode: "TD", groupId: "g-td" };

/*
 * The question is "who has languages on a Tuesday", and two flat columns cannot answer it:
 * `applyFilters` runs each filter against its own column, so `sets include LANG` AND
 * `days include Tue` matches somebody who takes languages and separately has maths on
 * Tuesday. A flat day column reads like a correlated question and answers a different one.
 */
describe("a token is a set and a day together", () => {
  it("pairs each set with the days its own sections meet on", () => {
    expect(meetsTokens([lang, td], CRNS, DAYS)).toEqual(["LANG Tue", "TD Mon", "TD Wed"]);
  });

  it("says a set once however many of its sections meet that day", () => {
    const twice = { ...CRNS, "g-td": [...CRNS["g-td"], { crn: "23653", courseId: "c-cpsc" }] };
    expect(meetsTokens([td], twice, { ...DAYS, "23653": ["Mon"] })).toEqual(["TD Mon", "TD Wed"]);
  });

  it("yields 'day unknown' for a group whose CRN nobody has asked about", () => {
    /*
     * Not silence. Left out, `Meets exclude LANG Tue` would quietly select the students
     * whose language hour is merely unknown — a false negative over incomplete evidence.
     */
    expect(meetsTokens([lang], CRNS, {})).toEqual([`LANG ${DAY_UNKNOWN}`]);
  });

  it("says the same for a group that holds no sections yet", () => {
    expect(meetsTokens([{ ...lang, groupId: "g-empty" }], CRNS, DAYS)).toEqual([`LANG ${DAY_UNKNOWN}`]);
  });

  it("prefixes the semester only when the student is in more than one", () => {
    const names = { t1: "Semester 1 2026-27", t2: "Semester 2 2026-27" };
    const other = { termId: "t2", scopeCode: "LANG", groupId: "g-td" };

    expect(meetsTokens([lang], CRNS, DAYS, names)).toEqual(["LANG Tue"]);
    // "Semester 1", not the registrar's full title: `shortTerm`'s rule, reused rather
    // than reinvented, so the Meets column and the Groups column read the same way.
    expect(meetsTokens([lang, other], CRNS, DAYS, names)).toEqual([
      "Semester 1 · LANG Tue", "Semester 2 · LANG Mon", "Semester 2 · LANG Wed",
    ]);
  });

  it("leaves the prefix off a semester with no name to show", () => {
    const other = { termId: "t2", scopeCode: "TD", groupId: "g-td" };
    expect(meetsTokens([lang, other], CRNS, DAYS, {})).toEqual(["LANG Tue", "TD Mon", "TD Wed"]);
  });
});

/*
 * A course they are exempt from is not a class they are in, though their group is. Four L1
 * students exempt from CPSC-100 still "met" on its afternoon.
 */
describe("a course the student is exempt from", () => {
  const td2 = { ...CRNS, "g-td": [...CRNS["g-td"], { crn: "23653", courseId: "c-cpsc" }] };
  const days = { ...DAYS, "23653": ["Thu"] };

  it("adds none of its days", () => {
    expect(meetsTokens([td], td2, days)).toEqual(["TD Mon", "TD Thu", "TD Wed"]);
    expect(meetsTokens([td], td2, days, {}, new Set(["c-cpsc"]))).toEqual(["TD Mon", "TD Wed"]);
  });

  it("leaves a set out altogether when they are exempt from everything it gives them", () => {
    // They meet on no day of it — which is not the same as not knowing which day.
    expect(meetsTokens([lang, td], CRNS, DAYS, {}, new Set(["c-lang"]))).toEqual(["TD Mon", "TD Wed"]);
  });

  it("is theirs alone: the same group still meets for everybody else", () => {
    expect(meetsTokens([lang], CRNS, DAYS)).toEqual(["LANG Tue"]);
  });
});

/*
 * The flat companion, and correct precisely because it is NOT correlated: "for languages"
 * is a membership question, and ANDing two membership columns is a conjunction rather than
 * the correlation above.
 */
describe("the sets a student is in", () => {
  it("names each set once", () => {
    expect(setTokens([lang, td, { ...td, groupId: "g-other" }])).toEqual(["LANG", "TD"]);
  });

  it("follows the same semester rule as the rest", () => {
    const names = { t1: "Semester 1 2026-27", t2: "Semester 2 2026-27" };
    expect(setTokens([lang, { termId: "t2", scopeCode: "TD" }], names)).toEqual([
      "Semester 1 · LANG", "Semester 2 · TD",
    ]);
  });
});

describe("what each group holds", () => {
  it("keeps the course each CRN is a section of, a sub-row's own too", () => {
    const catalogue = {
      scopes: [
        {
          groups: [
            {
              id: "cm-1",
              crns: { "c-cpsc": { ...EMPTY_SECTION, crn: "22200" }, "c-m113": { ...EMPTY_SECTION, crn: "23307" } },
              byMajor: { "m-phys": { "c-p118": { ...EMPTY_SECTION, crn: "22150" } } },
            },
          ],
        },
      ],
    } as unknown as Catalogue;

    expect(groupCrns([catalogue])["cm-1"]).toEqual([
      { crn: "22200", courseId: "c-cpsc" },
      { crn: "23307", courseId: "c-m113" },
      { crn: "22150", courseId: "c-p118" },
    ]);
  });
});
