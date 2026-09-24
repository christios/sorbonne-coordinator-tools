import { EMPTY_REQUEST, EMPTY_SECTION } from "@/services/studentDatabase";
import { describe, expect, it } from "vitest";

import {
  type AdmissionsStudent,
  admissionsColumns,
  admissionsRows,
  admissionsSheetName,
  buildAdmissionsBuffer,
} from "@/services/admissionsExport";
import type { CatalogueScope } from "@/services/studentDatabase";

const CM: CatalogueScope = {
  id: "s-cm",
  code: "CM",
  name: "Lectures",
  note: "",
  kind: "shared", parentScopeId: "", openToAll: false,
  courses: [{ id: "c-math", code: "MATH001", name: "Pre-calculus", component: "CM", request: EMPTY_REQUEST }],
  groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 2, crns: { "c-math": { ...EMPTY_SECTION, crn: "22151", teacher: "" } } }],
};

const TD: CatalogueScope = {
  id: "s-td",
  code: "TD",
  name: "Tutorials",
  note: "",
  kind: "shared", parentScopeId: "", openToAll: false,
  courses: [
    { id: "t-math", code: "MATH001", name: "Pre-calculus", component: "TD", request: EMPTY_REQUEST },
    { id: "t-algo", code: "MATH011", name: "Algorithms", component: "", request: EMPTY_REQUEST },
  ],
  groups: [
    {
      id: "td-1",
      label: "1",
      capacity: 0,
      note: "",
      parentGroupId: "",
      assigned: 1,
      crns: { "t-math": { ...EMPTY_SECTION, crn: "23652", teacher: "" }, "t-algo": { ...EMPTY_SECTION, crn: "23365", teacher: "" } },
    },
    { id: "td-2", label: "2", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: { "t-math": { ...EMPTY_SECTION, crn: "23653", teacher: "" } } },
  ],
};

const STUDENTS: AdmissionsStudent[] = [
  { studentId: "A002", name: "Zara Haddad", groups: { "s-cm": "cm-a", "s-td": "td-2" } },
  { studentId: "A001", name: "Amir Saleh", groups: { "s-cm": "cm-a", "s-td": "td-1" } },
  { studentId: "A003", name: "Lina Nasr", groups: {} },
];

describe("the columns", () => {
  it("are one per course of every block, named by course and component", () => {
    expect(admissionsColumns([CM, TD]).map((column) => column.header)).toEqual([
      "MATH001 CM CRN",
      "MATH001 TD CRN",
      "MATH011 TD CRN",
    ]);
  });
});

describe("the rows", () => {
  it("carry the CRN of the student's group for each course, sorted by name", () => {
    const rows = admissionsRows([CM, TD], STUDENTS);

    expect(rows.map((row) => row.name)).toEqual(["Amir Saleh", "Lina Nasr", "Zara Haddad"]);
    expect(rows[0].crns).toEqual(["22151", "23652", "23365"]);
  });

  it("leave a cell blank when the group holds no CRN for that course, rather than guessing", () => {
    // Zara is in TD 2, which has no CRN for Algorithms.
    expect(admissionsRows([CM, TD], STUDENTS)[2].crns).toEqual(["22151", "23653", null]);
  });

  it("leave every cell blank for a student in no group", () => {
    expect(admissionsRows([CM, TD], STUDENTS)[1].crns).toEqual([null, null, null]);
  });
});

/*
 * L3's lecture block, shaped as production holds it: MATH-351 is taught in two halves by
 * two professors, a CRN each, and both groups are split into majors — Physics is not
 * taught MATH-351, and Mathematics has a major-specific section of its own for MATH-336.
 */
