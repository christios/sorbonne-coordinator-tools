import { EMPTY_SECTION } from "@/services/studentDatabase";
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
  kind: "shared", parentScopeId: "",
  courses: [{ id: "c-math", code: "MATH001", name: "Pre-calculus", component: "CM" }],
  groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 2, crns: { "c-math": { ...EMPTY_SECTION, crn: "22151", teacher: "" } } }],
};

const TD: CatalogueScope = {
  id: "s-td",
  code: "TD",
  name: "Tutorials",
  note: "",
  kind: "shared", parentScopeId: "",
  courses: [
    { id: "t-math", code: "MATH001", name: "Pre-calculus", component: "TD" },
    { id: "t-algo", code: "MATH011", name: "Algorithms", component: "" },
  ],
  groups: [
    {
      id: "td-1",
      label: "1",
      capacity: 0,
      note: "",
      program: "", parentGroupId: "",
      assigned: 1,
      crns: { "t-math": { ...EMPTY_SECTION, crn: "23652", teacher: "" }, "t-algo": { ...EMPTY_SECTION, crn: "23365", teacher: "" } },
    },
    { id: "td-2", label: "2", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 1, crns: { "t-math": { ...EMPTY_SECTION, crn: "23653", teacher: "" } } },
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

describe("the file", () => {
  it("is one flat sheet: a header row, one row per student, CRNs as numbers", async () => {
    const buffer = await buildAdmissionsBuffer({ prefix: "FYS", scopes: [CM, TD], students: STUDENTS });
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["FYS-CRN-Enroll"]);
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
