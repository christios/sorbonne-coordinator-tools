import { describe, expect, it } from "vitest";

import { buildCards } from "@/services/courseCards";
import { EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import { REQUEST_COLUMNS, buildTimetableWorkbook, requestSheets, sectionName, sheetPrefix, shortSemester, splitCourseCode, teacherHours } from "@/services/timetableExport";

const FYS: CohortCatalogue = {
  cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
  scopes: [
    {
      id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
      courses: [{ id: "td-math", code: "MATH001", name: "Pre-calculus 1", component: "TD" }],
      groups: [
        { id: "td-1", label: "1", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 33, crns: { "td-math": { ...EMPTY_SECTION, crn: "23223", teacherId: "t-ghantous", hours: "50", sessionsPerWeek: "2 sessions - weeks 2 to 14", duration: "1.5", anticipated: 33, constraints: "Should NOT be in parallel with G.2", comments: "Mutualized with Maths" } } },
        { id: "td-7", label: "7", capacity: 30, note: "", program: "", parentGroupId: "", assigned: 0, crns: { "td-math": { ...EMPTY_SECTION, crn: "23899", teacher: "TBD", hours: "50", retired: true } } },
      ],
    },
  ],
};

const termName = (id: string) => (id === "term-1" ? "Physics & Maths — First Year, Semester 1" : id);
const nameOf = (id: string) => ({ "t-ghantous": "Samar Ghantous" })[id] ?? "";
const PARENTS = new Map([["23223", "24226"], ["23899", "24226"]]);
const ACTIVE = [
  { id: "a1", courseCode: "MATH001", title: "Pre-calculus 1", ue: "UL1MA001", addedAt: "", addedBy: "", crnCount: 2, portalCrnCount: 2, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
];

describe("the request sheets", () => {
  it("write one row per section in the workbook's columns, with the retired ones marked", () => {
    const cards = buildCards([FYS], termName, ACTIVE, PARENTS);

    const [sheet] = requestSheets(cards, "term-1", termName("term-1"), () => "Foundation Year for Sciences", nameOf);

    expect(sheet.title).toBe("FY-S1");
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({
      courseName: "Pre-calculus 1 G.1-TD", crn: "23223", subject: "MATH", courseNumber: "001",
      hours: "50", type: "TD", teacher: "Samar Ghantous", weeks: "2 sessions - weeks 2 to 14", duration: "1.5", anticipated: 33,
      constraints: "Should NOT be in parallel with G.2", comments: "Mutualized with Maths",
    });
    expect(sheet.rows[1]).toMatchObject({ courseName: "Pre-calculus 1 G.7-TD", teacher: "TBD", comments: "Retired group" });
  });

  it("names a section and splits a course code the way the workbook does", () => {
    expect(splitCourseCode("MATH-001")).toEqual({ subject: "MATH", number: "001" });
    expect(splitCourseCode("CPSC100")).toEqual({ subject: "CPSC", number: "100" });
    expect(shortSemester("Physics & Maths — First Year, Semester 2")).toBe("S2");
    expect(sheetPrefix("Foundation Year")).toBe("FY");
    expect(sheetPrefix("BSc L1")).toBe("B-L1");
    expect(sheetPrefix("L2")).toBe("L2");
    const [card] = buildCards([FYS], termName, ACTIVE, PARENTS);
    expect(sectionName(card, card.sets[0].rows[0])).toBe("Pre-calculus 1 G.1-TD");
  });

  it("totals hours per teacher, leaving TBD out", () => {
    const sheets = requestSheets(buildCards([FYS], termName), "term-1", "Semester 1", () => "", nameOf);

    expect(teacherHours(sheets)).toEqual([{ teacher: "Samar Ghantous", bySheet: [50], byType: { TD: 50 }, total: 50 }]);
  });

  it("is the workbook: a sheet per cohort with the header on row 4, the CRN table, teacher hours, the list", async () => {
    const sheets = requestSheets(buildCards([FYS], termName, ACTIVE, PARENTS), "term-1", "Semester 1", () => "FYS", nameOf);
    const buffer = await buildTimetableWorkbook(sheets);
    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["FY-S1", "CRN-Table", "Teacher Hours", "Professor List"]);
    const sheet = book.getWorksheet("FY-S1")!;
    expect(sheet.getRow(4).values).toEqual([undefined, ...REQUEST_COLUMNS]);
    expect(sheet.getRow(5).values).toEqual([undefined, "Pre-calculus 1 G.1-TD", "FYS", "UL1MA001", 23223, 24226, "MATH", "001", 50, "TD", undefined, "Samar Ghantous", undefined, undefined, "Should NOT be in parallel with G.2", "2 sessions - weeks 2 to 14", 1.5, 33, "Mutualized with Maths"]);
    expect(book.getWorksheet("CRN-Table")!.getRow(4).values).toEqual([undefined, 23223, "Pre-calculus 1 G.1-TD", "Samar Ghantous"]);
    expect(book.getWorksheet("Teacher Hours")!.getRow(4).values).toEqual([undefined, "Samar Ghantous", 50, 0, 50, 0, 50]);
  });
});
