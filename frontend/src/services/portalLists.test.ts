import { describe, expect, it } from "vitest";

import { courseRowOf, describeMismatch, registrationRowOf, teacherRowOf, termCodeOf } from "@/services/portalLists";

describe("what a portal row becomes before it is sent", () => {
  it("keeps a course whole, in the server's words", () => {
    expect(
      courseRowOf({
        TERM_CODE: "262710", COURSE_CRN: "22151", COURSE_CODE: "MATH-001", COURSE_TITLE: "Pre-calculus",
        SEQ_NUMB: "1", PTERM_CODE: "1", PTERM_DESC: "Full Term", CREDIT_HRS_NUM: 4, DEPT_CODE: "SCEN",
        LEVEL_CODE: "UG", COLLEGE_CODE: "P4", CONTACT_HRS_NUM: 30, TEACHER_NAME: "Dr Maaz", NUM_REG_STUD: 12,
      }),
    ).toMatchObject({ termCode: "262710", crn: "22151", courseCode: "MATH-001", teacherName: "Dr Maaz", registered: 12, credits: "4" });
  });

  it("sends a teacher without personal fields, whatever the row carried", () => {
    const row = teacherRowOf({
      SPRIDEN_ID: "a00015756", FULL_NAME: "Ahlem TRABELSI", TEACHER_TYPE_DESC: "Part-Time",
      PSUAD_EMAIL: "Ahlem.Trabelsi@sorbonne.ae", PERS_EMAIL: "x@gmail.com", ORACLE_ID: "573",
    });

    expect(row.teacherId).toBe("A00015756");
    expect(JSON.stringify(row)).not.toMatch(/gmail|573|PERS/);
  });

  it("reduces a registration to an id and a CRN — the name goes no further", () => {
    const row = registrationRowOf({ SPRIDEN_ID: "a001", FULL_NAME: "Amira Haddad", COURSE_CRN: "22151", COURSE_CODE: "MATH-001", ABSENCE_PER: "3" });

    expect(row).toEqual({ studentId: "A001", crn: "22151", courseCode: "MATH-001" });
  });

  it("takes the term from the extension, and from the rows when it said nothing", () => {
    expect(termCodeOf({ code: "262710" }, [])).toBe("262710");
    expect(termCodeOf(null, [{ TERM_CODE: "262720" }])).toBe("262720");
    expect(termCodeOf(null, [])).toBe("");
  });
});

describe("a mismatch as a sentence", () => {
  const base = { studentId: "A001", termId: "t", termCode: "262710", courseCode: "MATH-011" };

  it("says what the registrar did and what the group says", () => {
    expect(describeMismatch({ ...base, kind: "wrong", expected: "23652", registered: ["23653"] })).toBe(
      "MATH-011: registered in 23653, group says 23652",
    );
    expect(describeMismatch({ ...base, kind: "missing", expected: "23652", registered: [] })).toBe(
      "MATH-011: not registered, group says 23652",
    );
    expect(describeMismatch({ ...base, kind: "unplaced", expected: "", registered: ["23652"] })).toBe(
      "MATH-011: registered in 23652, but in no group of ours",
    );
  });
});