const half = (crn: string, part: number) => ({ ...EMPTY_SECTION, crn, part });
const L3: CatalogueScope = {
  id: "s-l3",
  code: "CM",
  name: "Lectures",
  note: "",
  kind: "shared", parentScopeId: "", openToAll: false,
  courses: [
    { id: "m351", code: "MATH-351", name: "Algebra & Cryptography", component: "CM", request: EMPTY_REQUEST },
    { id: "m336", code: "MATH-336", name: "Topology", component: "CM", request: EMPTY_REQUEST },
  ],
  groups: [
    {
      id: "maths",
      label: "Mathematics",
      capacity: 0,
      note: "",
      parentGroupId: "",
      assigned: 3,
      majors: [
        { id: "maj-math", program: "MATH - Mathematics", seats: 20, assigned: 2 },
        { id: "maj-phys", program: "PHYS - Physics", seats: 5, assigned: 1 },
      ],
      crns: {
        m351: { ...half("23436", 1), parts: [half("23436", 1), half("24311", 2)] },
        m336: { ...half("23500", 1), parts: [half("23500", 1)] },
      },
      byMajor: {
        "maj-math": { m336: { ...half("23501", 1), parts: [half("23501", 1)] } },
        "maj-phys": { m351: { ...EMPTY_SECTION, notTaught: true } },
      },
    },
    {
      id: "retired",
      label: "Old",
      capacity: 0,
      note: "",
      parentGroupId: "",
      assigned: 1,
      crns: { m336: { ...half("23999", 1), retired: true, parts: [{ ...half("23999", 1), retired: true }] } },
    },
  ],
};

const L3_STUDENTS: AdmissionsStudent[] = [
  { studentId: "A001", name: "Amir Saleh", groups: { "s-l3": "maths" }, majors: { "s-l3": "maj-math" } },
  { studentId: "A002", name: "Badr Karam", groups: { "s-l3": "maths" }, majors: { "s-l3": "maj-phys" } },
  { studentId: "A003", name: "Carla Aoun", groups: { "s-l3": "maths" } },
  { studentId: "A004", name: "Dina Farah", groups: { "s-l3": "retired" } },
];

describe("a course taught in two halves", () => {
  it("takes a column per half, the second named as such", () => {
    expect(admissionsColumns([L3]).map((column) => column.header)).toEqual([
      "MATH-351 CM CRN",
      "MATH-351 CM CRN (2nd half)",
      "MATH-336 CM CRN",
    ]);
  });

  it("gives a student both halves' CRNs, one per cell", () => {
    // Carla sits on no sub-row, so reads the group's shared cells.
    expect(admissionsRows([L3], L3_STUDENTS)[2].crns).toEqual(["23436", "24311", "23500"]);
  });

  it("follows the student's major: its own section over the group's, and nothing it is not taught", () => {
    const [amir, badr] = admissionsRows([L3], L3_STUDENTS);
    expect(amir.crns).toEqual(["23436", "24311", "23501"]);
    expect(badr.crns).toEqual([null, null, "23500"]);
  });

  it("leaves out a retired section, which enrols nobody", () => {
    expect(admissionsRows([L3], L3_STUDENTS)[3].crns).toEqual([null, null, null]);
  });

  it("adds no column for a course nobody splits", () => {
    expect(admissionsColumns([CM, TD]).every((column) => column.part === 0)).toBe(true);
  });
});

describe("the file", () => {
  it("is one flat sheet: a header row, one row per student, CRNs as numbers", async () => {
    const buffer = await buildAdmissionsBuffer({ prefix: "FYS", year: "26-27", scopes: [CM, TD], students: STUDENTS });
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["SCEN-FYS-CRN-Enroll-26-27"]);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, "Student ID", "Student Full Name", "MATH001 CM CRN", "MATH001 TD CRN", "MATH011 TD CRN"]);
    expect(sheet.getRow(2).values).toEqual([undefined, "A001", "Amir Saleh", 22151, 23652, 23365]);
    expect(sheet.getRow(3).values).toEqual([undefined, "A003", "Lina Nasr"]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("keeps the sheet name within what Excel allows", () => {
    expect(admissionsSheetName("A-very-long-cohort-prefix-indeed").length).toBeLessThanOrEqual(31);
  });
});
