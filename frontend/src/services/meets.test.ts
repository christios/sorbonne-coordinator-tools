import { describe, expect, it } from "vitest";

import { DAY_UNKNOWN, meetsTokens, setTokens } from "@/services/meets";

const CRNS = { "g-lang": ["24001"], "g-td": ["23652"], "g-empty": [] as string[] };
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
    const twice = { ...CRNS, "g-td": ["23652", "23653"] };
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
